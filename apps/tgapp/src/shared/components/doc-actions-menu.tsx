import { MoreVertical } from 'lucide-react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@mmbix/design-system/dropdown-menu';

/** One entry in a document's ⋮ menu. */
export interface DocMenuAction {
	label: string;
	/** Run when the operator picks the entry (base-ui's `Menu.Item` takes `onClick`). */
	onSelect: () => void;
	/** Busy/redundant while the same action is in flight — the entry is inert, not dead. */
	disabled?: boolean;
}

interface DocActionsMenuProps {
	/** The document number the trigger's accessible name quotes — `Actions for INB-00031`. */
	docNumber?: string | null;
	/** The noun used when the document has no number yet (`Actions for this receipt`). */
	noun?: string;
	/**
	 * Entries ABOVE the separator — a FACET of the document rather than its lifecycle
	 * (e.g. `Record payment` on a purchase receipt).
	 */
	extra?: DocMenuAction[];
	/**
	 * The document's own primary action (Confirm / Approve), offered ONLY while the
	 * document is a draft. It rides the menu as well as the row's direct button, because
	 * the ⋮ is the ONE place the full action set is always visible — but it is never the
	 * only way to reach it (a draft's job is to be confirmed, so that stays explicit).
	 */
	primary?: DocMenuAction | null;
	/**
	 * The ONE cancel — a draft is cleared, a POSTED document is REVERSED. Its LABEL is
	 * the caller's `cancelCopyOf(kind, docStatus).label`, so the menu entry and the
	 * sheet's confirm button read it identically and neither screen re-words the write.
	 * Absent/null ⇒ no cancel entry.
	 */
	cancel?: DocMenuAction | null;
}

/**
 * The document ⋮ actions menu — the ONE kebab on every stock document, on the list row
 * AND the document page, so a lifecycle action is learned once and found in the same
 * place on both surfaces.
 *
 * Why cancel lives here rather than on a second labelled button (poka-yoke): Confirm is
 * a draft's JOB, so it keeps the row's explicit primary control; cancel is a REVERSAL of
 * work already done, and it is destructive and final. A kebab makes it a deliberate
 * second gesture instead of a button sitting one fat-finger away from the confirm on the
 * very row the operator just posted. The confirmation sheet behind it still states, in
 * the server's own terms, whether nothing was moved or the stock is about to go back.
 *
 * A menu with nothing behind it is NOT rendered at all — so a `cancelled` stock document
 * (frozen and final: never reopened, never deleted) shows no ⋮ rather than a dead one.
 */
export function DocActionsMenu({ docNumber, noun = 'this document', extra = [], primary = null, cancel = null }: DocActionsMenuProps) {
	// MECE: everything above the separator is a document facet or the draft primary;
	// below it is the single destructive lifecycle exit.
	const lead = primary ? [...extra, primary] : extra;
	if (lead.length === 0 && cancel === null) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={`Actions for ${docNumber ?? noun}`}
				className="pointer-events-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<MoreVertical className="size-4" strokeWidth={2} aria-hidden />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				{lead.map((item) => (
					// `Menu.Item` renders a `<div role="menuitem">` and takes `onClick` — an
					// `onSelect` prop would fall through to the DOM (React's text-selection
					// event) and the entry would silently do nothing.
					<DropdownMenuItem key={item.label} disabled={item.disabled} onClick={item.onSelect}>
						{item.label}
					</DropdownMenuItem>
				))}
				{cancel && (
					<>
						{lead.length > 0 && <DropdownMenuSeparator />}
						<DropdownMenuItem
							disabled={cancel.disabled}
							onClick={cancel.onSelect}
							className="text-status-danger focus:text-status-danger"
						>
							{cancel.label}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
