import * as React from 'react';

import { cn } from '@/utils';

const TONES: Record<string, string> = {
	success: 'bg-[#e8f5e9] text-[#2e7d32]',
	warning: 'bg-[#fff3e0] text-[#e65100]',
	danger: 'bg-[#fdecec] text-[#c62828]',
	neutral: 'bg-[#f3f4f6] text-[#6b7280]',
};

/**
 * CounterChip — a small colored count pill (e.g. Leave Applications / Attendance /
 * Documents counts on a record card). Tone: success | warning | danger | neutral.
 *
 * @example
 * ```tsx
 * <CounterChip label="Leave Applications" count={1} tone="success" />
 * ```
 */
const CounterChip = React.forwardRef<
	HTMLSpanElement,
	React.ComponentProps<'span'> & {
		label?: string;
		count?: number | string;
		tone?: string;
	}
>(function CounterChip({ className, label, count = 0, tone = 'neutral', ...props }, ref) {
	return (
		<span
			ref={ref}
			data-slot="counter-chip"
			data-tone={tone}
			title={label}
			className={cn(
				'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[0.64rem] font-bold',
				TONES[tone] ?? TONES.neutral,
				className,
			)}
			{...props}
		>
			{count}
		</span>
	);
});

export { CounterChip };
