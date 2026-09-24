/**
 * WorkflowEngine — declarative state machine executor (workerd-safe).
 *
 * Interprets a WorkflowDefinition (pure data — no eval):
 *   1. locate the transition  from → to
 *   2. evaluate the guard with the safe expression evaluator (scope { doc, user })
 *   3. enforce roles (admin bypass)
 *   4. commit the new state to the side table + append history
 *   5. optional doc_status sync through the entity pipeline (when the built-in
 *      status machine permits the mapped value)
 *   6. fire on_transition side-effects: marketplace trigger plugins + the
 *      in-process hook spine (`workflow_transition` / `workflow_transition_after`)
 *
 * Every step is data-driven — the same engine serves any business domain.
 */

import { D1Client, evaluateBoolean, validateExpressionComplexity } from '@mmbix/core';
import { ValidationError, ForbiddenError, ConflictError } from '@mmbix/utils';
import { CollectionService } from '@/lib/services/collection.service';
import { FULL_ROW_READ_KEY, checkRowFilterAccess } from '@/lib/services/collection.shared';
import { parseFieldSelection } from '@/lib/api/query-parser';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import type { AuthContext } from '@/lib/services/auth.service';
import type { TransitionResult, WorkflowDefinition, WorkflowTransition } from './types';

export interface TransitionOptions {
	comment?: string;
}

export class WorkflowEngine {
	constructor(
		private readonly db: D1Client,
		private readonly svc: WorkflowServiceLike,
	) {}

	// ─── Definition validation ────────────────────────────

