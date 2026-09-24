/** "1,200" / "1,200.5" — count display, no trailing zeros. */
export function formatCount(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return '—';
	return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "5 Sep 2026" — the effective date in English, '—' when unset. */
export function dateLabel(date: string | null): string {
	if (!date) return '—';
	const day = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(day.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(day);
}

/**
 * WHY a draft goods-issue can NOT be confirmed — null when it can. A goods issue
 * backed by a SOURCE REQUEST that is already CLOSED (`fulfilled` / `cancelled`)
 * can never confirm: the server refuses it (no double issue onto a closed
 * request), so the Confirm verb is disabled with THIS reason up front
 * (Poka-Yoke) instead of failing on submit. Mirrors the guard in
 * `InventoryService.confirmOutbound`.
 */
export function sourceRequestClosedReason(requisitionStatus: string | null | undefined, label: string | null | undefined): string | null {
	if (requisitionStatus !== 'fulfilled' && requisitionStatus !== 'cancelled') return null;
	return `Source request${label ? ` ${label}` : ''} is ${requisitionStatus} — no further issues are allowed.`;
}
