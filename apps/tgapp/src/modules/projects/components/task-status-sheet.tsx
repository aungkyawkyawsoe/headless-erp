import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Check } from 'lucide-react';

import { TASK_STATE_FORM_OPTIONS, TASK_STATE_META } from '../data/meta';
import type { TaskState } from '../data/types';
import { hapticSelection } from '@/shared/platform/haptics';

interface TaskStatusSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The task's current state — its row renders a check mark. */
	value: TaskState | null;
	/** Fired on a row tap with the chosen state; the caller persists it. */
	onChange: (state: TaskState) => void;
}

/**
 * The task screen's status picker — the status pill's dropdown. Lists the three
 * real `hrm_tasks.state` values and sets the chosen one directly, so a task can
 * be moved to any state in one tap (the header's primary button offers only the
 * next natural transition).
 */
export function TaskStatusSheet({ open, onOpenChange, value, onChange }: TaskStatusSheetProps) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom" className="p-0">
				<SheetHeader>
					<SheetTitle className="px-5 pt-4">Task status</SheetTitle>
				</SheetHeader>
				<ul className="px-3 pb-safe pt-2">
					{TASK_STATE_FORM_OPTIONS.map((option) => {
						const meta = TASK_STATE_META[option.value];
						const selected = option.value === value;
						return (
							<li key={option.value}>
								<button
									type="button"
									aria-pressed={selected}
									onClick={() => {
										hapticSelection();
										onChange(option.value);
									}}
									className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-muted/60"
								>
									<span
										className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chipClass}`}
									>
										<span className={`size-1.5 rounded-full ${meta.dotClass}`} />
										{meta.label}
									</span>
									{selected && <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden />}
								</button>
							</li>
						);
					})}
				</ul>
			</SheetContent>
		</Sheet>
	);
}
