/** Null-safe decimal (unit price/cost). */
export function moneyOrNull(v: unknown): number | null {
	if (v === undefined || v === null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}
