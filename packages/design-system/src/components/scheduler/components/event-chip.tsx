/**
 * EventChip — the single event renderer for every view (time grid, month
 * cells, agenda rows). `compact` renders a dot + truncated title (month
 * cells); the full variant adds a time prefix and a tinted background
 * (time grid). Color comes from the event's `color` (hex or named tone).
 */
import { cn } from '@/utils';
import { colorOf, withAlpha, type NormalizedEvent } from '../core/utils';

interface EventChipProps {
	event: NormalizedEvent;
	onClick?: (event: NormalizedEvent) => void;
	compact?: boolean;
	className?: string;
	style?: React.CSSProperties;
}

function formatTime(date: Date): string {
	return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export function EventChip({ event, onClick, compact = false, className, style }: EventChipProps) {
	const color = colorOf(event.color);
	const handleClick = () => onClick?.(event);

	if (compact) {
		return (
			<button
				type="button"
				onClick={handleClick}
				title={event.title}
				style={style}
				className={cn(
					'flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1 py-px text-left text-[0.68rem] font-medium hover:brightness-90',
					className,
				)}
			>
				<span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
				<span className="truncate" style={{ color }}>
					{event.title}
				</span>
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			title={event.title}
			style={{
				...style,
				background: withAlpha(color, '1c'),
				borderLeft: `3px solid ${color}`,
				color,
			}}
			className={cn(
				'flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-sm px-1.5 py-0.5 text-left text-[0.7rem] font-medium shadow-sm hover:brightness-95',
				className,
			)}
		>
			{!event.allDay ? <span className="shrink-0 text-[0.62rem] opacity-80">{formatTime(event.start)}</span> : null}
			<span className="truncate">{event.title}</span>
		</button>
	);
}
