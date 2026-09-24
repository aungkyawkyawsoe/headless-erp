import { X } from 'lucide-react';

interface SheetCloseButtonProps {
	onClick?: () => void;
	/** Close button's accessible label — "Close" by default. */
	ariaLabel?: string;
}

/** A circular ✕ close affordance for bottom sheets / dialogs. Always tinted
 *  (`bg-muted`) so the button reads as an active control at rest — it never
 *  drops to a transparent "ghost" idle state. Reusable across every sheet. */
export function SheetCloseButton({ onClick, ariaLabel = 'Close' }: SheetCloseButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<X className="size-4" aria-hidden />
		</button>
	);
}
