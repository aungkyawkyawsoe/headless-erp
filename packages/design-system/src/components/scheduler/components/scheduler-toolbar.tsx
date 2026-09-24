/**
 * SchedulerToolbar — the nav bar: prev/today/next, the range headline and the
 * view switcher (Month / Week / Day / Agenda), mirroring the mockup's
 * `[<] [>] [Today] August 2026` + `[Cal] [List] [Clock]` controls.
 */
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Clock, List } from 'lucide-react';
import { cn } from '@/utils';
import { Button } from '@/button';
import { ButtonGroup } from '@/button-group';
import type { SchedulerLabels, SchedulerView } from '../core/types';

export interface SchedulerToolbarProps {
	rangeLabel: string;
	view: SchedulerView;
	onViewChange: (view: SchedulerView) => void;
	onPrev: () => void;
	onNext: () => void;
	onToday: () => void;
	labels: Required<Pick<SchedulerLabels, 'today' | 'month' | 'week' | 'day' | 'agenda'>>;
}

const VIEW_ICONS: Record<SchedulerView, React.ReactNode> = {
	month: <CalendarDays />,
	week: <Clock />,
	day: <CalendarRange />,
	agenda: <List />,
};

export function SchedulerToolbar({ rangeLabel, view, onViewChange, onPrev, onNext, onToday, labels }: SchedulerToolbarProps) {
	const views: Array<{ value: SchedulerView; label: string }> = [
		{ value: 'month', label: labels.month },
		{ value: 'week', label: labels.week },
		{ value: 'day', label: labels.day },
		{ value: 'agenda', label: labels.agenda },
	];

	return (
		<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
			<div className="flex items-center gap-1">
				<Button variant="outline" size="icon-sm" onClick={onPrev} aria-label="Previous">
					<ChevronLeft />
				</Button>
				<Button variant="outline" size="icon-sm" onClick={onNext} aria-label="Next">
					<ChevronRight />
				</Button>
				<Button variant="outline" size="sm" onClick={onToday}>
					{labels.today}
				</Button>
				<span className="ml-1.5 text-sm font-semibold">{rangeLabel}</span>
			</div>
			<ButtonGroup aria-label="View mode" className="shrink-0">
				{views.map((v) => (
					<Button
						key={v.value}
						variant={view === v.value ? 'default' : 'outline'}
						size="sm"
						onClick={() => onViewChange(v.value)}
						aria-pressed={view === v.value}
						className={cn(view === v.value && 'bg-primary text-primary-foreground hover:bg-primary/90')}
					>
						{VIEW_ICONS[v.value]}
						{v.label}
					</Button>
				))}
			</ButtonGroup>
		</div>
	);
}
