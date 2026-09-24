import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/utils';

// components/ui/input.tsx
// ... imports

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function Input({ className, type, ...props }, ref) {
	return (
		<InputPrimitive
			ref={ref}
			type={type}
			data-slot="input"
			className={cn(
				'h-7 w-full min-w-0 rounded-sm border border-input bg-(--input-bg) px-2 py-1 text-base leading-6 transition-colors outline-none',
				'file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
				'placeholder:text-muted-foreground',
				'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50',
				'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
				'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20',
				'md:text-sm',
				// Keep the invalid state for dark mode if you like, or use the variable here too:
				'dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
				className,
			)}
			{...props}
		/>
	);
});

export { Input };
