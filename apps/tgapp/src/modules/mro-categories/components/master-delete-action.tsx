import { useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { Loader2, Trash2 } from 'lucide-react';

import { hapticImpact } from '@/shared/platform/haptics';

interface MasterDeleteActionProps {
	/** The noun in the button copy (e.g. "supplier" → "Delete supplier"). */
	noun: string;
	/** Shown when the failure carries no server message (network error…). */
	errorMessage: string;
	/** Perform the delete; must invalidate its list cache + navigate away on
	 *  success, and THROW on failure. A thrown `message` (e.g. the engine's 409
	 *  RESTRICT reason) is shown verbatim. */
	onDelete: () => Promise<void>;
}

/**
 * The masters hub's shared destructive action — a two-tap delete button for the
 * supplier / item-group edit pages.
 *
 * ONE tap arms it ("Tap again to delete"), a second confirms; there is no
 * `window.confirm` (Telegram's webview blocks it). While the request is in flight
 * the button is a spinner; a failure shows the server's own reason inline (the
 * engine answers 409 with the exact collection still referencing this master), so
 * an operator learns WHY instead of seeing a generic error. Success navigation
 * lives in `onDelete` — this component unmounts with it.
 */
export function MasterDeleteAction({ noun, errorMessage, onDelete }: MasterDeleteActionProps) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		if (busy) return;
		hapticImpact('medium');
		setBusy(true);
		setError(null);
		try {
			await onDelete();
			// Success navigation lives in `onDelete` — this unmounts with it.
		} catch (err) {
			setError(err instanceof Error && err.message ? err.message : errorMessage);
			setConfirming(false);
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			{error && (
				<p role="alert" className="text-xs font-medium leading-myanmar text-destructive">
					{error}
				</p>
			)}

			{confirming ? (
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={() => void run()}
						className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold leading-myanmar text-destructive transition-transform duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
					>
						{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" strokeWidth={2.2} aria-hidden />}
						{busy ? 'Deleting…' : 'Tap again to delete'}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							setConfirming(false);
							setError(null);
						}}
						className={`shrink-0 ${CARD_FRAME} px-4 py-3 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50`}
					>
						Cancel
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={() => {
						hapticImpact('light');
						setConfirming(true);
						setError(null);
					}}
					className={`flex w-full items-center justify-center gap-2 ${CARD_FRAME} py-3 text-sm font-semibold leading-myanmar text-destructive transition-transform duration-150 active:scale-95`}
				>
					<Trash2 className="size-4" strokeWidth={2.2} aria-hidden />
					Delete {noun}
				</button>
			)}
		</div>
	);
}
