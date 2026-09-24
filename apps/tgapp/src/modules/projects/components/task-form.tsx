import { useEffect, useState } from 'react';
import {
	FIELD_CLASS as fieldClass,
	PICKER_FIELD_CLASS as pickerFieldClass,
	FIELD_LABEL_CLASS as labelClass,
} from '@/shared/components/form-styles';
import { Check, ChevronDown, User, X } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';

import { TASK_PRIORITIES, TASK_PRIORITY_META, TASK_STATE_FORM_OPTIONS } from '../data/meta';
import type { TaskPriority, TaskState } from '../data/types';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { ModuleShell } from '@/shared/components/module-shell';
import { PersonnelPickerSheet, type PersonnelOption } from '@/shared/components/personnel-picker-sheet';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { daysFromTodayMmt } from '@/shared/time/myanmar';

/** The values a task form submits — what `createTask` / `updateTask` accept. */
export interface TaskFormValues {
	name: string;
	priority: TaskPriority | null;
	state: TaskState;
	/** The `hrm_employees` ids — an empty list clears the assignees. */
	assignees: string[];
	/** `YYYY-MM-DD`, or null. */
	dueDate: string | null;
}

export interface TaskFormInitial {
	name: string;
	priority: TaskPriority | null;
	state: TaskState;
	assignees: PersonnelOption[];
	/** `YYYY-MM-DD`, or `''`. */
	dueDate: string;
}

interface TaskFormProps {
	title: string;
	backTo: string;
	/** The owning project's display name — resolved by the caller. */
	projectName: string | null;
	initial?: TaskFormInitial;
	submitLabel: string;
	onSave: (values: TaskFormValues) => Promise<void>;
}

/**
 * The ONE task form behind both the create and the edit screen — title,
 * priority, state, assignees and due date, with the owning project shown as a
 * fixed context strip (a task never moves between projects).
 *
 * "Overdue" is not a selectable state here: the stored `state` is only ever
 * `todo` / `in_progress` / `done` (the board DERIVES overdue from `due_date`),
 * so a due date in the past is surfaced as an inline hint rather than silently
 * flipping the task's lifecycle.
 */
