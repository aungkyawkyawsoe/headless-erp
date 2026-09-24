import { useSyncExternalStore } from 'react';

import { getLiveWebApp, type TelegramWebApp } from './telegram';

/**
 * The live Telegram bridge, as a SHARED store.
 *
 * The bridge is injected asynchronously (it can land a tick after module eval —
 * see `initTelegramApp`), so consumers must be re-rendered when it arrives.
 * Previously EVERY hook call site ran its OWN 10 × 150 ms poll — and
 * `useLiveWebApp` is called by `App`, `ModuleShell`, the BackButton controller,
 * `useTelegramMainButton`, … so a slow SDK load meant several independent timers
 * for one fact. Now there is ONE poll, and every consumer subscribes to it.
 */
let live: TelegramWebApp | undefined;
let polling = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function current(): TelegramWebApp | undefined {
	if (live) return live;
	live = getLiveWebApp();
	return live;
}

function ensurePolling(): void {
	if (polling || current()) return;
	polling = true;
	let tries = 0;
	const poll = () => {
		const next = getLiveWebApp();
		if (next) {
			live = next;
			polling = false;
			for (const listener of listeners) listener();
			return;
		}
		if (++tries < 10) {
			timer = setTimeout(poll, 150);
		} else {
			polling = false;
		}
	};
	timer = setTimeout(poll, 150);
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	ensurePolling();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0 && timer) {
			clearTimeout(timer);
			timer = undefined;
			polling = false;
		}
	};
}

/**
 * The live Telegram bridge as REACT STATE — re-renders the caller the moment
 * the async-injected WebApp SDK lands.
 *
 * Native-control consumers (BackButton / MainButton controllers) bind their tap
 * handlers in effects keyed on this value, so a slow SDK load can no longer
 * leave the native controls permanently unbound.
 */
export function useLiveWebApp(): TelegramWebApp | undefined {
	return useSyncExternalStore(subscribe, current, () => undefined);
}
