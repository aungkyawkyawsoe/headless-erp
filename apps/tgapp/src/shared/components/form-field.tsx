import { useId, type ReactNode } from 'react';

import { FIELD_LABEL_CLASS } from './form-styles';
import { RequiredMark } from './required-mark';

/**
 * The DOM props a `FormField` hands to its control — spread straight onto a
 * standard element (`<Input {...f} />`, `<textarea {...f} />`).
 *
 * Deliberately DOM-SAFE: it carries ONLY real attributes, so a spread can never
 * leak a React warning (an extra `ariaLabel` key here would land on the element
 * as the invalid attribute `arialabel`).
 */
export interface FormFieldApi {
	id: string;
	'aria-describedby': string | undefined;
	'aria-invalid': true | undefined;
	'aria-required': true | undefined;
}

/** Non-DOM helpers — passed as the SECOND render-prop argument, never spread. */
export interface FormFieldHelpers {
	/** The label as a plain string, for controls whose name is a PROP rather than
	 *  DOM wiring (`DateField`, `ProviderField`). */
	ariaLabel: string | undefined;
}

interface FormFieldProps {
	/** The visible label text. */
	label: ReactNode;
	/** Renders the red `*` AND sets `aria-required` on the control. */
	required?: boolean;
	/** Helper text under the control (hidden while `error` is shown, so the two
	 *  never stack and the field's height stays predictable). */
	hint?: ReactNode;
	/** The FIELD-LEVEL error — rendered inline, announced, and referenced by the
	 *  control's `aria-describedby`. */
	error?: string | null;
	/** Overrides the string used for `api.ariaLabel` when `label` is a node. */
	ariaLabel?: string;
	/** The control is a GROUP (a segmented toggle, a radio row), not one input:
	 *  render the label as a group caption wired by `aria-labelledby` instead of
	 *  an `htmlFor` that would point at nothing (WCAG 1.3.1). */
	group?: boolean;
	className?: string;
	/** Override the caption's style where the surrounding layout needs a more
	 *  compact label (e.g. an in-card section). The ASSOCIATION is unaffected —
	 *  this is presentation only, so a11y cannot be lost by changing it. */
	labelClassName?: string;
	/** An affordance sharing the caption's ROW, pinned to its RIGHT edge — for a
	 *  field whose value can be read elsewhere (“Balance” beside “Photo”). Rendered
	 *  as the caption's SIBLING, never inside it: the caption stays the field's
	 *  accessible name, so the group cannot end up answering to “Photo Balance”. */
	action?: ReactNode;
	/** Renders the control with the wiring above. `helpers` is NOT spreadable —
	 *  see `FormFieldHelpers`. */
	children: (api: FormFieldApi, helpers: FormFieldHelpers) => ReactNode;
}

/**
 * The app's ONE form field: a label PROGRAMMATICALLY associated with its control,
 * an optional required marker, and an inline, announced error.
 *
 * Why it exists: across ~25 forms every field was hand-rolled as
 * `<label className="…">Text</label>` followed by an un-`id`ed control. That
 * meant (a) the input had NO accessible name — a placeholder is not a label
 * (WCAG 3.3.2 / 4.1.2), (b) tapping the label did not focus the field, and
 * (c) a validation failure surfaced only as ONE banner at the bottom of the
 * form, with no `aria-invalid`, no `aria-describedby` and no indication of
 * WHICH field was wrong (WCAG 3.3.1).
 *
 * A render-prop (not `cloneElement`) because the controls vary: standard inputs
 * take DOM props, while `DateField`/`ProviderField` take a single label prop —
 * each call site spreads exactly what its control understands.
 *
 *   <FormField label="Policy no" required error={errors.policyNo}>
 *     {(f) => <Input {...f} value={policyNo} onChange={…} />}
 *   </FormField>
 *
 *   <FormField label="Expiry date">
 *     {(f, h) => <DateField ariaLabel={h.ariaLabel} value={expiry} … />}
 *   </FormField>
 */
export function FormField({
	label,
	required,
	hint,
	error,
	ariaLabel,
	group = false,
	className,
	labelClassName,
	action,
	children,
}: FormFieldProps) {
	// `useId` is stable across renders AND unique per instance (SSR-safe), so a
	// field added/removed mid-form can never steal another field's association.
	// Colons are stripped: they are legal in an id but need escaping in a CSS
	// selector, and nothing here should have to know that.
	const rawId = useId();
	const id = `f${rawId.replace(/:/g, '')}`;
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const describedBy = [hint ? hintId : null, error ? errorId : null].filter((x): x is string => x !== null).join(' ') || undefined;

	const api: FormFieldApi = {
		id,
		'aria-describedby': describedBy,
		'aria-invalid': error ? true : undefined,
		'aria-required': required ? true : undefined,
	};
	const helpers: FormFieldHelpers = { ariaLabel: ariaLabel ?? (typeof label === 'string' ? label : undefined) };

	const captionId = `${id}-caption`;
	const captionClass = labelClassName ?? FIELD_LABEL_CLASS;

	const caption = group ? (
		<span id={captionId} className={captionClass}>
			{label}
			{required ? <RequiredMark /> : null}
		</span>
	) : (
		<label htmlFor={id} className={captionClass}>
			{label}
			{required ? <RequiredMark /> : null}
		</label>
	);

	return (
		<div className={className ?? 'flex min-w-0 flex-col'}>
			{/* An action shares the caption's row but never its ELEMENT — the caption
			    keeps naming the field (`htmlFor` / `aria-labelledby`), so “Balance”
			    cannot leak into the accessible name. Baseline alignment puts the two on
			    one text line, and the caption's own bottom margin still sets the gap to
			    the control, so a plain field's geometry is untouched. */}
			{action ? (
				<div className="flex items-baseline justify-between gap-2">
					{caption}
					{action}
				</div>
			) : (
				caption
			)}
			{group ? (
				<div role="group" aria-labelledby={captionId}>
					{children(api, helpers)}
				</div>
			) : (
				children(api, helpers)
			)}
			{hint && !error ? (
				<p id={hintId} className="mt-1 text-meta leading-myanmar text-muted-foreground">
					{hint}
				</p>
			) : null}
			{error ? (
				<p id={errorId} role="alert" className="mt-1 text-meta font-medium leading-myanmar text-status-danger">
					{error}
				</p>
			) : null}
		</div>
	);
}
