import { memo, useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { Banknote, CarFront, ChevronDown, Clock, Info, MapPin, Pencil, User, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { KIND_META, SEVERITY_META } from '../data/status';
import type { IncidentCardModel, IncidentKind } from '../data/types';

/** Kind icon — an accident reads as a vehicle collision, an incident as an
 *  informational event. Both take the kind's TEXT tone (see `KIND_META`). */
const KIND_ICON: Record<IncidentKind, typeof Info> = {
	accident: CarFront,
	incident: Info,
};

/**
 * ONE event card of a truck's accident/incident log — the per-truck page's row
 * language (`/app/incidents/vehicle/:id`), an EXPANDABLE feed card:
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │ (icon) ACCIDENT                          [HIGH]   │
 *  │ Rear bumper scrape on gate exit                   │
 *  │ (blank second line — every card is one height)    │
 *  │ ────────────────────────────────────────────────  │
 *  │ 06-Sep-2026                            Details ⌄  │
 *  ├──────────────────────────────────────────────────┤
 *  │ ┌─ LOCATION ────────┐ ┌─ EST. COST ─────────────┐ │
 *  │ │ Main store yard   │ │ MMK 250,000             │ │
 *  │ └───────────────────┘ └─────────────────────────┘ │
 *  │ 👥 PERSONNEL (4)                                  │
 *  │ ┌─────────────────┐ ┌───────────────────────────┐ │
 *  │ │ (ph) Safety Sup. │ │ (ph) Senior Accountant    │ │
 *  │ │ U Hla Tun        │ │ U Zaw Lin                 │ │
 *  │ └─────────────────┘ └───────────────────────────┘ │
 *  │ FULL DESCRIPTION                                  │
 *  │ Side swipe at main gate while reversing.          │
 *  │ [ ✎ Edit record ]                                 │
 *  └──────────────────────────────────────────────────┘
 *
 *  - **Header** — the kind as an icon circle + uppercase label in its tone, with
 *    the PRIORITY on the right as an ACHROMATIC badge (`Low` / `Medium` / `High`,
 *    never a severity tint — the level as words);
 *  - **Title** — the record's headline (`title`, falling back to its account);
 *  - **Footer** — when it happened, with the `Details ⌄` disclosure;
 *  - **Details** (expanded) — a location · estimated-cost fact grid, the PERSONNEL
 *    grid (the staff carried on the record's `personnel` m2m, resolved from its
 *    `hrm_employees` members with each one's `designation` role), the full
 *    description, and the Edit action.
 *
 * Tapping the card toggles the details inline (the feed stays on screen). Editing
 * is one deliberate step inside — `onOpen` renders the Edit button that opens the
 * record's own form (`/app/incidents/record/:id`).
 */
export const IncidentHistoryCard = memo(function IncidentHistoryCard({
	record,
	onOpen,
}: {
	record: IncidentCardModel;
	/** Opens this record's edit form — rendered as the details' Edit action.
	 *  Omitted, the card is read-only (details still expand). */
	onOpen?: (record: IncidentCardModel) => void;
}) {
	const [open, setOpen] = useState(false);
	const kind = KIND_META[record.kind] ?? KIND_META.incident;
	const KindIcon = KIND_ICON[record.kind] ?? Info;
	// The headline — the record's title, else its account, else the bare kind.
	const heading = record.title ?? record.description ?? `${kind.label} record`;
	// The full account only when it says more than the headline (a title-only row
	// folds to itself — no duplicated block).
	const fullDescription = record.description && record.description !== heading ? record.description : null;
	// When it happened — the incident date, else the record's relative age.
	const when = record.dateLabel ?? record.ageLabel;
	const detailsId = `incident-details-${record.id}`;

	// The staff carried on the record — the `personnel` m2m (empty on reads that
	// don't request it, which then render no grid).
	const personnel = record.personnel;

	return (
		<li className={`overflow-hidden ${CARD_FRAME} shadow-card`}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={detailsId}
				className="block w-full p-4 text-left outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/50"
			>
				{/* Type + priority — the kind in its tone, the priority achromatic. */}
				<span className="flex items-center justify-between gap-3">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${kind.className}`}>
							<KindIcon className="size-4" strokeWidth={2.2} aria-hidden />
						</span>
						<span className={`truncate text-xs font-bold uppercase tracking-wider ${kind.textClassName}`}>{kind.label}</span>
					</span>
					{/* Priority badge — deliberately NO colour: the level as plain muted
						text in a neutral outline, never a severity tint. */}
					<span className="shrink-0 rounded-full border border-border/60 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
						{(SEVERITY_META[record.severity] ?? SEVERITY_META.low).label}
					</span>
				</span>

				{/* Headline — a FIXED two-line area (short titles keep the row height
					uniform, long ones clamp at two). */}
				<span className="mt-2 line-clamp-2 min-h-11 text-base font-bold leading-snug text-foreground">{heading}</span>

				{/* Footer — when it happened + the details disclosure. */}
				<span className="mt-3 flex items-center justify-between pt-1 text-xs font-medium text-muted-foreground">
					<span className="flex min-w-0 items-center gap-1.5">
						<Clock className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
						<span className="truncate">{when ?? 'No date'}</span>
					</span>
					<span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
						Details
						<ChevronDown className={`size-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden />
					</span>
				</span>
			</button>

			{open && (
				<div id={detailsId} className="space-y-4 border-t border-border/60 bg-muted/30 px-4 pt-4 pb-4">
					{/* Location · estimated cost — one two-column fact box. */}
					<div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-card p-3.5">
						<div className="flex items-start gap-2.5">
							<MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
							<div className="min-w-0">
								<p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Location</p>
								<p className="truncate text-xs font-bold leading-myanmar text-foreground">{record.location ?? '—'}</p>
							</div>
						</div>
						<div className="flex items-start gap-2.5 border-l border-border/60 pl-3">
							<Banknote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
							<div className="min-w-0">
								<p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Est. Cost</p>
								<p className="truncate text-xs font-bold text-foreground">{record.costLabel ?? '—'}</p>
							</div>
						</div>
					</div>

					{/* Personnel — the staff on the record (the `personnel` m2m), as role · name. */}
					{personnel.length > 0 && (
						<div className="rounded-2xl border border-border/70 bg-card p-3.5">
							<p className="mb-2.5 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
								<Users className="size-3 shrink-0" strokeWidth={2.2} aria-hidden />
								Personnel ({personnel.length})
							</p>
							<div className="grid grid-cols-2 gap-x-2 gap-y-3">
								{personnel.map((person) => (
									<div key={person.id || person.name} className="flex items-center gap-2">
										<Avatar className="size-6 shrink-0">
											{person.photo ? <AvatarImage src={person.photo} alt={person.name} /> : null}
											{/* No directory photo → the lucide person icon, never a letter avatar. */}
											<AvatarFallback>
												<User className="size-3.5" strokeWidth={2} aria-hidden />
											</AvatarFallback>
										</Avatar>
										<div className="min-w-0">
											{/* The employee's designation as the role line — omitted when they carry none. */}
											{person.role && <p className="text-[9px] font-medium leading-none text-muted-foreground">{person.role}</p>}
											<p className={`${person.role ? 'mt-0.5 ' : ''}truncate text-xs font-bold leading-myanmar text-foreground`}>
												{person.name}
											</p>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{/* The full account — only when it adds to the headline. */}
					{fullDescription && (
						<div>
							<p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Full Description</p>
							<div className="rounded-2xl border border-border/70 bg-card p-3 text-xs leading-relaxed text-muted-foreground">
								{fullDescription}
							</div>
						</div>
					)}

					{/* Editing is one deliberate step inside the expanded card. */}
					{onOpen && (
						<button
							type="button"
							onClick={() => onOpen(record)}
							className={`flex w-full items-center justify-center gap-2 ${CARD_FRAME} py-3 text-xs font-bold leading-myanmar text-foreground shadow-sm transition-transform duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
						>
							<Pencil className="size-3.5" strokeWidth={2.2} aria-hidden />
							Edit record
						</button>
					)}
				</div>
			)}
		</li>
	);
});
