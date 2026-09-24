/**
 * Declarative Workflow Engine — types
 *
 * A workflow is a formal state machine defined as **data** (JSON), never code.
 * Because it is data, it is:
 *   - workerd-safe (no eval — guards use the safe expression evaluator)
 *   - hot-reloadable (update via REST, next transition uses the new definition)
 *   - versionable + auditable (every transition is recorded)
 *
 * State lives in a side table (`_workflow_states`) so ANY collection can adopt
 * a workflow without schema changes — no conflict with the hardcoded
 * `doc_status` machine (draft/submitted/approved/cancelled).
 */

/** A single allowed transition between two states. */
export interface WorkflowTransition {
	/** Unique id within the workflow (e.g. "submit"). */
	id: string;
	/** Source state. */
	from: string;
	/** Target state. */
	to: string;
	/**
	 * Optional guard — a safe expression evaluated against
	 * `{ doc, user }` (e.g. "doc.total > 1000 && user.is_admin == true").
	 * Uses packages/core/src/entity/expression.ts — no eval.
	 */
	guard?: string;
	/** Role names allowed to perform this transition (admin always allowed). */
	roles?: string[];
	/** Side-effects fired AFTER the transition is committed. */
	on_transition?: {
		/** Marketplace plugin ids to invoke (native / binding / sandbox). */
		trigger_plugins?: string[];
	};
}

/** A declarative workflow (state machine) attached to one collection. */
export interface WorkflowDefinition {
	/** Display name (e.g. "Invoice Approval"). */
	name: string;
	/** Optional description. */
	description?: string;
	/** Collection slug this workflow governs (one workflow per collection). */
	collection: string;
	/** Initial state (assumed when a document has no recorded state yet). */
	initial: string;
	/** All states of the machine. */
	states: string[];
	/** Allowed transitions. */
	transitions: WorkflowTransition[];
	/**
	 * Optional mapping from workflow state → built-in doc_status
	 * (e.g. { approved: "approved", cancelled: "cancelled" }). When set, the
	 * engine also syncs doc_status via the entity pipeline whenever the
	 * hardcoded status machine permits the move — giving existing UI/audit/
	 * webhook features visibility into workflow progress.
	 */
	doc_status_map?: Record<string, string>;
	/**
	 * Optional text field on the collection that mirrors the workflow state
	 * (e.g. "wf_state"). When set, every transition also updates that field
	 * through the entity pipeline — so the state shows up in normal CRUD
	 * lists, filters and sorts. The field must exist in the collection schema.
	 */
	state_field?: string;
	/** Whether the workflow is active (transitions rejected when disabled). */
	enabled?: boolean;
}

/** Persisted workflow row (`_workflows`). */
export interface WorkflowRow {
	id: string;
	name: string;
	collection_slug: string;
	definition_json: string;
	enabled: number;
	version: number;
	created_at: string;
	updated_at: string;
}

/** Current state of a document (`_workflow_states`). */
export interface WorkflowStateRow {
	collection_slug: string;
	document_id: string;
	state: string;
	updated_at: string;
}

/** One recorded transition (`_workflow_history`) — the audit trail. */
export interface WorkflowHistoryRow {
	id: string;
	workflow_id: string;
	collection_slug: string;
	document_id: string;
	from_state: string | null;
	to_state: string;
	by_user: string | null;
	by_email: string | null;
	comment: string | null;
	created_at: string;
}

/** Result of a successful transition. */
export interface TransitionResult {
	from: string;
	to: string;
	/** The document (post-transition). */
	doc: Record<string, unknown>;
	/** doc_status value synced via the entity pipeline, if any. */
	synced_doc_status: string | null;
	/** Errors from non-fatal side-effects (e.g. doc_status sync failure). */
	warnings: string[];
	/** Durable outbox ids for on_transition trigger plugins ([] when none). */
	side_effects: string[];
}
