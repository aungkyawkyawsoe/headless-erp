import { getLiveWebApp, versionAtLeast } from './telegram';

/**
 * Telegram haptic feedback wrappers — safe no-ops outside a Telegram client
 * (plain browser dev/preview) and on clients older than Bot API 6.1 (the
 * feature's minimum). Never throw into the caller.
 *
 * The official SDK ships a `HapticFeedback` stub on EVERY client and merely
 * touching it below 6.1 logs "HapticFeedback is not supported in version X"
 * (telegram-web-app.js) — so these wrappers version-gate BEFORE accessing the
 * object, exactly like the BackButton/MainButton hooks.
 */
export function hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light'): void {
	try {
		const wa = getLiveWebApp();
		if (!wa || !versionAtLeast(wa, '6.1')) return;
		wa.HapticFeedback?.impactOccurred(style);
	} catch {
		/* no-op */
	}
}

export function hapticSelection(): void {
	try {
		const wa = getLiveWebApp();
		if (!wa || !versionAtLeast(wa, '6.1')) return;
		wa.HapticFeedback?.selectionChanged();
	} catch {
		/* no-op */
	}
}
