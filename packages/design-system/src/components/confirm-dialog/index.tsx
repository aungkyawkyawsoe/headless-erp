'use client';

import * as React from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../alert-dialog';

/**
 * Imperative confirm/alert — a themed, focus-managed replacement for the browser's
 * native `window.confirm()` / `window.alert()`.
 *
 * Native dialogs are unstyled, unthemable, and cannot be asserted in a DOM test;
 * this gives the same imperative call shape (`if (!(await confirmDialog(...))) return`)
 * while rendering the design-system `AlertDialog` (focus trap, Esc/backdrop close,
 * token theming). Mount `ConfirmDialogHost` ONCE at the app root; then call
 * `confirmDialog()` / `alertDialog()` from anywhere — component or not.
 *
 * The pending request lives in a module-level queue (one at a time, FIFO) rather
 * than React state so the call sites stay a plain `await`.
 */

export interface ConfirmDialogOptions {
	/** Headline. Defaults to "Are you sure?" (confirm) / "Notice" (alert). */
	title?: string;
	/** Body copy — a string or rich node; newlines are preserved. */
	description?: React.ReactNode;
	/** Confirm-button label. Defaults to "Continue" (confirm) / "OK" (alert). */
	confirmLabel?: string;
	/** Cancel-button label. Ignored by `alertDialog` (it has no cancel). */
	cancelLabel?: string;
	/** Tint the confirm button as destructive. */
	destructive?: boolean;
}

type Request = ConfirmDialogOptions & {
	id: number;
	kind: 'confirm' | 'alert';
	resolve: (value: boolean) => void;
};

let queue: Request[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
	for (const listener of listeners) listener();
}

function request(kind: 'confirm' | 'alert', opts: ConfirmDialogOptions): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		queue = [...queue, { ...opts, id: nextId++, kind, resolve }];
		emit();
	});
}

/** A themed confirmation. Resolves `true` when confirmed, `false` on cancel/Esc/backdrop. */
export function confirmDialog(opts: ConfirmDialogOptions = {}): Promise<boolean> {
	return request('confirm', opts);
}

/** A themed acknowledgement (one button). Resolves once dismissed. */
export function alertDialog(opts: ConfirmDialogOptions = {}): Promise<void> {
	return request('alert', opts).then(() => undefined);
}

/** True while any confirm/alert is awaiting a decision (for tests / guards). */
export function isDialogPending(): boolean {
	return queue.length > 0;
}

/**
 * Mount once near the app root. Purely a renderer over the module queue — it
 * holds no policy, so the call sites stay declarative.
 */
export function ConfirmDialogHost() {
	const [items, setItems] = React.useState<Request[]>(queue);

	React.useEffect(() => {
		const sync = () => setItems(queue);
		listeners.add(sync);
		sync();
		return () => {
			listeners.delete(sync);
		};
	}, []);

	const current = items[0];
	if (!current) return null;

	const settle = (value: boolean) => {
		queue = queue.filter((q) => q.id !== current.id);
		current.resolve(value);
		emit();
	};

	const isAlert = current.kind === 'alert';
	return (
		<AlertDialog
			open
			onOpenChange={(open) => {
				// Esc / backdrop / cancel all resolve as "not confirmed" unless the
				// action button already settled it (then the queue is empty).
				if (!open && queue.some((q) => q.id === current.id)) settle(false);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{current.title ?? (isAlert ? 'Notice' : 'Are you sure?')}</AlertDialogTitle>
					{current.description != null && (
						<AlertDialogDescription style={{ whiteSpace: 'pre-line' }}>{current.description}</AlertDialogDescription>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter>
					{!isAlert && <AlertDialogCancel>{current.cancelLabel ?? 'Cancel'}</AlertDialogCancel>}
					<AlertDialogAction variant={current.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
						{current.confirmLabel ?? (isAlert ? 'OK' : 'Continue')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
