import { useState } from 'react';
import { Plus, User, X } from 'lucide-react';

import { PersonnelPickerSheet, type PersonnelOption } from '@/shared/components/personnel-picker-sheet';

/** The quiet field control surface — matches the incident form's other inputs. */
const ADD_BUTTON =
	'flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-card px-3 py-2.5 text-sm font-semibold leading-myanmar text-muted-foreground transition-colors duration-150 hover:text-foreground active:scale-[0.99] disabled:opacity-40';

interface PersonnelFieldProps {
	/** The selected crew — chips render in order; the parent owns the value. */
	value: PersonnelOption[];
	/** Fired with the next selection after an add / remove. */
	onChange: (next: PersonnelOption[]) => void;
	disabled?: boolean;
}

/**
 * Personnel field — the crew m2m editor shared by every incident form (the
 * truck-bound create/edit form AND the register's standalone create page), so
 * the control can never drift between them.
 *
 * Selected people render as removable chips; "Add personnel" opens the lazy,
 * SEARCH-FIRST `PersonnelPickerSheet` (one server lookup per typed term — never a
 * whole-directory walk). Adding several people keeps the sheet open; a chip's ✕
 * removes one. The value is the picker's `{ id, name, photo }` projection, which
 * the form maps to `hrm_employees` ids at submit.
 */
export function PersonnelField({ value, onChange, disabled = false }: PersonnelFieldProps) {
	const [open, setOpen] = useState(false);

	const toggle = (person: PersonnelOption) => {
		onChange(
			value.some((selected) => selected.id === person.id) ? value.filter((selected) => selected.id !== person.id) : [...value, person],
		);
	};

	return (
		<div className="flex flex-col gap-2">
			{value.length === 0 ? (
				<p className="text-xs leading-myanmar text-muted-foreground">No one added yet — add the driver, conductor and others involved.</p>
			) : (
				<ul className="flex flex-wrap gap-2">
					{value.map((person) => (
						<li
							key={person.id}
							className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-1 pr-1.5"
						>
							<span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
								{person.photo ? (
									<img src={person.photo} alt="" className="size-full object-cover" />
								) : (
									<User className="size-3.5" strokeWidth={2} aria-hidden />
								)}
							</span>
							<span className="min-w-0 truncate text-xs font-semibold leading-myanmar text-foreground">{person.name}</span>
							<button
								type="button"
								disabled={disabled}
								aria-label={`Remove ${person.name}`}
								onClick={() => onChange(value.filter((selected) => selected.id !== person.id))}
								className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
							>
								<X className="size-3.5" aria-hidden />
							</button>
						</li>
					))}
				</ul>
			)}

			<button type="button" disabled={disabled} onClick={() => setOpen(true)} className={ADD_BUTTON}>
				<Plus className="size-4" strokeWidth={2.2} aria-hidden />
				Add personnel
			</button>

			<PersonnelPickerSheet open={open} onOpenChange={setOpen} value={value} onToggle={toggle} />
		</div>
	);
}
