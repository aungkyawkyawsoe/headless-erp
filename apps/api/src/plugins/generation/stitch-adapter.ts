/**
 * Stitch adapter — REFERENCE, agent-side, disposable.
 *
 * The Worker can never run a `stdio` MCP client, so it never calls Stitch. The
 * AGENT (Claude Code / Workers Agents) is the MCP client: it pulls screens from
 * Stitch and any other design source, normalizes them HERE, and POSTs the
 * resulting `DesignDNA` to `POST /api/generation/propose`.
 *
 * The REAL Stitch chain (verified against the hosted server) is:
 *   `list_projects` → `get_project { name }` → `list_screens { projectId }` →
 *   `get_screen { name }`.
 * A screen is `{ name, title, deviceType, width, height, htmlCode, screenshot }`,
 * where `htmlCode` is NOT the markup — it is a `{ downloadUrl, mimeType }` FILE
 * REFERENCE, so the agent must FETCH `htmlCode.downloadUrl` (text/html) to read
 * the design; `screenshot.downloadUrl` is the rendered image. There is no
 * `anatomy` field on the wire: `anatomy`/`components` in the fixture below are
 * AGENT-AUTHORED from the fetched HTML + screenshot, which is why the adapter
 * only maps the structural fields and leaves the reading to judgment. (The HTML
 * is a styled mockup, so a tag-scraping extractor yields little — the screen is
 * compiled by the agent, not by a regex.)
 *
 * This module is intentionally NOT imported by the plugin — it is a reference
 * mapping the agent (or the CLI) runs in Node. It is exercised only by
 * recorded-fixture tests, so CI is network-free. If Stitch's tool surface
 * changes (R1), only this file changes; the Worker is untouched.
 */

import type { DesignDNA, DesignHint, DesignRelation, DesignScreen } from '@mmbix/types';

/** The structural fields of a real Stitch `get_screen` result (post-fetch refs). */
export interface StitchScreenRef {
	/** The screen id (last segment of `name`). */
	id: string;
	title: string;
	deviceType?: string;
	/** `htmlCode.downloadUrl` — fetch this to read the design (text/html). */
	htmlUrl?: string;
	/** `screenshot.downloadUrl` — the rendered image. */
	screenshotUrl?: string;
}

/** Read the STRUCTURAL fields off a real `get_screen` payload. Never guesses. */
export function stitchScreenRef(screen: unknown): StitchScreenRef | null {
	const s = screen && typeof screen === 'object' && !Array.isArray(screen) ? (screen as Record<string, unknown>) : null;
	if (!s) return null;
	const name = typeof s.name === 'string' ? s.name : '';
	const id = name.split('/').filter(Boolean).pop();
	if (!id) return null;
	const urlOf = (v: unknown): string | undefined => {
		const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
		return typeof o?.downloadUrl === 'string' && o.downloadUrl ? o.downloadUrl : undefined;
	};
	return {
		id,
		title: typeof s.title === 'string' ? s.title : id,
		...(typeof s.deviceType === 'string' ? { deviceType: s.deviceType } : {}),
		...(urlOf(s.htmlCode) ? { htmlUrl: urlOf(s.htmlCode) as string } : {}),
		...(urlOf(s.screenshot) ? { screenshotUrl: urlOf(s.screenshot) as string } : {}),
	};
}

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
