/**
 * Myanmar-time (MMT, UTC+6:30) display + edit helpers for `datetime`/`timestamp`
 * fields. Stored values are UTC instants; the Studio is a shared admin surface,
 * so every operator must read the SAME wall clock — MMT is a fixed offset, so a
 * +6:30 shift is deterministic (unlike `toLocaleString`, which varies with the
 * viewer's machine). The offset is imported from `@mmbix/utils` — the ONE
 * definition the API and the mini app share; never re-declare 6.5 h.
 *
 * `date` and `time` fields are deliberately NOT handled here: they are calendar
 * values (`YYYY-MM-DD`, `HH:MM`) with no timezone, so a shift would corrupt them.
 */
import { MMT_OFFSET_MS } from '@mmbix/utils';

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * The stored UTC instant as epoch ms. Accepts the shapes the engine actually
 * writes:
 *  - ISO-8601 with explicit `Z`: `2026-09-23T04:30:00.000Z`
 *  - SQLite `CURRENT_TIMESTAMP`: `2026-09-23 04:30:00` (UTC, NO zone marker)
 *  - unzoned `YYYY-MM-DDTHH:MM[:SS]` (what the engine stores verbatim)
 * The two unzoned shapes are treated as UTC — matching how they were written and
 * how the system timestamps have always been read. `Date.parse` alone would read
 * them as LOCAL time and shift every row by the operator's offset. NaN when the
 * value cannot be parsed; callers fall back to the raw text.
 */
export function epochOf(value: string): number {
	const unzoned = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(value);
	if (unzoned) return Date.parse(`${unzoned[1]}T${unzoned[2]}Z`);
	return Date.parse(value);
}

/** `YYYY-MM-DD HH:mm` in Myanmar time — the Studio's fixed datetime cell shape.
 *  `—` for an empty value; the raw text when the stored value is unparsable
 *  (never blank out a real, if odd, row). */
export function formatDatetimeMmt(value: string | null | undefined): string {
	if (value === null || value === undefined || value === '') return '—';
	const ms = epochOf(value);
	if (Number.isNaN(ms)) return value;
	const mmt = new Date(ms + MMT_OFFSET_MS);
	return `${mmt.getUTCFullYear()}-${pad2(mmt.getUTCMonth() + 1)}-${pad2(mmt.getUTCDate())} ${pad2(mmt.getUTCHours())}:${pad2(mmt.getUTCMinutes())}`;
}

/** Stored UTC datetime → the MMT calendar day as a LOCAL-midnight `Date` (what
 *  the design-system DatePicker renders). `undefined` when empty/unparsable. */
export function mmtDateOf(value: unknown): Date | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	const ms = epochOf(String(value));
	if (Number.isNaN(ms)) return undefined;
	const mmt = new Date(ms + MMT_OFFSET_MS);
	return new Date(mmt.getUTCFullYear(), mmt.getUTCMonth(), mmt.getUTCDate());
}

/** Stored UTC datetime → the MMT `HH:MM` the TimePicker edits. `''` when empty. */
export function mmtTimeOf(value: unknown): string {
	if (value === null || value === undefined || value === '') return '';
	const ms = epochOf(String(value));
	if (Number.isNaN(ms)) return '';
	const mmt = new Date(ms + MMT_OFFSET_MS);
	return `${pad2(mmt.getUTCHours())}:${pad2(mmt.getUTCMinutes())}`;
}

/** MMT calendar `YYYY-MM-DD` + `HH:MM` → the UTC instant ISO string to store
 *  (explicit `Z`, so a row's meaning never depends on the reader's timezone). */
export function toUtcDatetime(ymd: string, time: string): string {
	const [y, m, d] = ymd.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	const mmtMs = Date.UTC(y, m - 1, d, hh, mm);
	return new Date(mmtMs - MMT_OFFSET_MS).toISOString();
}
