import { useEffect, useState } from 'react';
import { Hash, Plus, Trash2 } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { ScrollArea } from '@mmbix/design-system/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { hapticImpact } from '@/shared/platform/haptics';
import { addSerials, type SerialConflict } from '../data/line-rules';

interface SerialEditorSheetProps {
	open: boolean;
	/** The row's subject (`Tyre · 11R 22.5`), so the sheet says WHICH line it edits. */
	title: string;
	/** The units already on this line, in order. */
	value: string[];
	/** The line's quantity — what the count is measured against (null = not typed). */
	qty: number | null;
	/** Serials already carried by the OTHER lines of this document, with the line
	 *  that holds each — a unit is entered once per receipt, not once per line. */
	others: { serial: string; where: string }[];
	/**
	 * The document is SETTLED, so this is a VIEWER: the units are listed line by line
	 * and there is not one way to change them — no entry box, no Add, no delete, and
	 * no instruction to type (those are ACTIONS, and an action is absent rather than
	 * dead). Viewing stays open on purpose: the units a posted receipt received are a
	 * FACT the operator has to be able to read, and it lives nowhere else — the line's
	 * own field only shows them as a truncated comma list.
	 */
	readOnly?: boolean;
	onOpenChange: (open: boolean) => void;
	onChange: (next: string[]) => void;
}

/**
 * The SERIAL EDITOR — one line's exact units, entered one row at a time.
 *
 *   ┌ Tyre · 11R 22.5              2/3 ┐
 *   │ [ TY-1001        ] [ + Add ]     │
 *   │ 1  TY-1001                  🗑    │
 *   │ 2  TY-1002                  🗑    │
 *   └──────────────────────────────────┘
 *
 * The SAME sheet is the read-only view of a settled document's units: the entry box,
 * the Add, the per-row delete and the count hint are ABSENT (`readOnly`), leaving the
 * units one per row — a posted receipt's units are readable, never editable.
 *
 * Why a sheet rather than the comma-separated text field this replaced: a serial
 * number is a per-unit IDENTITY, unique forever, so a free-text field hides
 * exactly the two mistakes that cost a rejected confirm — a mistyped unit and one
 * entered twice (here, or on another line of the same receipt). One row per unit
 * makes both visible while the operator still has the label in their hand, and the
 * counter in the header ties the list to the quantity it has to match.
 *
 * The entry box still takes a whole pasted column (`parseSerials` splits commas /
 * Burmese commas / whitespace), so a supplier's list is one paste, not ten taps.
 */
export function SerialEditorSheet({ open, title, value, qty, others, readOnly = false, onOpenChange, onChange }: SerialEditorSheetProps) {
	const [entry, setEntry] = useState('');
	const [conflicts, setConflicts] = useState<SerialConflict[]>([]);

	// A half-typed unit belongs to the line it was typed for — never carried into
	// the next line, and never resurrected when the sheet is re-opened.
	useEffect(() => {
		if (open) {
			setEntry('');
			setConflicts([]);
		}
	}, [open]);

	const add = () => {
		const outcome = addSerials(value, entry, others);
		if (outcome.serials.length !== value.length) {
			hapticImpact('light');
			onChange(outcome.serials);
		}
		setConflicts(outcome.conflicts);
		setEntry('');
	};

	// How the count stands against the quantity — the fact the operator is watching
	// while they type. A null qty (not entered yet) says nothing rather than lying.
	const delta = qty !== null && Number.isInteger(qty) ? qty - value.length : null;

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (!next) setConflicts([]);
				onOpenChange(next);
			}}
		>
			<SheetContent side="bottom" className="max-h-[85dvh]">
				<SheetHeader className="pb-1">
					<SheetTitle className="flex items-baseline gap-2">
						<span className="min-w-0 truncate">{title}</span>
						<span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">
							{value.length}
							{qty !== null && Number.isInteger(qty) ? `/${qty}` : ''}
						</span>
					</SheetTitle>

					{!readOnly && (
						<div className="mt-3 flex items-center gap-2">
							<label htmlFor="inbound-serial-entry" className="sr-only">
								Serial number
							</label>
							<Input
								id="inbound-serial-entry"
								value={entry}
								onChange={(event) => setEntry(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== 'Enter') return;
									event.preventDefault();
									add();
								}}
								placeholder="TY-1001"
								autoCapitalize="characters"
								autoComplete="off"
								className="h-9 min-w-0 flex-1 rounded-lg px-3"
							/>
							<button
								type="button"
								disabled={entry.trim() === ''}
								onClick={add}
								className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-primary px-3 text-sub font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-40 disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<Plus className="size-4" strokeWidth={2.2} aria-hidden />
								Add
							</button>
						</div>
					)}

					{/* Why an Add did nothing, or how far the count still is — never both,
					    and never silence: a refused unit that vanished without a word is
					    the exact bug this sheet exists to prevent. */}
					{!readOnly &&
						(conflicts.length > 0 ? (
							<ul className="mt-2 flex flex-col gap-0.5">
								{conflicts.map((conflict) => (
									<li
										key={`${conflict.serial}-${conflict.where ?? 'here'}`}
										className="text-meta font-medium leading-myanmar text-status-warning"
									>
										<span className="font-semibold">{conflict.serial}</span>{' '}
										{conflict.where
											? `is already on ${conflict.where} — one serial can only be received once.`
											: 'is already in this list.'}
									</li>
								))}
							</ul>
						) : delta !== null && delta !== 0 ? (
							<p className={`mt-2 text-meta font-medium leading-myanmar ${delta > 0 ? 'text-muted-foreground' : 'text-status-warning'}`}>
								{delta > 0
									? `${delta} more to add — the count must match the quantity.`
									: `${-delta} too many — the count must match the quantity.`}
							</p>
						) : delta === 0 ? (
							<p className="mt-2 text-meta leading-myanmar text-status-success">
								All {qty} unit{qty === 1 ? '' : 's'} entered.
							</p>
						) : null)}
				</SheetHeader>

				<ScrollArea className={`px-4 pb-safe ${readOnly ? 'mt-2 h-[60dvh]' : 'h-[45dvh]'}`}>
					{value.length === 0 ? (
						<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-myanmar text-muted-foreground">
							{readOnly ? 'No serial numbers on this line.' : 'No serial numbers yet — add one above, or paste the whole list at once.'}
						</p>
					) : (
						<ul className="flex flex-col gap-0.5">
							{value.map((serial, index) => (
								<li key={serial} className="flex items-center gap-3 rounded-md px-3 py-2.5">
									<span className="w-5 shrink-0 text-meta tabular-nums text-muted-foreground">{index + 1}</span>
									<Hash strokeWidth={1.6} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
									<span className="min-w-0 flex-1 truncate text-sm font-medium leading-myanmar text-foreground">{serial}</span>
									{!readOnly && (
										<button
											type="button"
											onClick={() => {
												hapticImpact('light');
												setConflicts([]);
												onChange(value.filter((unit) => unit !== serial));
											}}
											aria-label={`Remove ${serial}`}
											className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
										</button>
									)}
								</li>
							))}
						</ul>
					)}
				</ScrollArea>
			</SheetContent>
		</Sheet>
	);
}
