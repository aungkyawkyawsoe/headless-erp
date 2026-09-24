import { DatePicker } from '@mmbix/design-system/datepicker';

import { APP_DATE_FORMAT, dateToInputValue, parseDateInput } from '@/shared/time/myanmar';

/**
 * The app's ONE date field: the design-system `DatePicker` (calendar popover on
 * desktop, bottom sheet on mobile) wearing the form-field vocabulary, so it sits
 * in a form at exactly the same height and width as its sibling `Input`s.
 *
 * Why this exists: date fields used to be raw `<input type="date">`, which the
 * browser renders at its own intrinsic height and min-width — visibly shorter
 * than the other fields and, on narrow cards, wider than the card itself. This
 * wrapper removes both, once, for every screen.
 *
 * The value is the STRING the engine stores (`YYYY-MM-DD`), not a `Date`, so
 * call sites keep their plain-`useState<string>` shape and the existing
 * blank-is-untouched submit rules (`...(date ? { field: date } : {})`).
 *
 * TIME pickers deliberately keep the native control — this is dates only.
 */
export function DateField({
	value,
	onChange,
	placeholder = 'Select a date',
	disabled,
	className,
	ariaLabel,
}: {
	/** `YYYY-MM-DD`, or `''` for "not set". */
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	disabled?: boolean;
	/** The form's field vocabulary (height + radius + borders). MUST carry the
	 *  height so the field lines up with the inputs beside it. */
	className?: string;
	ariaLabel?: string;
}) {
	return (
		<DatePicker
			value={parseDateInput(value)}
			onValueChange={(date) => onChange(date ? dateToInputValue(date) : '')}
			placeholder={placeholder}
			format={APP_DATE_FORMAT}
			disabled={disabled}
			className={className}
			aria-label={ariaLabel}
		/>
	);
}
