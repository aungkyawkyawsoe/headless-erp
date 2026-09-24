/**
 * The modules' shared "only the NEWEST record is editable" rule.
 *
 * Every vehicle-record history feed is ordered newest-first (Insurances by
 * expiry, Licenses by issue date, Fluid by effective date, ODO by reading date),
 * so the record at the HEAD of the loaded rows IS the vehicle's current record.
 * Pinned once here so the edit-action wiring and the edit screens' guard cannot
 * disagree.
 */
export function isNewestRecord(rows: ReadonlyArray<{ id: string }>, id: string | null | undefined): boolean {
	return id != null && id !== '' && rows[0]?.id === id;
}