	/** Structural validation — returns a list of human-readable errors ([] = valid). */
	validateDefinition(def: WorkflowDefinition): string[] {
		const errors: string[] = [];
		if (!def.name?.trim()) errors.push('name is required');
		if (!def.collection?.trim()) errors.push('collection is required');
		if (!def.initial) errors.push('initial state is required');
		if (!Array.isArray(def.states) || def.states.length === 0) errors.push('states must be a non-empty array');
		if (!Array.isArray(def.transitions) || def.transitions.length === 0) errors.push('transitions must be a non-empty array');

		const states = new Set(def.states ?? []);
		if (def.initial && !states.has(def.initial)) errors.push(`initial state "${def.initial}" is not in states`);

		const seenIds = new Set<string>();
		for (const t of def.transitions ?? []) {
			if (!t.id) errors.push('every transition needs an id');
			else if (seenIds.has(t.id)) errors.push(`duplicate transition id "${t.id}"`);
			else seenIds.add(t.id);
			if (!t.from || !t.to) errors.push(`transition "${t.id}" needs from and to`);
			if (t.from && !states.has(t.from)) errors.push(`transition "${t.id}" from state "${t.from}" is not in states`);
			if (t.to && !states.has(t.to)) errors.push(`transition "${t.id}" to state "${t.to}" is not in states`);
			if (t.guard) {
				// Guards must be valid safe expressions — fail fast at save time,
				// not at transition time. Complexity is also capped (Big-O bound
				// against pathological rules).
				const complexityError = validateExpressionComplexity(t.guard);
				if (complexityError) errors.push(`transition "${t.id}" guard ${complexityError}`);
				try {
					evaluateBoolean(t.guard, { doc: {}, user: {} });
				} catch (err) {
					errors.push(`transition "${t.id}" guard is not a valid expression: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
			if (t.on_transition?.trigger_plugins) {
				for (const p of t.on_transition.trigger_plugins) {
					if (!p || typeof p !== 'string') errors.push(`transition "${t.id}" trigger_plugins must be plugin ids`);
				}
			}
		}
		return errors;
	}

	// ─── Transition resolution ────────────────────────────

	findTransition(def: WorkflowDefinition, from: string, to: string): WorkflowTransition | undefined {
		return (def.transitions ?? []).find((t) => t.from === from && t.to === to);
	}

	allowedTargets(def: WorkflowDefinition, from: string): string[] {
		return (def.transitions ?? []).filter((t) => t.from === from).map((t) => t.to);
	}

	// ─── The core operation ───────────────────────────────

	/**
	 * Perform a state transition on a document.
	 * Throws ValidationError (unknown transition/guard failed/disabled) or
	 * ForbiddenError (role not allowed).
	 */
	async transition(
		workflow: { id: string; version: number; enabled: number; definition: WorkflowDefinition },
		collectionSlug: string,
		documentId: string,
		toState: string,
		auth: AuthContext | null,
		opts?: TransitionOptions,
	): Promise<TransitionResult> {
		const def = workflow.definition;

		// Workflow must be enabled — check BOTH the row flag and the definition
		// (they can drift if the definition_json is edited directly).
		if (workflow.enabled === 0 || def.enabled === false) throw new ValidationError(`Workflow "${def.name}" is disabled`);

		// Target state must exist.
		if (!def.states.includes(toState)) {
			throw new ValidationError(`"${toState}" is not a state of workflow "${def.name}" (states: ${def.states.join(', ')})`);
		}

		// Current state — side table wins, else the initial state.
		const currentState = (await this.svc.getState(collectionSlug, documentId)) ?? def.initial;
		if (currentState === toState) {
			throw new ValidationError(`Document is already in state "${toState}"`);
		}

		// The transition must be declared.
		const transition = this.findTransition(def, currentState, toState);
		if (!transition) {
			throw new ValidationError(
				`Cannot transition "${currentState}" → "${toState}" (allowed: ${this.allowedTargets(def, currentState).join(', ') || 'none'})`,
			);
		}

		// Fetch the document (entity pipeline — RBAC + cache aware). Guards and hooks
		// evaluate against the FULL row (relation FK columns included), so project
		// '*' with the internal full-row key (no public wire shaping).
		const collection = new CollectionService(this.db);
		const doc = await collection.getItem(collectionSlug, documentId, parseFieldSelection(['*']), FULL_ROW_READ_KEY);
		// Row-level RBAC — a caller may only DRIVE a document their role can see.
		// The read above is deliberately unauthenticated so a guard always evaluates
		// the FULL row (a caller's field restrictions must never change what a guard
		// sees); the ROW filter is applied explicitly, on the row's identity.
		const info = await collection.getCollection(collectionSlug);
		await checkRowFilterAccess(this.db, auth, collectionSlug, info.table_name, documentId);

		// Guard — safe expression against { doc, user, from, to }.
		if (transition.guard) {
			let passed = false;
			try {
				passed = evaluateBoolean(transition.guard, {
					doc,
					user: this.userScope(auth),
					from: currentState,
					to: toState,
				});
			} catch (err) {
				throw new ValidationError(
					`Guard on "${currentState}" → "${toState}" failed to evaluate: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			if (!passed) throw new ValidationError(`Guard on "${currentState}" → "${toState}" not satisfied`);
		}

		// Roles — admin always allowed.
		if (transition.roles && transition.roles.length > 0 && !auth?.is_admin) {
			const roleOk = auth != null && transition.roles.includes(auth.role_name);
			if (!roleOk) {
				throw new ForbiddenError(
					`Transition "${currentState}" → "${toState}" requires role: ${transition.roles.join(' / ')} (your role: ${auth?.role_name ?? 'none'})`,
				);
			}
		}

		// Pre-commit hook point — plugins may abort the transition.
		const abort = await pluginHookRegistry.dispatch(
			collectionSlug,
			'workflow_transition',
			{ ...doc, _transition: { from: currentState, to: toState, workflow: def.name } },
			this.db,
			auth,
		);
		if (abort) throw new ValidationError(abort.error);

		// Commit the state atomically — optimistic lock on the side table. If a
		// concurrent request already moved the doc, this is a 409, never a
		// silent overwrite.
		const committed = await this.svc.transitionState(collectionSlug, documentId, currentState, toState);
		if (!committed) {
			throw new ConflictError(`Document already left state "${currentState}" (concurrent transition) — reload and retry`);
		}
		await this.svc.logHistory({
			workflow_id: workflow.id,
			collection_slug: collectionSlug,
			document_id: documentId,
			from_state: currentState,
			to_state: toState,
			by_user: auth?.user_id ?? null,
			by_email: auth?.email ?? null,
			comment: opts?.comment ?? null,
		});

		// Optional doc_status sync — only when the built-in machine permits it.
		const warnings: string[] = [];
		let syncedDocStatus: string | null = null;
		const mapped = def.doc_status_map?.[toState];
		if (mapped) {
			try {
				await collection.updateItem(collectionSlug, documentId, { doc_status: mapped });
				syncedDocStatus = mapped;
			} catch (err) {
				// Non-fatal: workflow state is authoritative; log and continue.
				warnings.push(`doc_status sync to "${mapped}" failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		// Optional state_field sync — mirrors the state onto a real collection
		// field (must exist in the schema) so CRUD lists/filters see it.
		if (def.state_field) {
			try {
				await collection.updateItem(collectionSlug, documentId, { [def.state_field]: toState });
			} catch (err) {
				warnings.push(`state_field "${def.state_field}" sync failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		// Post-commit side-effects — fire-and-forget events + durable trigger plugins.
		pluginHookRegistry.dispatchFireAndForget(
			collectionSlug,
			'workflow_transition_after',
			{ ...doc, _transition: { from: currentState, to: toState, workflow: def.name } },
			this.db,
			auth,
		);
		// on_transition.trigger_plugins go through the OUTBOX — durable + idempotent
		// (dedupe key = workflow:doc:transition:plugin). A retried transition can
		// never fire the same side-effect twice; a crashed isolate cannot lose it.
		const sideEffects = transition.on_transition?.trigger_plugins?.length
			? await this.enqueueTriggerPlugins(workflow.id, transition, collectionSlug, documentId, currentState, toState, doc)
			: [];

		return {
			from: currentState,
			to: toState,
			doc,
			synced_doc_status: syncedDocStatus,
			warnings,
			side_effects: sideEffects,
		};
	}

	/** Scope handed to guard expressions — { doc, user }. */
	private userScope(auth: AuthContext | null): Record<string, unknown> {
		return {
			user_id: auth?.user_id ?? null,
			email: auth?.email ?? null,
			role_name: auth?.role_name ?? null,
			is_admin: auth?.is_admin ?? false,
		};
	}

	/**
	 * Enqueue on_transition trigger plugins into the durable outbox. Returns the
	 * outbox row ids. Dedupe keys make re-enqueues (retried transitions) no-ops.
	 */
	private async enqueueTriggerPlugins(
		workflowId: string,
		transition: WorkflowTransition,
		collectionSlug: string,
		documentId: string,
		from: string,
		to: string,
		doc: Record<string, unknown>,
	): Promise<string[]> {
		try {
			const { OutboxService } = await import('@/plugins/outbox/service');
			const outbox = new OutboxService(this.db);
			const ids: string[] = [];
			for (const pluginId of transition.on_transition?.trigger_plugins ?? []) {
				const { id } = await outbox.enqueue(
					'plugin',
					{
						plugin_id: pluginId,
						input: {
							collection: collectionSlug,
							event: `workflow_transition`,
							doc: { ...doc, _transition: { from, to, workflow_id: workflowId } },
						},
					},
					{ dedupeKey: `wf:${workflowId}:${documentId}:${from}:${to}:${pluginId}` },
				);
				ids.push(id);
			}
			return ids;
		} catch (err) {
			console.error('[workflow] trigger plugin enqueue error:', err instanceof Error ? err.message : err);
			return [];
		}
	}
}

/** Minimal surface the engine needs from WorkflowService (avoids circular import). */
export interface WorkflowServiceLike {
	getState(collectionSlug: string, documentId: string): Promise<string | null>;
	transitionState(collectionSlug: string, documentId: string, expectedFrom: string, to: string): Promise<boolean>;
	logHistory(entry: Omit<import('./types').WorkflowHistoryRow, 'id' | 'created_at'>): Promise<void>;
}
