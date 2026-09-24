/** Human message from a thrown value or a Query error, or null when there is none. */
export function messageOf(e: unknown): string | null {
	if (!e) return null;
	return e instanceof Error ? e.message : String(e);
}
