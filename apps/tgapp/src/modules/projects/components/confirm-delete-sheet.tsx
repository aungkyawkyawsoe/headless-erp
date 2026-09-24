import { useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Loader2, Trash2 } from 'lucide-react';

import { FormError } from '@/shared/components/form-submit';
import { hapticImpact } from '@/shared/platform/haptics';

interface ConfirmDeleteSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The sheet's heading (e.g. "Delete this project?"). */
	title: string;
	/** The consequence sentence under the heading. */
	description: string;
	/** The destructive button's label (defaults to "Delete"). */
	confirmLabel?: string;
	/** Performs the delete; the caller closes the sheet + navigates on success. */
	onConfirm: () => Promise<void>;
}

/**
 * The ONE destructive-confirmation bottom sheet for the Projects module (a
 * project and a task both delete through it). Mirrors the app's sheet anatomy:
 * a warning sentence, then Cancel / Delete — the delete shows a busy spinner
 * and surfaces a failure inline instead of closing on a swallowed error.
 */
export function ConfirmDeleteSheet({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = 'Delete',
	onConfirm,
}: ConfirmDeleteSheetProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const close = (next: boolean) => {
		// A delete in flight must not be dismissed by a stray backdrop tap.
		if (busy && !next) return;
		if (!next) setError(null);
		onOpenChange(next);
	};

	const confirm = async () => {
		if (busy) return;
		hapticImpact('medium');
		setBusy(true);
		setError(null);
		try {
			await onConfirm();
		} catch (err) {
			console.error('[projects] delete failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Couldn’t delete this — try again.');
			setBusy(false);
		}
	};

	return (
		<Sheet open={open} onOpenChange={close}>
			<SheetContent side="bottom" className="p-0">
				<SheetHeader>
					<SheetTitle className="px-5 pt-4">{title}</SheetTitle>
				</SheetHeader>

				<div className="flex flex-col gap-4 px-5 pb-safe pt-3">
					<p className="text-sm leading-myanmar text-muted-foreground">{description}</p>

					{error && <FormError error={error} />}

					<div className="flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => close(false)}
							className={`flex-1 ${CARD_FRAME} px-4 py-3 text-sm font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-[0.98] disabled:opacity-50`}
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => void confirm()}
							className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-destructive px-4 py-3 text-sm font-semibold leading-myanmar text-destructive-foreground transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
						>
							{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
							{busy ? 'Deleting…' : confirmLabel}
						</button>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
