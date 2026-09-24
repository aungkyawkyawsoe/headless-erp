'use client';

import * as React from 'react';
import { cn } from '@/utils';
import { Input } from '../input';
import { NativeSelect, NativeSelectOption } from '../native-select';
import { COLOR_FORMATS, formatColor, parseColor, type ColorFormat } from './color';

export interface ColorPickerProps {
	/**
	 * Selected color as a CSS string in any supported format
	 * (`#rrggbb`, `#rrggbbaa`, `rgb()`, `hsl()`, `oklch()`).
	 */
	value?: string;
	/** Called with the new color whenever it changes. */
	onChange?: (value: string) => void;
	/** Format of the text field. Controlled version of `defaultFormat`. */
	format?: ColorFormat;
	/** Format of the text field when uncontrolled. Defaults to `"hex"`. */
	defaultFormat?: ColorFormat;
	/** Formats offered in the format switcher. Defaults to all four. */
	formats?: ColorFormat[];
	/** Called when the user switches format via the dropdown. */
	onFormatChange?: (format: ColorFormat) => void;
	disabled?: boolean;
	placeholder?: string;
	className?: string;
}

const FORMAT_LABELS: Record<ColorFormat, string> = {
	hex: 'HEX',
	rgb: 'RGB',
	hsl: 'HSL',
	oklch: 'OKLCH',
};

const FALLBACK = { r: 0, g: 0, b: 0, a: 1 };

export function ColorPicker({
	value,
	onChange,
	format,
	defaultFormat = 'hex',
	formats,
	onFormatChange,
	disabled,
	placeholder = 'Pick a color',
	className,
}: ColorPickerProps) {
	// Raw text shown in the field. Syncs with the controlled `value` prop.
	const [internal, setInternal] = React.useState(value ?? '');
	const [prevValue, setPrevValue] = React.useState(value);
	if (prevValue !== value) {
		setPrevValue(value);
		setInternal(value ?? '');
	}

	const [formatState, setFormatState] = React.useState<ColorFormat>(defaultFormat);
	const activeFormat = format ?? formatState;

	// Re-render the field text when the (controlled) format changes.
	const [prevFormat, setPrevFormat] = React.useState(activeFormat);
	if (prevFormat !== activeFormat) {
		setPrevFormat(activeFormat);
		const parsed = parseColor(internal);
		if (parsed) setInternal(formatColor(parsed, activeFormat));
	}

	// Restrict the switcher to the formats the consumer opted into, and make
	// sure the active format is one of them.
	const availableFormats = (formats ?? COLOR_FORMATS).filter((f): f is ColorFormat => f in FORMAT_LABELS);
	const effectiveFormat = availableFormats.includes(activeFormat) ? activeFormat : (availableFormats[0] ?? 'hex');

	const parsed = React.useMemo(() => parseColor(internal), [internal]);
	const color = parsed ?? FALLBACK;

	const handleTextChange = (text: string) => {
		setInternal(text);
		onChange?.(text);
	};

	const handleNativeChange = (hex: string) => {
		const next = parseColor(hex);
		if (!next) return;
		const formatted = formatColor(next, effectiveFormat);
		setInternal(formatted);
		onChange?.(formatted);
	};

	const handleFormatChange = (next: ColorFormat) => {
		if (next === effectiveFormat) return;
		const parsedColor = parseColor(internal);
		if (parsedColor) setInternal(formatColor(parsedColor, next));
		if (format == null) setFormatState(next);
		onFormatChange?.(next);
	};

	const nativeInputRef = React.useRef<HTMLInputElement>(null);

	return (
		<div className={cn('relative', className)}>
			<div className="flex items-center gap-2">
				{/* Swatch trigger — opens the native color picker */}
				<button
					type="button"
					disabled={disabled}
					onClick={() => nativeInputRef.current?.click()}
					className={cn(
						'h-7 w-7 shrink-0 rounded-sm transition-shadow',
						'hover:ring-2 hover:ring-ring/20',
						disabled && 'cursor-not-allowed opacity-50',
					)}
					style={{
						backgroundColor: `rgb(${color.r} ${color.g} ${color.b} / ${color.a})`,
					}}
					aria-label={placeholder}
				/>
				{/* Hidden native color input */}
				<input
					ref={nativeInputRef}
					type="color"
					value={`#${[color.r, color.g, color.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`}
					disabled={disabled}
					onChange={(e) => handleNativeChange(e.target.value)}
					className="sr-only"
					aria-hidden="true"
					tabIndex={-1}
				/>
				{/* Color text field — edits the color in the active format */}
				<Input
					value={internal}
					placeholder={placeholder}
					disabled={disabled}
					onChange={(e) => handleTextChange(e.target.value)}
					aria-label={`Color in ${effectiveFormat.toUpperCase()} format`}
					className="w-60 font-mono text-sm"
				/>
				{/* Format switcher */}
				{availableFormats.length > 1 && (
					<NativeSelect
						size="sm"
						value={effectiveFormat}
						disabled={disabled}
						onChange={(e) => handleFormatChange(e.target.value as ColorFormat)}
						aria-label="Color format"
						className="shrink-0"
					>
						{availableFormats.map((f) => (
							<NativeSelectOption key={f} value={f}>
								{FORMAT_LABELS[f]}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</div>
		</div>
	);
}

export { COLOR_FORMATS, parseColor, formatColor };
export type { ColorFormat, RGBA } from './color';
