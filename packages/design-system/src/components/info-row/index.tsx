import * as React from 'react';

import { cn } from '@/utils';

/**
 * InfoRow — a compact icon + label + value row (e.g. phone or tenure lines in
 * a record card). `icon` is any ReactNode (usually a lucide icon); the row
 * stays muted and truncates long values.
 *
 * @example
 * ```tsx
 * <InfoRow icon={<Phone size={12} />} value="09-421012345" />
 * <InfoRow icon={<CalendarDays size={12} />} label="Tenure" value="1y 2m 6d" />
 * ```
 */
const InfoRow = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<'div'> & {
		icon?: React.ReactNode;
		label?: React.ReactNode;
		value?: React.ReactNode;
	}
>(function InfoRow({ className, icon, label, value, ...props }, ref) {
	return (
		<div ref={ref} data-slot="info-row" className={cn('flex min-w-0 items-center gap-1', className)} {...props}>
			{icon ? (
				<span aria-hidden="true" className="flex shrink-0 items-center text-muted-foreground [&>svg]:size-3">
					{icon}
				</span>
			) : null}
			{label ? <span className="shrink-0 text-[0.78rem] font-medium text-muted-foreground">{label}</span> : null}
			{value ? <span className="truncate text-[0.78rem] text-foreground">{value}</span> : null}
		</div>
	);
});

export { InfoRow };
