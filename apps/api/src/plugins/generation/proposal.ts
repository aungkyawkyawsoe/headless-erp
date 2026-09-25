/**
 * Proposal builder — `DesignDNA → SchemaProposal`.
 *
 * Pure and deterministic: same DNA + same collection name ⇒ byte-identical
 * proposal (its JSON is the idempotency key). It only orchestrates the core
 * rules (`inferFields` / `inferRelations` / `snakeName`) and the SSOT
 * sanitizer; it invents no types and writes nothing. The proposal is the
 * artifact a human reviews — the raw design never reaches the gate.
 */

import { inferFields, inferRelations, snakeName } from '@mmbix/core';
import { sanitizeIdentifier } from '@mmbix/utils';
import type { DesignDNA, DesignHint, FieldProposal, ProposalWarning, RelationProposal, SchemaProposal } from '@mmbix/types';
import { designToBlocks } from './design-blocks';

export interface BuildProposalInput {
	/** Target collection identity; when omitted a name is derived from the design. */
	collection?: { name?: string; slug?: string };
	dna: DesignDNA;
}

export interface BuildProposalOptions {
	/** Hard cap on fields per proposal (the resolved `generation.maxFieldsPerProposal`). */
	maxFields: number;
}

/** Collect every hint across the design, in a pinned order (screen → component → hint). */
function collectHints(dna: DesignDNA): DesignHint[] {
	const hints: DesignHint[] = [];
	for (const screen of dna.screens) for (const component of screen.components) for (const hint of component.hints ?? []) hints.push(hint);
	return hints;
}

function deriveName(input: BuildProposalInput): string {
	const explicit = input.collection?.name?.trim();
	if (explicit) return explicit;
	const screenId = input.dna.source.screenId?.trim();
	return screenId ? screenId : 'New Collection';
}

/** A safe identifier derived from a raw collection/field name, or null. */
function safeName(value: string): string | null {
	const n = snakeName(value);
	if (!n) return null;
	try {
		return sanitizeIdentifier(n, 'generated field');
	} catch {
		return null;
	}
}

/**
 * Relations that imply a foreign key ON THIS collection become reviewable `m2o`
 * fields (C2): a `many` relation pointing AT us means "we belong to `from`"; a
 * `one` relation FROM us means "we point at `to`". Whether the target collection
 * actually exists is checked at APPLY time (the builder is pure), so the human
 * gate sees the FK before it is materialized.
 */
function relationDerivedFields(self: string, relations: RelationProposal[], taken: readonly string[]): FieldProposal[] {
	const out: FieldProposal[] = [];
	const seen = new Set(taken);
	const add = (rawTarget: string) => {
		const target = safeName(rawTarget);
		if (!target || seen.has(target)) return;
		seen.add(target);
		out.push({
			name: target,
			type: 'm2o',
			required: false,
			related_collection: target,
			inference: { confidence: 2, reason: `declared relation to "${target}"`, source: 'declared' },
		});
	};
	for (const r of relations) {
		if (r.cardinality === 'many' && r.to === self) add(r.from);
		else if (r.cardinality === 'one' && r.from === self) add(r.to);
	}
	return out;
}

/** Build a reviewable schema proposal. Pure; never throws on ordinary input. */
export function buildProposal(input: BuildProposalInput, opts: BuildProposalOptions): SchemaProposal {
	const warnings: ProposalWarning[] = [];
	const name = deriveName(input);
	const rawSlug = input.collection?.slug?.trim() || snakeName(name) || 'generated_collection';
	let slug: string;
	try {
		slug = sanitizeIdentifier(rawSlug, 'proposal slug');
	} catch {
		slug = 'generated_collection';
		warnings.push({ code: 'invalid_slug', message: `Collection slug "${rawSlug}" is not a valid identifier — using "${slug}"` });
	}

	// Bound the input before inference (the DNA normalizer already bounds it, but
	// this builder is also called directly in tests/CLI).
	const maxHints = Math.max(1, opts.maxFields) * 4;
	const hints = collectHints(input.dna);
	if (hints.length > maxHints) {
		warnings.push({ code: 'hints_truncated', message: `Considered the first ${maxHints} of ${hints.length} design hints` });
	}
	const { fields, warnings: fieldWarnings } = inferFields(hints.slice(0, maxHints));
	warnings.push(...fieldWarnings);

	const relations: RelationProposal[] = inferRelations(input.dna.screens.flatMap((s) => s.relations ?? []));

	// Relation-derived m2o fields are appended, then the whole set is capped once
	// so the bound counts every field the gate will review.
	const combined = [
		...fields,
		...relationDerivedFields(
			slug,
			relations,
			fields.map((f) => f.name),
		),
	];
	let limited = combined;
	if (combined.length > opts.maxFields) {
		limited = combined.slice(0, opts.maxFields);
		warnings.push({ code: 'fields_truncated', message: `Truncated the proposal to ${opts.maxFields} fields` });
	}

	// The UI half: screens become pages of real blocks bound to this collection.
	const ui = designToBlocks(input.dna, { collection: slug });
	warnings.push(...ui.warnings);

	return {
		collection: { slug, name, fields: limited },
		relations,
		warnings,
		...(ui.pages.length ? { pages: ui.pages } : {}),
		dna: input.dna.source,
	};
}

/** A stable content hash of a proposal — the idempotency key for re-submission. */
export function proposalContentKey(proposal: SchemaProposal): string {
	return JSON.stringify(proposal);
}
