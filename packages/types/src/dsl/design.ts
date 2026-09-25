/**
 * Design-generation contracts — the vocabulary the factory uses to turn a
 * design source or a prompt into a reviewable schema proposal.
 *
 * These live in `@mmbix/types` so the Worker, the Studio and the SDK share ONE
 * definition. They are DATA ONLY: nothing here can carry markup or executable
 * code, and every inferred field type is a member of the field-type SSOT
 * (`@mmbix/utils` `VALID_FIELD_TYPES`).
 */

import type { FieldType } from '../entity';

/** Where a design came from — provenance, copied onto whatever it creates. */
export type DesignProvider = 'stitch' | 'figma' | 'manual' | 'none';

export interface DesignSourceRef {
	provider: DesignProvider;
	projectId?: string;
	screenId?: string;
}

/** A single observed hint on a design component — text only, never markup. */
export interface DesignHint {
	label: string;
	/** The value shape the designer used, when known. */
	sampleFormat?: 'currency' | 'date' | 'phone' | 'email' | 'text' | 'number' | 'boolean';
}

/** One component placed on a screen (a table, a form, a stat card, …). */
export interface DesignComponent {
	/** e.g. 'table' | 'form' | 'stat-card' | 'header'. */
	kind: string;
	label?: string;
	hints?: DesignHint[];
}

/** A relation the design implies (an order has many lines, a line has one item). */
export interface DesignRelation {
	from: string;
	to: string;
	cardinality: 'one' | 'many';
	label?: string;
}

export interface DesignScreen {
	id: string;
	/** The "Anatomy" layer of a structured design prompt. */
	anatomy: string;
	components: DesignComponent[];
	relations?: DesignRelation[];
}

/**
 * The design source's ONLY payload.
 *
 * Poka-yoke: there is deliberately no field that can carry markup — a design
 * tool's raw HTML/CSS cannot enter the factory by construction, only tokens,
 * labels and format hints.
 */
export interface DesignDNA {
	source: DesignSourceRef;
	tokens?: {
		/** semantic name → value, mapped onto the design-tokens SSOT on approval. */
		palette?: Record<string, string>;
		fonts?: { heading?: string; body?: string };
		spacing?: string[];
	};
	screens: DesignScreen[];
}

/** Why a field got its type — the human gate reviews THIS, not the raw design. */
export interface FieldInference {
	/** 0 heuristic/fallback · 1 rules-high · 2 declared. */
	confidence: 0 | 1 | 2;
	reason: string;
	source: 'rule' | 'declared' | 'llm';
}

export interface FieldProposal {
	/** Sanitized identifier (never a raw design label). */
	name: string;
	type: FieldType;
	required: boolean;
	inference: FieldInference;
	/** Present for relation types (`m2o`/`o2m`/`m2m`): the related collection slug. */
	related_collection?: string;
}

/** A relation surfaced for review — the part scalar inference cannot see. */
export interface RelationProposal {
	from: string;
	to: string;
	cardinality: 'one' | 'many';
	confidence: 0 | 1 | 2;
	reason: string;
}

export interface ProposalWarning {
	code: string;
	message: string;
}

/** Deterministic output of the mapping stage. Same DNA ⇒ same proposal. */
export interface SchemaProposal {
	collection: { slug: string; name: string; fields: FieldProposal[] };
	relations: RelationProposal[];
	warnings: ProposalWarning[];
	/** Lineage, copied onto the created collection when the proposal goes live. */
	dna?: DesignSourceRef;
}

/** Review states for a proposal — the human gate is a STATE, not a prompt. */
export type ProposalStatus = 'draft' | 'review' | 'promoted' | 'live' | 'rejected';
