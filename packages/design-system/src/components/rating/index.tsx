'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/utils';
import { Label } from '../label';

const themeColors: Record<string, string> = {
	default: 'text-foreground',
	primary: 'text-accent/85',
	success: 'text-status-success/85',
	info: 'text-accent-blue/85',
	warning: 'text-status-warning/85',
	danger: 'text-status-error/85',
};

export interface Rating {
	value?: number;
	onChange?: (e: { value: number }) => void;
	stars?: number;
	readOnly?: boolean;
	label?: string;
	className?: string;
	theme?: 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger';
}

export const Rating = ({ value = 0, onChange, stars = 5, readOnly = false, label, className, theme = 'default' }: Rating) => {
	const [hoverValue, setHoverValue] = useState<number | null>(null);

	const handleRating = (val: number) => {
		if (readOnly) return;
		onChange?.({ value: val });
	};

	const handleMouseEnter = (val: number) => {
		if (readOnly) return;
		setHoverValue(val);
	};

	const handleMouseLeave = () => {
		if (readOnly) return;
		setHoverValue(null);
	};

	const displayValue = hoverValue !== null ? hoverValue : value;
	const activeColor = themeColors[theme] || themeColors.default;

	return (
		<div className={cn('flex flex-col gap-1', className)}>
			{label && <Label>{label}</Label>}
			<div className="flex items-center gap-1">
				{Array.from({ length: stars }).map((_, i) => {
					const ratingValue = i + 1;
					const isActive = ratingValue <= displayValue;

					return (
						<Star
							key={i}
							fill={isActive ? 'currentColor' : 'none'}
							className={cn(
								'h-4 w-4 shrink-0 transition-colors',
								isActive ? activeColor : 'text-border-default',
								!readOnly && 'cursor-pointer hover:scale-110 active:scale-95',
							)}
							onMouseEnter={() => handleMouseEnter(ratingValue)}
							onMouseLeave={handleMouseLeave}
							onClick={() => handleRating(ratingValue)}
						/>
					);
				})}
			</div>
		</div>
	);
};

Rating.displayName = 'Rating';
