/**
 * Generation view logic — pure, unit-tested. The panel only renders this.
 *
 * The human gate is a state, so the actions a screen offers must be derived from
 * the proposal's state (never hard-coded), and the inference confidence must be
 * legible at a glance.
 */

import type { ProposalStatus, SchemaProposal } from '@mmbix/types';

export type GenerationAction = 'submit' | 'approve' | 'reject' | 'apply';

/** The actions legal in a given state — mirrors the backend transition table. */
export function nextGenerationActions(status: ProposalStatus, requireReview: boolean): GenerationAction[] {
	switch (status) {
		case 'draft':
			// A collection that opted out of review can be applied straight away;
			// otherwise it must be submitted first.
			return requireReview ? ['submit', 'reject'] : ['submit', 'reject', 'apply'];
		case 'review':
			return ['approve', 'reject'];
		case 'promoted':
			return ['apply'];
		default:
			return []; // live / rejected are terminal
	}
}

/** 0 heuristic → low, 1 rules → medium, 2 declared → high. */
export function confidenceTone(confidence: number): 'low' | 'medium' | 'high' {
	if (confidence >= 2) return 'high';
	if (confidence >= 1) return 'medium';
	return 'low';
}

export interface ProposalSummary {
	fields: number;
	declared: number;
	rules: number;
	heuristic: number;
	relations: number;
	warnings: number;
	/** The UI half: proposed pages and their total blocks (0 when the design had no mappable component). */
	pages: number;
	blocks: number;
}

/** A compact, UI-facing summary of a proposal (data-ink ratio: counts only). */
export function summarizeProposal(proposal: SchemaProposal): ProposalSummary {
	let declared = 0;
	let rules = 0;
	let heuristic = 0;
	for (const f of proposal.collection.fields) {
		switch (f.inference.source) {
			case 'declared':
				declared++;
				break;
			case 'llm':
				heuristic++;
				break;
			default:
				if (f.inference.confidence === 0) heuristic++;
				else rules++;
		}
	}
	const pages = proposal.pages ?? [];
	return {
		fields: proposal.collection.fields.length,
		declared,
		rules,
		heuristic,
		relations: proposal.relations.length,
		warnings: proposal.warnings.length,
		pages: pages.length,
		blocks: pages.reduce((n, p) => n + p.blocks.length, 0),
	};
}

/**
 * A compact list of the block types the proposal's pages use — unique and
 * bounded, so the gate can see WHAT UI it is about to create without reading a
 * tree (data-ink: `table, kpi +2`).
 */
export function blockTypeSummary(proposal: SchemaProposal, max = 4): string {
	const types = [
		...new Set((proposal.pages ?? []).flatMap((p) => p.blocks.map((b) => String((b as { type?: unknown }).type ?? ''))).filter(Boolean)),
	];
	const shown = types.slice(0, max).join(', ');
	return types.length > max ? `${shown} +${types.length - max}` : shown;
}
