/**
 * Red required-field marker (*) — appended to the label of every mandatory
 * field in the request create forms (`.../+`). `aria-hidden`: the labels
 * already name the field; the asterisk is a visual cue only, matching the
 * form-level error red (`text-destructive`).
 */
export function RequiredMark() {
	return (
		<span aria-hidden className="ml-0.5 text-destructive">
			*
		</span>
	);
}
