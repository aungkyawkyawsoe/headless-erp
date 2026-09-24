'use client';

/**
 * Best-effort localStorage persistence for column layout state
 * (visibility / order / pinning). Sizing is intentionally NOT persisted —
 * it is measured live by the pinned-column sync.
 */

export interface PersistedColumnState {
	visibility: Record<string, boolean>;
	order: string[];
	pinning: { start: string[]; end: string[] };
}

/** Internal envelope — adds the column-set fingerprint used for validation. */
interface PersistedEnvelope extends PersistedColumnState {
	/** Fingerprint of the column set this layout was saved against. */
	ids?: string[];
}

const STORAGE_PREFIX = 'mmbix:datatable:';

function storage(): Storage | null {
	try {
		return typeof window !== 'undefined' ? window.localStorage : null;
	} catch {
		// localStorage disabled (privacy mode) — persistence is best-effort
		return null;
	}
}

/**
 * Read + sanitize persisted column state against the current column set.
 * Unknown column ids (schema changed, columns removed) are dropped; returns
 * `null` when nothing is persisted or the payload is malformed.
 */
export function loadPersistedColumnState(key: string, columnIds: string[]): PersistedColumnState | null {
	if (!key) return null;
	const s = storage();
	if (!s) return null;

	let raw: unknown;
	try {
		raw = JSON.parse(s.getItem(STORAGE_PREFIX + key) ?? 'null');
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object') return null;

	const known = new Set(columnIds);
	const r = raw as Partial<PersistedEnvelope>;

	// Order is only honored when it is an EXACT permutation of the current
	// column set. Anything else (legacy payload without `ids`, a layout saved
	// against an older/changed schema, hand-edited storage) is stale — drop it
	// so columns render in their canonical definition order instead of a
	// resurrected order that can put e.g. status first.
	let order: string[] = [];
	if (
		Array.isArray(r.ids) &&
		r.ids.length === columnIds.length &&
		r.ids.every((id) => known.has(id)) &&
		Array.isArray(r.order) &&
		r.order.length === columnIds.length &&
		r.order.every((id) => typeof id === 'string' && known.has(id))
	) {
		order = r.order;
	}

	const visibility: Record<string, boolean> = {};
	if (r.visibility && typeof r.visibility === 'object') {
		for (const [id, v] of Object.entries(r.visibility)) {
			if (known.has(id)) visibility[id] = v === true;
		}
	}

	const pinning: PersistedColumnState['pinning'] = { start: [], end: [] };
	if (r.pinning && typeof r.pinning === 'object') {
		const raw = r.pinning as Record<string, unknown>;
		for (const side of ['start', 'end'] as const) {
			// `left`/`right` were renamed to `start`/`end` in TanStack v9 — read
			// the legacy keys too so pre-upgrade layouts keep their pinning.
			const arr = raw[side] ?? raw[side === 'start' ? 'left' : 'right'];
			if (Array.isArray(arr)) pinning[side] = arr.filter((id): id is string => typeof id === 'string' && known.has(id));
		}
	}

	return { order, visibility, pinning };
}

/** Write the current column layout state (best-effort). */
export function savePersistedColumnState(key: string, state: PersistedColumnState): void {
	if (!key) return;
	const s = storage();
	if (!s) return;
	try {
		s.setItem(STORAGE_PREFIX + key, JSON.stringify({ ...state, ids: state.order }));
	} catch {
		// quota exceeded / private mode — ignore
	}
}
