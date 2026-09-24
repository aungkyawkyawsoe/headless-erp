import { Loader2Icon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils';

const spinnerVariants = cva('animate-spin', {
	variants: {
		variant: {
			default: 'size-4',
			ios: 'relative inline-block size-4',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
});

// iOS-style spinner geometry (percent of the spinner box). The ticks sit
// near the rim, leaving a hole in the middle like the classic
// UIActivityIndicatorView.
const IOS_SPINNER_SEGMENTS = 12;
const IOS_SPINNER_TICK_TOP = 14;
const IOS_SPINNER_TICK_HEIGHT = 22;
const IOS_SPINNER_FADE_SEGMENTS = 8; // segments over which the trail fades out

function Spinner({
	className,
	variant = 'default',
	...props
}: React.ComponentProps<typeof Loader2Icon> & VariantProps<typeof spinnerVariants>) {
	if (variant === 'ios') {
		// Rotation origin is the box center, which sits
		// `(50 - tickTop) / tickHeight` below the tick's own top.
		const originY = `${((50 - IOS_SPINNER_TICK_TOP) / IOS_SPINNER_TICK_HEIGHT) * 100}%`;

		return (
			<span
				data-slot="spinner"
				role="status"
				aria-label="Loading"
				className={cn(spinnerVariants({ variant }), className)}
				{...(props as unknown as React.ComponentProps<'span'>)}
			>
				{Array.from({ length: IOS_SPINNER_SEGMENTS }, (_, index) => (
					<span
						key={index}
						aria-hidden="true"
						className="absolute top-[14%] left-1/2 ml-[-3.5%] h-[22%] w-[7%] rounded-full bg-current"
						style={{
							opacity: Math.max(0.1, 1 - index / IOS_SPINNER_FADE_SEGMENTS),
							transform: `rotate(${(360 / IOS_SPINNER_SEGMENTS) * index}deg)`,
							transformOrigin: `50% ${originY}`,
						}}
					/>
				))}
			</span>
		);
	}

	return (
		<Loader2Icon
			data-slot="spinner"
			role="status"
			aria-label="Loading"
			className={cn(spinnerVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Spinner };
