'use client';

import * as React from 'react';
import { type LucideIcon } from 'lucide-react';

import { Button } from '../button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip';
import { cn } from '@/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface StatusBarProps {
	/** Nodes rendered in the left section. */
	left?: React.ReactNode;
	/** Nodes rendered in the middle section (fills available space). */
	middle?: React.ReactNode;
	/** Nodes rendered in the rightmost section. */
	right?: React.ReactNode;
	className?: string;
}

/* ------------------------------------------------------------------ */
/*  Reusable helper                                                   */
/* ------------------------------------------------------------------ */

/** A minimal icon button wrapped in a tooltip. Drop into `middle` or `right`. */
export function StatusBarButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={label}
						onClick={onClick}
						className="text-muted-foreground hover:text-foreground"
					>
						<Icon className="size-3.5" />
					</Button>
				}
			/>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
	);
}

/* ------------------------------------------------------------------ */
/*  StatusBar                                                         */
/* ------------------------------------------------------------------ */

/**
 * A compact status bar that docks at the bottom of the content area.
 * Three sections: left, a flexible middle, and rightmost.
 * Populate them via `left` / `middle` / `right`.
 */
export function StatusBar({ left, middle, right, className }: StatusBarProps) {
	return (
		<footer
			data-slot="status-bar"
			className={cn(
				'sticky bottom-0 z-10 flex h-7 shrink-0 items-center border-t border-border/40 bg-muted/40 text-2xs text-muted-foreground backdrop-blur-xs',
				className,
			)}
		>
			{/* Left section */}
			<div className="flex min-w-0 items-center gap-0.5 pl-1.5">{left}</div>

			{/* Middle section */}
			<div className="flex min-w-0 flex-1 items-center gap-0.5">{middle}</div>

			{/* Right section */}
			<div className="flex min-w-0 items-center gap-0.5 pr-1.5">{right}</div>
		</footer>
	);
}
