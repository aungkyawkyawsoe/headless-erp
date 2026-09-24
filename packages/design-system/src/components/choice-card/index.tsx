'use client';

import { cn } from '@/utils';
import { FieldLabel, FieldContent, FieldTitle, FieldDescription } from '@/field';

/**
 * ChoiceCard wraps content and an input (Checkbox or RadioGroupItem)
 * inside a clickable label so the entire card toggles the control.
 *
 * The input is automatically positioned at the top-right of the card.
 *
 * @example
 * ```tsx
 * <ChoiceCard>
 *   <ChoiceCardContent>
 *     <ChoiceCardTitle>Kubernetes</ChoiceCardTitle>
 *     <ChoiceCardDescription>
 *       Managed Kubernetes cluster with auto-scaling.
 *     </ChoiceCardDescription>
 *   </ChoiceCardContent>
 *   <Checkbox id="k8s" />
 * </ChoiceCard>
 * ```
 */
function ChoiceCard({ className, ...props }: React.ComponentProps<typeof FieldLabel>) {
	return (
		<FieldLabel
			data-slot="choice-card"
			className={cn(
				'flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border p-4 transition-colors',
				'has-data-checked:border-primary/30 has-data-checked:bg-primary/5',
				'dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10',
				'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
				className,
			)}
			{...props}
		/>
	);
}

function ChoiceCardContent({ className, ...props }: React.ComponentProps<typeof FieldContent>) {
	return <FieldContent data-slot="choice-card-content" className={cn('min-w-0 flex-1', className)} {...props} />;
}

function ChoiceCardTitle({ className, ...props }: React.ComponentProps<typeof FieldTitle>) {
	return <FieldTitle data-slot="choice-card-title" className={cn('', className)} {...props} />;
}

function ChoiceCardDescription({ className, ...props }: React.ComponentProps<typeof FieldDescription>) {
	return <FieldDescription data-slot="choice-card-description" className={cn('', className)} {...props} />;
}

export { ChoiceCard, ChoiceCardContent, ChoiceCardTitle, ChoiceCardDescription };
