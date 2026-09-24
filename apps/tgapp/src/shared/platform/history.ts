import type { NavigateFunction } from 'react-router-dom';

/**
 * React Router stamps `idx` (the entry's position in the session history) onto
 * every entry it pushes. A cold open — Telegram deep link, browser reload, or
 * the very first page load — has no entry beneath it (`idx === 0`).
 *
 * Both back affordances (the Telegram native BackButton and the browser "Back"
 * pill) share this check so they can never drift apart again: pop a real entry
 * when one exists, otherwise fall back to a `replace` navigation.
 */
export function canGoBackInHistory(): boolean {
	return ((window.history.state?.idx as number | undefined) ?? 0) > 0;
}

/**
 * The ONE back action every affordance uses (the header pill, the Telegram
 * native BackButton, save handlers, error-state "Back to list" buttons): pop the
 * real previous entry when one exists, otherwise REPLACE to `fallback`. Never
 * PUSH — a push would leave the current page beneath a second copy of the
 * destination, so every round trip grows the history and the next back press
 * walks back through a stale page instead of leaving (the "too many presses"
 * regression this helper exists to prevent).
 */
export function popBack(navigate: NavigateFunction, fallback: string): void {
	if (canGoBackInHistory()) navigate(-1);
	else navigate(fallback, { replace: true });
}
