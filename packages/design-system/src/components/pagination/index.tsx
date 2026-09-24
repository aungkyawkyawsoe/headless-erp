import * as React from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react';

import { cn } from '@/utils';
import { Button } from '@/button';

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
	return (
		<nav
			role="navigation"
			aria-label="pagination"
			data-slot="pagination"
			className={cn('mx-auto flex w-full justify-center', className)}
			{...props}
		/>
	);
}

function PaginationContent({ className, ...props }: React.ComponentProps<'ul'>) {
	return <ul data-slot="pagination-content" className={cn('flex items-center gap-0.5', className)} {...props} />;
}

function PaginationItem({ ...props }: React.ComponentProps<'li'>) {
	return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
	isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
	React.ComponentProps<'a'>;

function PaginationLink({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) {
	return (
		<Button
			variant={isActive ? 'outline' : 'ghost'}
			size={size}
			className={cn(className)}
			nativeButton={false}
			render={<a aria-current={isActive ? 'page' : undefined} data-slot="pagination-link" data-active={isActive} {...props} />}
		/>
	);
}

function PaginationPrevious({ className, text = 'Previous', ...props }: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
	return (
		<PaginationLink aria-label="Go to previous page" size="default" className={cn('pl-1.5!', className)} {...props}>
			<ChevronLeftIcon data-icon="inline-start" className="cn-rtl-flip" />
			<span className="hidden sm:block">{text}</span>
		</PaginationLink>
	);
}

function PaginationNext({ className, text = 'Next', ...props }: React.ComponentProps<typeof PaginationLink> & { text?: string }) {
	return (
		<PaginationLink aria-label="Go to next page" size="default" className={cn('pr-1.5!', className)} {...props}>
			<span className="hidden sm:block">{text}</span>
			<ChevronRightIcon data-icon="inline-end" className="cn-rtl-flip" />
		</PaginationLink>
	);
}

function PaginationEllipsis({ className, ...props }: React.ComponentProps<'span'>) {
	return (
		<span
			aria-hidden
			data-slot="pagination-ellipsis"
			className={cn("flex size-7 items-center justify-center [&_svg:not([class*='size-'])]:size-4", className)}
			{...props}
		>
			<MoreHorizontalIcon />
			<span className="sr-only">More pages</span>
		</span>
	);
}

type PaginationSummaryProps = React.ComponentProps<'span'> & {
	from: number | string;
	to: number | string;
};

function PaginationSummary({ className, from, to, ...props }: PaginationSummaryProps) {
	return (
		<span data-slot="pagination-summary" className={cn('text-sm whitespace-nowrap text-muted-foreground', className)} {...props}>
			{from}–{to}
		</span>
	);
}

type PaginationCursorProps = React.ComponentProps<'div'> & {
	from: number | string;
	to: number | string;
	/** Whether the previous/next buttons are enabled. Defaults to `true`. */
	canPrevious?: boolean;
	canNext?: boolean;
	onPrevious?: () => void;
	onNext?: () => void;
};

/**
 * Cursor-only pagination: a range summary (`0–25`) with previous/next arrow
 * buttons, for offset/cursor-based navigation without page numbers.
 */
function PaginationCursor({
	className,
	from,
	to,
	canPrevious = true,
	canNext = true,
	onPrevious,
	onNext,
	...props
}: PaginationCursorProps) {
	return (
		<div data-slot="pagination-cursor" className={cn('flex items-center gap-2', className)} {...props}>
			<PaginationSummary from={from} to={to} />
			<div className="flex items-center gap-0.5">
				<Button variant="ghost" size="icon-sm" disabled={!canPrevious} onClick={onPrevious} aria-label="Go to previous page">
					<ChevronLeftIcon className="cn-rtl-flip size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" disabled={!canNext} onClick={onNext} aria-label="Go to next page">
					<ChevronRightIcon className="cn-rtl-flip size-4" />
				</Button>
			</div>
		</div>
	);
}

export {
	Pagination,
	PaginationContent,
	PaginationCursor,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
	PaginationSummary,
};