export function TaskForm({ title, backTo, projectName, initial, submitLabel, onSave }: TaskFormProps) {
	const [name, setName] = useState(initial?.name ?? '');
	const [priority, setPriority] = useState<TaskPriority | null>(initial?.priority ?? null);
	const [state, setState] = useState<TaskState>(initial?.state ?? 'todo');
	const [assignees, setAssignees] = useState<PersonnelOption[]>(initial?.assignees ?? []);
	const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
	const [pickerOpen, setPickerOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!initial) return;
		setName(initial.name ?? '');
		setPriority(initial.priority ?? null);
		setState(initial.state ?? 'todo');
		setAssignees(initial.assignees ?? []);
		setDueDate(initial.dueDate ?? '');
		setError(null);
	}, [initial]);

	// Dirty gate — an edit must differ from the loaded task (or, on create, from
	// the blank defaults) before it can save.
	const dirty = useFormDirty(
		{
			name: initial?.name ?? '',
			priority: initial?.priority ?? null,
			state: initial?.state ?? 'todo',
			assignees: initial?.assignees ?? [],
			dueDate: initial?.dueDate ?? '',
		},
		{ name, priority, state, assignees, dueDate },
	);

	const canSave = name.trim() !== '' && !saving && dirty;

	const toggleAssignee = (person: PersonnelOption) => {
		setAssignees((prev) => (prev.some((p) => p.id === person.id) ? prev.filter((p) => p.id !== person.id) : [...prev, person]));
	};

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			// On success the caller navigates away — `setSaving(false)` stays in
			// the catch only (never a post-unmount setState).
			await onSave({ name: name.trim(), priority, state, assignees: assignees.map((person) => person.id), dueDate: dueDate || null });
		} catch (err) {
			console.error('[projects] save task failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Couldn’t save this task — try again.');
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// Tucked away while the assignee picker sheet is open so it cannot be tapped
	// behind the sheet's backdrop.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : submitLabel,
		onClick: () => void submit(),
		visible: !pickerOpen,
		disabled: !canSave,
		loading: saving,
	});

	const overdue = dueDate !== '' && state !== 'done' && daysFromTodayMmt(dueDate) < 0;

	return (
		<ModuleShell title={title} backTo={backTo}>
			<form
				className="flex flex-1 flex-col gap-4 pt-2"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				{/* The owning project — fixed for the task's whole life, shown for context. */}
				<div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
					<span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Project</span>
					<span className="truncate text-sm font-semibold leading-myanmar text-foreground">{projectName ?? '…'}</span>
				</div>

				<div className="min-w-0">
					<label className={labelClass} htmlFor="task-name">
						Title
					</label>
					<Input
						id="task-name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Draft the landing-page copy"
						disabled={saving}
						className={fieldClass}
					/>
				</div>

				<FormField label="Priority (optional)" group>
					{() => (
						<div className="grid grid-cols-4 gap-2">
							{TASK_PRIORITIES.map((value) => {
								const active = priority === value;
								return (
									<button
										key={value}
										type="button"
										disabled={saving}
										onClick={() => setPriority(active ? null : value)}
										className={`rounded-xl border px-2 py-2.5 text-xs font-semibold leading-myanmar transition-colors duration-150 ${
											active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
										}`}
									>
										{TASK_PRIORITY_META[value].label}
									</button>
								);
							})}
						</div>
					)}
				</FormField>

				<FormField label="State" group>
					{() => <SegmentedTabs options={TASK_STATE_FORM_OPTIONS} value={state} onChange={setState} ariaLabel="Task state" />}
				</FormField>

				<FormField label="Assignees (optional)" group>
					{() => (
						<>
							<div className={pickerFieldClass}>
								<button
									type="button"
									onClick={() => setPickerOpen(true)}
									disabled={saving}
									className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none disabled:opacity-60"
								>
									<User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									<span className={`truncate ${assignees.length > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
										{assignees.length > 0 ? `${assignees.length} assigned` : 'Select assignees…'}
									</span>
								</button>
								<button
									type="button"
									aria-label="Select assignees"
									onClick={() => setPickerOpen(true)}
									disabled={saving}
									className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
								>
									<ChevronDown className="size-4" aria-hidden />
								</button>
							</div>
							{/* The chosen people — a large avatar so the face is recognisable at a glance. */}
							{assignees.length > 0 && (
								<ul className="mt-2.5 flex flex-wrap gap-2">
									{assignees.map((person) => (
										<li key={person.id} className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/60 py-1 pl-1 pr-2">
											<span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-bold text-muted-foreground ring-2 ring-card">
												{person.photo ? (
													<img src={person.photo} alt="" className="size-full object-cover" />
												) : (
													(person.name?.[0]?.toUpperCase() ?? '?')
												)}
											</span>
											<span className="max-w-32 truncate text-xs font-semibold leading-myanmar text-foreground">{person.name}</span>
											<button
												type="button"
												aria-label={`Remove ${person.name}`}
												onClick={() => toggleAssignee(person)}
												className="rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground"
											>
												<X className="size-3.5" aria-hidden />
											</button>
										</li>
									))}
								</ul>
							)}
							<PersonnelPickerSheet
								open={pickerOpen}
								onOpenChange={setPickerOpen}
								value={assignees}
								onToggle={toggleAssignee}
								title="Select assignees"
							/>
						</>
					)}
				</FormField>

				<FormField label="Due date (optional)" error={overdue ? 'This date is already in the past.' : null}>
					{(_f, h) => <DateField value={dueDate} onChange={setDueDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />}
				</FormField>

				<FormError error={error} />

				<FormSubmitBar
					label={submitLabel}
					type="submit"
					isMainButton={isMainButton}
					disabled={!canSave}
					submitting={saving}
					icon={<Check className="size-4" aria-hidden />}
				/>
			</form>
		</ModuleShell>
	);
}
