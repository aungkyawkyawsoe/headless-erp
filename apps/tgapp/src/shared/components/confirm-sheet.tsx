import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Loader2 } from 'lucide-react';

import { hapticImpact } from '@/shared/platform/haptics';

interface ConfirmSheetProps {
	open: boolean;
	/** The sheet's heading (e.g. "Confirm this receipt?"). */
	title: string;
	/** The consequence sentence under the heading. */
	description: string;
	/** The confirm button's label (defaults to "Confirm"). */
	confirmLabel?: string;
	/** The dismiss button's label (defaults to "Cancel"). */
	cancelLabel?: string;
	/** Confirm colour — `destructive` for actions that remove/close. */
	tone?: 'primary' | 'destructive';
	/** The action is in flight — confirm shows a spinner, both buttons lock. */
	busy?: boolean;
	/** A failure to surface inline instead of closing on a swallowed error. */
	error?: string | null;
	/** Runs the action; the caller closes the sheet when it succeeds. */
	onConfirm: () => void;
	/** Dismisses the sheet — a no-op while `busy`. */
	onClose: () => void;
}

/**
 * The ONE confirmation bottom sheet for irreversible actions (stock confirms /
 * approvals / issues, draft cancels). Controlled and presentational: the caller
 * owns the async work and hands back `busy` + `error`, so this stays a single
 * shared primitive instead of a stateful copy per module.
 *
 * Invariants:
 *  - a write in flight locks the sheet — backdrop / Escape / Cancel are all
 *    no-ops while `busy`, so a stray tap can never hide a half-applied action;
 *  - a failure renders inline (`role="alert"`) and leaves the sheet open to retry;
 *  - confirm/cancel emit a haptic tap immediately, on top of the action's own.
 */
export function ConfirmSheet({
	open,
	title,
	description,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	tone = 'primary',
	busy = false,
	error = null,
	onConfirm,
	onClose,
}: ConfirmSheetProps) {
	const close = () => {
		if (busy) return;
		hapticImpact('light');
		onClose();
	};

	const confirm = () => {
		if (busy) return;
		hapticImpact('medium');
		onConfirm();
	};

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<SheetContent side="bottom" className="p-0">
				<SheetHeader>
					<SheetTitle className="px-5 pt-4">{title}</SheetTitle>
				</SheetHeader>

				<div className="flex flex-col gap-4 px-5 pb-safe pt-3">
					<p className="text-sm leading-myanmar text-muted-foreground">{description}</p>

					{error && (
						<p
							role="alert"
							className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-myanmar text-destructive"
						>
							{error}
						</p>
					)}

					<div className="flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={close}
							className="flex-1 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
						>
							{cancelLabel}
						</button>
						<button
							type="button"
							disabled={busy}
							aria-busy={busy}
							onClick={confirm}
							className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl px-4 py-3 text-sm font-semibold leading-myanmar transition-transform duration-150 active:scale-[0.98] disabled:opacity-50 ${
								tone === 'destructive' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'
							}`}
						>
							{busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
							{confirmLabel}
						</button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
