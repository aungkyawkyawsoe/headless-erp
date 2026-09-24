import * as React from 'react';

import { cn } from '@/utils';

const STATUS_TONES: Record<string, string> = {
	success: 'bg-[var(--mmbix-status-success,#10b981)]',
	warning: 'bg-[var(--mmbix-status-warning,#ff9500)]',
	danger: 'bg-[var(--mmbix-status-error,#ff3b30)]',
	neutral: 'bg-gray-400',
};

/**
 * MediaPanel — the left "media" column of a record-style card: a gradient
 * panel with initials, an optional status dot, and an optional dark code/sub
 * strip underneath. A real design-system component, so consumers compose it
 * instead of hardcoding markup.
 *
 * @example
 * ```tsx
 * <MediaPanel initials="HW" status="success" code="HRM-010" sub="Sales" />
 * ```
 */
const MediaPanel = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<'div'> & {
		initials?: string;
		/** Tone name: success | warning | danger | neutral (defaults to neutral). */
		status?: string;
		code?: string;
		sub?: string;
	}
>(function MediaPanel({ className, initials, status, code, sub, ...props }, ref) {
	return (
		<div ref={ref} data-slot="media-panel" className={cn('flex w-full shrink-0 flex-col', className)} {...props}>
			<div className="relative flex min-h-24 flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(rgba(20,184,166,0.22),rgba(59,130,246,0.12))]">
				{initials ? <span className="text-xl font-extrabold text-slate-900/45">{initials}</span> : null}
				{status ? (
					<span
						data-status={status}
						title="Status"
						className={cn(
							'absolute top-2 left-2 z-10 size-2.5 rounded-full border-2 border-card',
							STATUS_TONES[status] ?? STATUS_TONES.neutral,
						)}
					/>
				) : null}
			</div>
			{code || sub ? (
				<div className="flex flex-col gap-0.5 bg-slate-900/80 px-1.5 py-1">
					{code ? <span className="truncate text-xs leading-[1.35] font-bold text-white/95">{code}</span> : null}
					{sub ? <span className="truncate text-[0.6rem] leading-[1.35] font-bold text-white/70">{sub}</span> : null}
				</div>
			) : null}
		</div>
	);
});

export { MediaPanel };
