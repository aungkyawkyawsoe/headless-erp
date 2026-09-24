'use client';

import { cn } from '@/utils';
import type { KanbanProgressRingProps } from './core/types';

/**
 * A minimal SVG circular progress indicator.
 * Zero dependencies — just an SVG circle with stroke-dasharray math.
 *
 * @example
 * ```tsx
 * <KanbanProgressRing percentage={65} size={28} />
 * ```
 */
function KanbanProgressRing({
	percentage,
	size = 24,
	strokeWidth = 2.5,
	trackClassName,
	progressClassName,
	className,
}: KanbanProgressRingProps) {
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const clampedPercentage = Math.max(0, Math.min(100, percentage));
	const dashOffset = circumference - (clampedPercentage / 100) * circumference;

	return (
		<svg
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			className={cn('shrink-0 -rotate-90', className)}
			role="progressbar"
			aria-valuenow={clampedPercentage}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-label={`${clampedPercentage}%`}
			data-slot="kanban-progress-ring"
		>
			{/* Track (background circle) */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				className={trackClassName ?? 'text-muted/20'}
			/>
			{/* Progress arc */}
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeDasharray={circumference}
				strokeDashoffset={dashOffset}
				className={cn('transition-[stroke-dashoffset] duration-500 ease-out', progressClassName ?? 'text-primary')}
			/>
		</svg>
	);
}

export { KanbanProgressRing };
