/**
 * ONE status → tone map for the whole Studio (Single Source of Truth).
 *
 * A status string collapses to a small semantic tone. Colour is preattentive, so
 * the SAME status must read the SAME everywhere — before this there were ~5
 * divergent status→colour maps that disagreed on `live`, `review`, `pending`, …
 * (one drew `live` green, another teal, a third blue). Rendering lives in
 * `components/StatusBadge.tsx`, which maps a tone to the deployment's
 * `--mmbix-tone-<tone>-*` design tokens (see `studio.css` + `lib/tenant-theme.ts`).
 *
 * This module is pure (no React, no DOM) so the mapping is unit-tested.
 */

export type StatusTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger';

/** Every tone, in a stable order — the full case space (MECE). */
export const STATUS_TONES: readonly StatusTone[] = ['neutral', 'info', 'positive', 'warning', 'danger'];

/**
 * The design-token variables that carry a tone's pill colours. A tenant's
 * effective tokens can define these (e.g. token key `tone-positive-bg`), so the
 * palette is restylable without a redeploy; the values themselves live in
 * `studio.css` for light + dark.
 */
export function toneVars(tone: StatusTone): { color: string; background: string; borderColor: string } {
	return {
		color: `var(--mmbix-tone-${tone}-fg)`,
		background: `var(--mmbix-tone-${tone}-bg)`,
		borderColor: `var(--mmbix-tone-${tone}-border)`,
	};
}

/** Lowercase + unify separators, so `Rolled Back`, `rolled-back`, `ROLLED_BACK` all match. */
function normalize(status: string | null | undefined): string {
	return (status ?? '')
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
}

/**
 * The canonical status vocabulary → tone. Keys are normalized (see `normalize`).
 * Deliberately explicit rather than a prefix/substring guess: a typo or an
 * unknown status must fall to `neutral` (no colour claimed), never silently
 * match the wrong family.
 */
const TONE_BY_STATUS: Record<string, StatusTone> = {
	// positive — a good, settled state
	live: 'positive',
	active: 'positive',
	approved: 'positive',
	published: 'positive',
	done: 'positive',
	complete: 'positive',
	completed: 'positive',
	success: 'positive',
	succeeded: 'positive',
	ok: 'positive',
	pass: 'positive',
	passed: 'positive',
	installed: 'positive',
	enabled: 'positive',
	healthy: 'positive',
	ready: 'positive',
	// info — in motion / informational
	running: 'info',
	in_progress: 'info',
	processing: 'info',
	submitted: 'info',
	promoted: 'info',
	queued: 'info',
	deployed: 'info',
	// warning — needs attention, not yet a failure
	review: 'warning',
	pending_review: 'warning',
	pending: 'warning',
	warning: 'warning',
	warn: 'warning',
	paused: 'warning',
	on_hold: 'warning',
	degraded: 'warning',
	attention: 'warning',
	// danger — a failed / terminal-bad state
	failed: 'danger',
	fail: 'danger',
	error: 'danger',
	rejected: 'danger',
	cancelled: 'danger',
	canceled: 'danger',
	rolled_back: 'danger',
	disabled: 'danger',
	blocked: 'danger',
	revoked: 'danger',
	denied: 'danger',
	expired: 'danger',
	overdue: 'danger',
	// neutral — no state / unknown
	draft: 'neutral',
	unknown: 'neutral',
	archived: 'neutral',
	inactive: 'neutral',
	none: 'neutral',
	not_installed: 'neutral',
	uninstalled: 'neutral',
	closed: 'neutral',
};

/** The tone for a status string; an unknown/blank status is `neutral`. */
export function statusTone(status: string | null | undefined): StatusTone {
	return TONE_BY_STATUS[normalize(status)] ?? 'neutral';
}
