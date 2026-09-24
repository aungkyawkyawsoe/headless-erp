import { memo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import type { LucideIcon } from 'lucide-react';

interface MasterRowProps {
	/** The master row's display name — '—' when unset. */
	name: string | null | undefined;
	/** The row's leading glyph (Store for suppliers, Wrench for issue types…). */
	icon: LucideIcon;
	/** One muted contact-detail line under the name (the supplier's
	 *  mobile · address, the issue type's family); omitted entirely when the
	 *  master has none. */
	detail?: string | null;
	/** Tap the row → its rename/edit page. Omitted for a READ-ONLY master (the
	 *  directory has no edit surface): the row then renders as a plain card. */
	onOpen?: () => void;
}

/**
 * One tappable master row on the masters hub's supplier/issue tabs — a
 * name-only card whose tap opens that master's edit form (unlike the group
 * cards, these masters carry no child screens). A master without an
 * `onOpen` (the read-only Issues tab) renders the same card inert — nothing
 * to open. The supplier rows carry one optional contact detail line
 * (mobile · address); the issue-type rows carry their family — so the master
 * context is glanceable without opening the form.
 */
export const MasterRow = memo(function MasterRow({ name, detail, icon: Icon, onOpen }: MasterRowProps) {
	const body = (
		<div className="flex items-center gap-2.5">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
				<Icon className="size-4.5" strokeWidth={2} aria-hidden />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-semibold leading-myanmar text-foreground">{name?.trim() ? name.trim() : '—'}</p>
				{detail?.trim() ? <p className="truncate text-xs leading-5 text-muted-foreground">{detail.trim()}</p> : null}
			</div>
		</div>
	);

	return (
		<li className={`${CARD_FRAME} p-3 shadow-card`}>
			{onOpen ? (
				<button
					type="button"
					onClick={onOpen}
					aria-label={`${name?.trim() ? name.trim() : ''} — edit`}
					className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{body}
				</button>
			) : (
				body
			)}
		</li>
	);
});
