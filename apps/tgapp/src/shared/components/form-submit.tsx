import type { ReactNode } from 'react';

/**
 * The ONE form-level error note — a failed save stated once, identically.
 *
 * Before this, forms rendered FOUR different error treatments (a boxed
 * destructive card, a soft status token, plain text, a 2xs line). This is the
 * status-token treatment, which matches the engine's own error semantics.
 * Renders nothing when there is no error, so callers can drop it in
 * unconditionally.
 */
export function FormError({ error, className }: { error?: string | null; className?: string }) {
	if (!error) return null;
	return (
		<p
			role="alert"
			className={`rounded-md bg-status-danger-soft px-3 py-2 text-xs font-medium leading-myanmar text-status-danger ${className ?? ''}`}
		>
			{error}
		</p>
	);
}

interface FormSubmitBarProps {
	/** The button label (e.g. "Save policy"). */
	label: string;
	/** Click handler (for `type="button"`; a `type="submit"` button uses the
	 *  enclosing `<form onSubmit>` instead). */
	onSubmit?: () => void;
	/** True when the native Telegram MainButton is showing — then the in-page
	 *  fallback MUST NOT render (never both, the `useTelegramMainButton` rule). */
	isMainButton: boolean;
	disabled?: boolean;
	submitting?: boolean;
	/** The label shown while submitting (default "Saving…"). */
	submittingLabel?: string;
	/** An optional leading icon (e.g. a check mark). */
	icon?: ReactNode;
	/** `submit` inside a `<form onSubmit>` keeps Enter-to-submit; `button` for the
	 *  div-based create pages. Defaults to `button`. */
	type?: 'button' | 'submit';
	/** Optional wrapper class — e.g. the create pages' `pb-safe pt-1` bottom inset. */
	wrapClassName?: string;
}

/**
 * The ONE form save action — a full-width button that hides itself whenever the
 * native MainButton is up.
 *
 * Every form previously hand-rolled this button (two competing sizes/radii) and
 * its own `{!isMainButton && …}` wrapper. Centralizing it makes the save look
 * identical on every screen and removes the duplicated class strings.
 */
export function FormSubmitBar({
	label,
	onSubmit,
	isMainButton,
	disabled,
	submitting,
	submittingLabel = 'Saving…',
	icon,
	type = 'button',
	wrapClassName,
}: FormSubmitBarProps) {
	if (isMainButton) return null;
	const button = (
		<button
			type={type}
			onClick={type === 'button' ? onSubmit : undefined}
			disabled={Boolean(disabled) || Boolean(submitting)}
			className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-foreground px-4 py-3.5 text-base font-semibold leading-myanmar text-background shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100"
		>
			{icon}
			{submitting ? submittingLabel : label}
		</button>
	);
	return wrapClassName ? <div className={wrapClassName}>{button}</div> : button;
}
