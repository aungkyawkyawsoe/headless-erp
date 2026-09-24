'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/utils';
import { Input } from '@/input';

export interface SearchBoxProps extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'className' | 'style'> {
	/** Applied to the outer wrapper (layout/sizing of the whole control). */
	className?: string;
	/** Layout style for the outer wrapper — mirrors `className`. Margins/padding here keep the trailing icon centred on the input. */
	style?: React.CSSProperties;
	/** Applied to the underlying `<input>` element. */
	inputClassName?: string;
	/** Placeholder shown while the box is empty. Defaults to `"Search..."`. */
	placeholder?: string;
	/**
	 * Controlled value. Use with `onValueChange` for controlled mode.
	 * When omitted, the component manages its own state.
	 */
	value?: string;
	/** Called with the new value on every keystroke. */
	onValueChange?: (value: string) => void;
	/** Called when the clear (X) button is clicked. */
	onClear?: () => void;
	/** Accessible label for the clear button. Defaults to `"Clear search"`. */
	clearLabel?: string;
	/** Standard input change handler — fires with the raw event. */
	onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

/**
 * A self-contained search input.
 *
 * While empty it shows a placeholder with a magnifier icon at the end of the
 * field. Once the user types, the icon is replaced by a circular clear (X)
 * button that resets the value and returns focus to the input.
 *
 * Works controlled (`value` + `onValueChange`) or uncontrolled.
 */
export const SearchBox = React.forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
	{
		className,
		style,
		inputClassName,
		placeholder = 'Search...',
		value: valueProp,
		onValueChange,
		onClear,
		clearLabel = 'Clear search',
		onChange,
		...props
	},
	ref,
) {
	const [internalValue, setInternalValue] = React.useState('');
	const isControlled = valueProp !== undefined;
	const value = isControlled ? valueProp : internalValue;
	const hasValue = value.length > 0;

	const containerRef = React.useRef<HTMLDivElement>(null);

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (!isControlled) setInternalValue(event.target.value);
		onChange?.(event);
		onValueChange?.(event.target.value);
	};

	const handleClear = () => {
		if (!isControlled) setInternalValue('');
		onValueChange?.('');
		onClear?.();
		containerRef.current?.querySelector('input')?.focus();
	};

	return (
		<div ref={containerRef} style={style} className={cn('relative w-full', className)}>
			<Input
				ref={ref}
				type="search"
				value={value}
				onChange={handleChange}
				placeholder={placeholder}
				className={cn('pr-8 [&::-webkit-search-cancel-button]:hidden', inputClassName)}
				{...props}
			/>
			<div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
				{hasValue ? (
					<button
						type="button"
						aria-label={clearLabel}
						onClick={handleClear}
						className="pointer-events-auto flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>
						<X strokeWidth={1.5} className="size-3" />
					</button>
				) : (
					<Search strokeWidth={1.5} className="size-3.5 text-muted-foreground" />
				)}
			</div>
		</div>
	);
});
