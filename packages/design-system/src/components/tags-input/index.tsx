'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils';

export interface TagsInputProps {
	value?: string[];
	onChange?: (tags: string[]) => void;
	placeholder?: string;
	disabled?: boolean;
	maxTags?: number;
	className?: string;
}

export function TagsInput({ value = [], onChange, placeholder = 'Add tag...', disabled = false, maxTags, className }: TagsInputProps) {
	const [input, setInput] = React.useState('');

	function addTag() {
		const t = input.trim();
		if (!t) return;
		if (value.includes(t)) return;
		if (maxTags && value.length >= maxTags) return;
		onChange?.([...value, t]);
		setInput('');
	}

	function removeTag(index: number) {
		onChange?.(value.filter((_, i) => i !== index));
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTag();
		}
		if (e.key === 'Backspace' && !input && value.length) {
			removeTag(value.length - 1);
		}
	}

	return (
		<div
			data-slot="tags-input"
			className={cn(
				'flex min-h-7 flex-wrap items-center gap-1 rounded-sm border border-input bg-transparent px-1 py-0.75 transition-colors',
				'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50',
				disabled && 'cursor-not-allowed bg-input/50 opacity-50',
				className,
			)}
		>
			{value.map((tag, i) => (
				<span key={`${tag}-${i}`} className="inline-flex items-center gap-0.5 rounded-sm bg-muted px-1 py-0.5 text-xs font-medium">
					{tag}
					{!disabled && (
						<button
							type="button"
							className="ml-0.5 cursor-pointer rounded-sm p-0 text-muted-foreground hover:text-foreground"
							onClick={() => removeTag(i)}
							aria-label={`Remove ${tag}`}
						>
							<X className="size-3" />
						</button>
					)}
				</span>
			))}
			{(!maxTags || value.length < maxTags) && (
				<input
					className="min-w-16 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					value={input}
					disabled={disabled}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={value.length === 0 ? placeholder : undefined}
				/>
			)}
			{maxTags && value.length >= maxTags && (
				<span className="px-1 text-xs text-muted-foreground">
					{value.length}/{maxTags}
				</span>
			)}
		</div>
	);
}
