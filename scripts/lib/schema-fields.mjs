/**
 * Merge a DECLARED collection definition (`schema-defs.json`) into a LIVE field
 * list — the ONE implementation of the rule "the declared definition is
 * authoritative for fields we already have".
 *
 * That rule is what lets a *changed* field be applied (a `required` tightening, a
 * new `display_template`, a different `default`) and not merely a newly ADDed one
 * — the apply script's own field sync only ADDs, so constraint changes ship as a
 * paired one-off script that reuses THIS merge.
 *
 * `retired` names are dropped; anything live-only (the engine's system fields) is
 * preserved — a PUT body that omitted `id` would try to DROP it and roll the
 * whole change back.
 */
export function mergeFields(live, def, retired = []) {
	const declared = new Map((def.fields ?? []).map((f) => [f.name, f]));
	const kept = live.filter((f) => !retired.includes(f?.name));
	const refreshed = kept.map((f) => (declared.has(f?.name) ? { ...f, ...declared.get(f.name) } : f));
	const have = new Set(live.map((f) => f?.name).filter(Boolean));
	const added = (def.fields ?? []).filter((f) => !have.has(f.name));
	return {
		merged: [...refreshed, ...added],
		added: added.map((f) => f.name),
		dropped: retired.filter((n) => have.has(n)),
	};
}
