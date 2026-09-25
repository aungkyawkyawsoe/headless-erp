/**
 * DesignDNA — the only payload a design source may send.
 *
 * Untrusted in, normalized out. The shape deliberately has NO field that can
 * carry markup or code; this normalizer additionally bounds every string and
 * array (DoS) and strips angle brackets from free text, so a smuggled `<script>`
 * cannot survive into a label. Unknown keys are dropped, never forwarded.
 */

import type { DesignComponent, DesignDNA, DesignHint, DesignRelation, DesignScreen, DesignSourceRef, ProposalWarning } from '@mmbix/types';

const PROVIDERS = new Set(['stitch', 'figma', 'manual']);
const MAX_SCREENS = 50;
const MAX_COMPONENTS = 200;
const MAX_HINTS = 50;
const MAX_RELATIONS = 100;
const MAX_ANATOMY = 2_000;
const MAX_LABEL = 200;
const MAX_PALETTE = 64;

export interface DnaParseResult {
	dna: DesignDNA | null;
	warnings: ProposalWarning[];
}

/** Trim, strip markup-significant characters, collapse whitespace, cap length. */
function clean(value: unknown, max: number): string {
	if (typeof value !== 'string') return '';
	return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseSource(raw: unknown, warnings: ProposalWarning[]): DesignSourceRef {
	const o = asObject(raw) ?? {};
	const provider = typeof o.provider === 'string' && PROVIDERS.has(o.provider) ? (o.provider as DesignSourceRef['provider']) : 'manual';
	if (o.provider !== undefined && !PROVIDERS.has(String(o.provider))) {
		warnings.push({ code: 'unknown_provider', message: `Unknown design provider "${String(o.provider)}" — recorded as manual` });
	}
	const ref: DesignSourceRef = { provider };
	const projectId = clean(o.projectId, MAX_LABEL);
	const screenId = clean(o.screenId, MAX_LABEL);
	if (projectId) ref.projectId = projectId;
	if (screenId) ref.screenId = screenId;
	return ref;
}

function parseHint(raw: unknown): DesignHint | null {
	const o = asObject(raw);
	if (!o) return null;
	const label = clean(o.label, MAX_LABEL);
	if (!label) return null;
	const hint: DesignHint = { label };
	const fmt = o.sampleFormat;
	if (
		fmt === 'currency' ||
		fmt === 'date' ||
		fmt === 'phone' ||
		fmt === 'email' ||
		fmt === 'text' ||
		fmt === 'number' ||
		fmt === 'boolean'
	) {
		hint.sampleFormat = fmt;
	}
	return hint;
}

function parseComponent(raw: unknown): DesignComponent | null {
	const o = asObject(raw);
	const kind = clean(o?.kind, MAX_LABEL);
	if (!kind) return null;
	const component: DesignComponent = { kind };
	const label = clean(o?.label, MAX_LABEL);
	if (label) component.label = label;
	if (Array.isArray(o?.hints)) {
		const hints = o.hints
			.map(parseHint)
			.filter((h): h is DesignHint => h !== null)
			.slice(0, MAX_HINTS);
		if (hints.length) component.hints = hints;
	}
	return component;
}

function parseRelation(raw: unknown): DesignRelation | null {
	const o = asObject(raw);
	const from = clean(o?.from, MAX_LABEL);
	const to = clean(o?.to, MAX_LABEL);
	if (!from || !to) return null;
	if (o?.cardinality !== 'one' && o?.cardinality !== 'many') return null;
	const relation: DesignRelation = { from, to, cardinality: o.cardinality };
	const label = clean(o?.label, MAX_LABEL);
	if (label) relation.label = label;
	return relation;
}

function parseScreen(raw: unknown): DesignScreen | null {
	const o = asObject(raw);
	const id = clean(o?.id, MAX_LABEL);
	if (!id) return null;
	const screen: DesignScreen = { id, anatomy: clean(o?.anatomy, MAX_ANATOMY), components: [] };
	if (Array.isArray(o?.components)) {
		screen.components = o.components
			.map(parseComponent)
			.filter((c): c is DesignComponent => c !== null)
			.slice(0, MAX_COMPONENTS);
	}
	if (Array.isArray(o?.relations)) {
		const relations = o.relations
			.map(parseRelation)
			.filter((r): r is DesignRelation => r !== null)
			.slice(0, MAX_RELATIONS);
		if (relations.length) screen.relations = relations;
	}
	return screen;
}

/** Normalize an untrusted payload into a bounded, markup-free `DesignDNA`. */
export function normalizeDesignDNA(input: unknown): DnaParseResult {
	const warnings: ProposalWarning[] = [];
	const o = asObject(input);
	if (!o || !Array.isArray(o.screens)) {
		return { dna: null, warnings: [{ code: 'invalid_dna', message: 'DesignDNA must be an object with a screens array' }] };
	}
	const screens = o.screens
		.map(parseScreen)
		.filter((s): s is DesignScreen => s !== null)
		.slice(0, MAX_SCREENS);
	if (o.screens.length > MAX_SCREENS) warnings.push({ code: 'screens_truncated', message: `Truncated to ${MAX_SCREENS} screens` });
	if (screens.length === 0) return { dna: null, warnings: [{ code: 'empty_dna', message: 'No usable screens in the design payload' }] };

	const dna: DesignDNA = { source: parseSource(o.source, warnings), screens };

	// Tokens are optional and are only ever compared, never written verbatim.
	const tokens = asObject(o.tokens);
	if (tokens) {
		const palette: Record<string, string> = {};
		const rawPalette = asObject(tokens.palette) ?? {};
		for (const [k, v] of Object.entries(rawPalette).slice(0, MAX_PALETTE)) {
			const key = clean(k, 64);
			const val = clean(v, 64);
			if (key && val) palette[key] = val;
		}
		const fonts = asObject(tokens.fonts);
		const spacing = Array.isArray(tokens.spacing)
			? tokens.spacing
					.map((s) => clean(s, 32))
					.filter(Boolean)
					.slice(0, 32)
			: undefined;
		const out: DesignDNA['tokens'] = {};
		if (Object.keys(palette).length) out.palette = palette;
		if (fonts) {
			const heading = clean(fonts.heading, 64);
			const body = clean(fonts.body, 64);
			if (heading || body) out.fonts = { ...(heading ? { heading } : {}), ...(body ? { body } : {}) };
		}
		if (spacing?.length) out.spacing = spacing;
		if (Object.keys(out).length) dna.tokens = out;
	}

	return { dna, warnings };
}
