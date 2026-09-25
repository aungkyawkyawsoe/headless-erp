/**
 * Stitch adapter — REFERENCE, agent-side, disposable.
 *
 * The Worker can never run a `stdio` MCP client, so it never calls Stitch. The
 * AGENT (Claude Code / Workers Agents) is the MCP client: it pulls screens from
 * Stitch and any other design source, normalizes them HERE, and POSTs the
 * resulting `DesignDNA` to `POST /api/generation/propose`.
 *
 * This module is intentionally NOT imported by the plugin — it is a reference
 * mapping the agent (or the CLI) runs in Node. It is exercised only by
 * recorded-fixture tests, so CI is network-free. If Stitch's tool surface
 * changes (R1), only this file changes; the Worker is untouched.
 */

import type { DesignDNA, DesignHint, DesignRelation, DesignScreen } from '@mmbix/types';

/** What the agent extracts from one Stitch screen (tool-name-agnostic). */
export interface StitchScreenFixture {
	id: string;
	/** The Stitch "Anatomy" layer (structure description). */
	anatomy?: string;
	components?: Array<{
		kind: string;
		label?: string;
		hints?: Array<{ label: string; valueFormat?: string }>;
	}>;
	relations?: Array<{ from: string; to: string; cardinality: 'one' | 'many'; label?: string }>;
}

export interface StitchFixture {
	projectId?: string;
	screens: StitchScreenFixture[];
}

/** The value formats the design source may declare; anything else is dropped. */
const FORMATS = new Set(['currency', 'date', 'phone', 'email', 'text', 'number', 'boolean']);
type SampleFormat = NonNullable<DesignHint['sampleFormat']>;

/** Map a recorded Stitch fixture onto the vendor-agnostic `DesignDNA` contract. */
export function stitchToDesignDNA(fixture: StitchFixture): DesignDNA {
	const screens: DesignScreen[] = fixture.screens.map((screen) => {
		const relations: DesignRelation[] | undefined = screen.relations?.map((r) => ({
			from: r.from,
			to: r.to,
			cardinality: r.cardinality,
			...(r.label ? { label: r.label } : {}),
		}));
		return {
			id: screen.id,
			anatomy: screen.anatomy ?? '',
			components: (screen.components ?? []).map((component) => ({
				kind: component.kind,
				...(component.label ? { label: component.label } : {}),
				...(component.hints?.length
					? {
							hints: component.hints.map((h) => {
								const fmt = h.valueFormat;
								return FORMATS.has(fmt ?? '') ? { label: h.label, sampleFormat: fmt as SampleFormat } : { label: h.label };
							}),
						}
					: {}),
			})),
			...(relations?.length ? { relations } : {}),
		};
	});
	return { source: { provider: 'stitch', ...(fixture.projectId ? { projectId: fixture.projectId } : {}) }, screens };
}
