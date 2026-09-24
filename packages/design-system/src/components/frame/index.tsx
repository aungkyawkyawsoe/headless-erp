import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/utils';

const frameVariants = cva('relative rounded-xl', {
	variants: {
		variant: {
			default: 'border border-border bg-card text-card-foreground',
			ghost: 'border-transparent bg-transparent',
		},
	},
	defaultVariants: {
		variant: 'default',
	},
});

function Frame({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof frameVariants>) {
	return <div data-slot="frame" className={cn(frameVariants({ variant }), className)} {...props} />;
}

function FramePanel({ className, ...props }: React.ComponentProps<'div'>) {
	return <div data-slot="frame-panel" className={cn('p-4', className)} {...props} />;
}

export { Frame, FramePanel };
