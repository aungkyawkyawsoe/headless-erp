import { useCallback, useEffect, useMemo, useRef } from 'react';

/** What a form body reports to the sheet header (the ✓ button). */
export interface FormState {
	submit: () => void;
	canSubmit: boolean;
	submitting: boolean;
	/** Hide the Telegram MainButton — e.g. while a bottom sheet covers the submit affordance. */
	hideMainButton: boolean;
	/**
	 * The form differs from its baseline (the loaded record for an edit, the empty
	 * defaults for a create). The submit affordance is disabled until this is true,
	 * so re-saving an unchanged record — or submitting an untouched create — is
	 * impossible by construction. Defaults to `true` (never blocks) for callers
	 * that have no baseline concept.
	 */
	dirty: boolean;
}

/** The no-op state a sheet starts with before any body reports. */
export const DEFAULT_FORM_STATE: FormState = {
	submit: () => undefined,
	canSubmit: false,
	submitting: false,
	hideMainButton: false,
	dirty: true,
};

/**
 * Structural equality for the small value bags a form compares against its
 * baseline. Handles primitives, `Date`, arrays and plain objects; anything else
 * (a `File`, a class instance) falls back to reference equality. The repo ships
 * no equality dependency (`lodash.isequal` is absent) and the field sets are
 * tiny, so a purpose-built walk is cheaper than pulling one in.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a instanceof Date || b instanceof Date) {
		return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((v, i) => valuesEqual(v, b[i]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const ka = Object.keys(a);
		if (ka.length !== Object.keys(b).length) return false;
		return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && valuesEqual(a[k], b[k]));
	}
	return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && (Object.getPrototypeOf(v) as unknown) === Object.prototype;
}

/**
 * True when the form's `current` values differ from its `baseline`.
 *
 * `baseline` MUST be derived from the SOURCE — the loaded record for an edit, the
 * empty defaults for a create — never captured from rendered state. Several edit
 * forms seed from a cached row and then re-seed from the fresh row
 * (`item-form.tsx`, `request-form-body.tsx`); a baseline captured at mount would
 * read the re-seed as an edit. Pass `{}` (or the empty field defaults) on create
 * so a prefilled create is still "dirty" and therefore submittable.
 */
export function useFormDirty(baseline: unknown, current: unknown): boolean {
	return !valuesEqual(baseline, current);
}

/**
 * A synchronous in-flight latch for a submit handler.
 *
 * `submitting` state alone is a Poka-Yoke gap: a second tap (or the native
 * Telegram MainButton, whose disabled state is mirrored one effect LATER) can
 * fire before React re-renders, so both handlers read `submitting === false`
 * and both write — a duplicate record. The latch flips in the same synchronous
 * call, so the second tap is a no-op however the events interleave.
 *
 * Call `begin()` at the top of the handler (it returns false when a write is
 * already in flight), and `end()` on failure. Success normally navigates away
 * and unmounts the form, so there is nothing to release.
 */
export function useSubmitGuard(): { begin: () => boolean; end: () => void } {
	const inFlight = useRef(false);
	const begin = useCallback(() => {
		if (inFlight.current) return false;
		inFlight.current = true;
		return true;
	}, []);
	const end = useCallback(() => {
		inFlight.current = false;
	}, []);
	return { begin, end };
}

/**
 * Report a form body's submit/validity/loading to the sheet header.
 *
 * `submit` is read through a ref so its per-render identity never retriggers
 * the report; the memoized state changes identity only when `canSubmit` /
 * `submitting` / `hideMainButton` change, so the parent's `setState` is
 * reference-stable — no render loop between body and header.
 */
export function useFormStateReport(
	onReady: (state: FormState) => void,
	submit: () => void,
	canSubmit: boolean,
	submitting: boolean,
	hideMainButton = false,
	dirty = true,
): void {
	const submitRef = useRef(submit);
	submitRef.current = submit;
	const state = useMemo<FormState>(
		() => ({ submit: () => submitRef.current(), canSubmit, submitting, hideMainButton, dirty }),
		[canSubmit, submitting, hideMainButton, dirty],
	);
	useEffect(() => {
		onReady(state);
	}, [onReady, state]);
}
