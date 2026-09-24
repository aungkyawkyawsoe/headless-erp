/**
 * Device copies of the MASTER DIRECTORIES (vehicles, SKUs, item names,
 * categories) — a tiny localStorage snapshot so a returning app open paints its
 * lookups INSTANTLY from the device instead of waiting a full network round trip
 * before the first row. The read still revalidates in the background, so a stale
 * seed is corrected within the master window.
 *
 * WHY THIS IS ALLOWED for these collections (and NOT a general read cache): the
 * server already blesses exactly these reads for device storage — their
 * `schema_json.policies.offline_reads.enabled` is on, which is the SAME
 * deny-by-default policy the SDK's persisted read cache obeys. Nothing here is
 * user-scoped row data.
 *
 * Entries are SCOPED to the signed-in session (a short non-reversible token
 * fingerprint), mirroring the SDK's device-copy scoping, and cleared on sign-out
 * — a shared phone never serves one account's device copies to the next.
 */
import { getToken } from '@/shared/auth';

/** Bump when a stored shape changes — old entries are simply ignored. */
const NAMESPACE = 'mmbix.masters.v2';

export interface PersistedMasters<T> {
	/** Epoch ms the snapshot was written — seeds react-query's `dataUpdatedAt`. */
	at: number;
	data: T;
}

/** Short, non-reversible fingerprint of the current session token. */
function scopeKey(): string {
	const token = getToken();
	if (!token) return 'anon';
	let h = 2166136261;
	for (let i = 0; i < token.length; i++) {
		h ^= token.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

const storageKey = (name: string) => `${NAMESPACE}:${name}:${scopeKey()}`;

/** The stored snapshot for a directory, or undefined (absent / unreadable). */
export function readPersistedMasters<T>(name: string): PersistedMasters<T> | undefined {
	try {
		const raw = localStorage.getItem(storageKey(name));
		if (!raw) return undefined;
		const parsed = JSON.parse(raw) as PersistedMasters<T>;
		return parsed && typeof parsed.at === 'number' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Persist a directory snapshot. Best-effort — private mode / quota never throws. */
export function writePersistedMasters<T>(name: string, data: T): void {
	try {
		localStorage.setItem(storageKey(name), JSON.stringify({ at: Date.now(), data }));
	} catch {
		/* storage full or unavailable — the network read still works */
	}
}

/** Drop every device copy (sign-out / token clear). */
export function clearPersistedMasters(): void {
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const key = localStorage.key(i);
			if (key && key.startsWith(`${NAMESPACE}:`)) localStorage.removeItem(key);
		}
	} catch {
		/* ignore */
	}
}
