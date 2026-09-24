import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';

import { cn } from '@/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/tooltip';

/**
 * LinksCard is a quick-access card that groups a list of links under a title.
 * Each row (LinksCardItem) spans the full card width and ends with a
 * move-up-right icon as an "open" affordance. Items can be marked disabled,
 * optionally explaining why via a tooltip (`disabledReason`).
 *
 * @example
 * ```tsx
 * <LinksCard title="Reports">
 *   <LinksCardItem href="/reports/production">Production Report</LinksCardItem>
 *   <LinksCardItem href="/reports/bom" disabled disabledReason="Create a BOM first">
 *     BOM Search
 *   </LinksCardItem>
 * </LinksCard>
 * ```
 */
function LinksCard({
	className,
	title,
	description,
	action,
	children,
	...props
}: React.ComponentProps<'div'> & {
	title: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div
			data-slot="links-card"
			className={cn(
				'flex flex-col overflow-hidden rounded-sm bg-card text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)]',
				className,
			)}
			{...props}
		>
			<div
				data-slot="links-card-header"
				className={cn(
					'grid auto-rows-min items-start gap-1 px-(--card-spacing) pt-(--card-spacing) pb-2 has-data-[slot=links-card-action]:grid-cols-[1fr_auto]',
				)}
			>
				<div className="grid gap-0.5">
					<div data-slot="links-card-title" className="cn-font-heading text-base leading-snug font-medium">
						{title}
					</div>
					{description ? (
						<div data-slot="links-card-description" className="text-sm text-muted-foreground">
							{description}
						</div>
					) : null}
				</div>
				{action ? (
					<div data-slot="links-card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
						{action}
					</div>
				) : null}
			</div>
			<div data-slot="links-card-list" role="list" className="flex flex-col px-(--card-spacing) pb-(--card-spacing)">
				{children}
			</div>
		</div>
	);
}

function LinksCardItem({
	className,
	href,
	disabled = false,
	disabledReason,
	endIcon,
	children,
	...props
}: React.ComponentProps<'a'> & {
	disabled?: boolean;
	disabledReason?: string;
	endIcon?: React.ReactNode;
}) {
	const content = (
		<a
			data-slot="links-card-item"
			role="listitem"
			data-disabled={disabled || undefined}
			href={disabled ? undefined : href}
			aria-disabled={disabled || undefined}
			tabIndex={disabled ? -1 : undefined}
			className={cn(
				'group/links-card-item flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-sm py-px text-sm text-foreground/90 transition-colors outline-none hover:text-card-foreground focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/30',
				'data-[disabled=true]:cursor-default data-[disabled=true]:text-muted-foreground/70 data-[disabled=true]:hover:bg-transparent data-[disabled=true]:hover:text-muted-foreground/70',
				className,
			)}
			{...props}
		>
			<span className="min-w-0 truncate leading-6">{children}</span>
			{!disabled ? (
				<span
					data-slot="links-card-item-icon"
					aria-hidden="true"
					className="flex shrink-0 text-muted-foreground/80 transition-colors group-hover/links-card-item:text-card-foreground"
				>
					{endIcon ?? <ArrowUpRight className="size-3.5" strokeWidth={1.8} />}
				</span>
			) : null}
		</a>
	);

	if (disabled && disabledReason) {
		return (
			<Tooltip>
				<TooltipTrigger render={<span className="flex w-full rounded-md" />}>{content}</TooltipTrigger>
				<TooltipContent>{disabledReason}</TooltipContent>
			</Tooltip>
		);
	}

	return content;
}

export { LinksCard, LinksCardItem };
