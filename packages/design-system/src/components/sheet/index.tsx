'use client';

import * as React from 'react';
import { Dialog as SheetPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';

import { cn } from '@/utils';
import { Button } from '@/button';
import { useScrollLock } from '@/hooks/use-scroll-lock';

function Sheet({ open, ...props }: SheetPrimitive.Root.Props) {
	// Lock the page behind the sheet while it's open — wheel/touch scrolling
	// inside the sheet (option lists, form bodies, …) must never chain into the
	// background content. Nested sheets (a picker inside a form sheet) stack via
	// the hook's depth counter. Callers pass `open` (all current consumers do);
	// uncontrolled sheets simply never lock.
	useScrollLock(Boolean(open));
	return <SheetPrimitive.Root data-slot="sheet" open={open} {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
	return (
		<SheetPrimitive.Backdrop
			data-slot="sheet-overlay"
			className={cn(
				'fixed inset-0 z-50 bg-black/10 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs',
				className,
			)}
			{...props}
		/>
	);
}

function SheetContent({
	className,
	children,
	side = 'right',
	showCloseButton = true,
	centerOnDesktop = false,
	...props
}: SheetPrimitive.Popup.Props & {
	side?: 'top' | 'right' | 'bottom' | 'left';
	showCloseButton?: boolean;
	/** Bottom sheets become a CENTERED MODAL DIALOG at md+ (enterprise layout);
	 *  below md the mobile bottom-sheet behavior is untouched. */
	centerOnDesktop?: boolean;
}) {
	const bottomCenter = side === 'bottom' && centerOnDesktop;
	return (
		<SheetPortal>
			<SheetOverlay />
			<SheetPrimitive.Popup
				data-slot="sheet-content"
				data-side={side}
				className={cn(
					'fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out overscroll-contain data-ending-style:opacity-0 data-starting-style:opacity-0',
					bottomCenter
						? // Mobile (<md): identical to the plain bottom sheet. Desktop (md+):
							// a centered modal dialog — mobile positioning is scoped to
							// `max-md:` (so `bottom-0` can't leak up), dialog classes live
							// under `md:`. No transform-based centering (avoid clashing with
							// the enter/exit animation transforms); top-aligned instead.
							'max-md:data-[side=bottom]:inset-x-0 max-md:data-[side=bottom]:bottom-0 max-md:data-[side=bottom]:h-auto max-md:data-[side=bottom]:rounded-t-2xl max-md:data-[side=bottom]:data-starting-style:translate-y-10 max-md:data-[side=bottom]:data-ending-style:translate-y-10 md:data-[side=bottom]:inset-x-0 md:data-[side=bottom]:top-6 md:data-[side=bottom]:h-fit md:data-[side=bottom]:max-h-[86dvh] md:data-[side=bottom]:w-[min(680px,92vw)] md:data-[side=bottom]:mx-auto md:data-[side=bottom]:rounded-2xl md:data-[side=bottom]:border md:data-[side=bottom]:shadow-xl md:data-[side=bottom]:overflow-hidden md:data-[side=bottom]:data-starting-style:-translate-y-6 md:data-[side=bottom]:data-ending-style:-translate-y-6'
						: 'data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:rounded-t-2xl data-[side=bottom]:data-ending-style:translate-y-10 data-[side=bottom]:data-starting-style:translate-y-10 data-[side=bottom]:sm:mx-auto data-[side=bottom]:sm:max-w-2xl data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:-translate-x-10 data-[side=left]:data-starting-style:-translate-x-10 data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-10 data-[side=right]:data-starting-style:translate-x-10 data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:-translate-y-10 data-[side=top]:data-starting-style:-translate-y-10 data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm',
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<SheetPrimitive.Close
						data-slot="sheet-close"
						render={
							<Button variant="ghost" className="absolute top-3 right-3 rounded-full" size="icon-sm">
								<XIcon />
								<span className="sr-only">Close</span>
							</Button>
						}
					/>
				)}
			</SheetPrimitive.Popup>
		</SheetPortal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
	return <div data-slot="sheet-header" className={cn('flex flex-col gap-0.5 p-4', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
	return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn('cn-font-heading text-base font-medium text-foreground', className)}
			{...props}
		/>
	);
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
	return <SheetPrimitive.Description data-slot="sheet-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
// The open/close signal for the lock `Sheet` holds (see `useScrollLock`) — a
// consumer that must react to "a sheet covers the page" (the Telegram Mini App
// hides its native MainButton) reads THIS rather than re-wiring every caller's
// `open` state.
export { useOverlayOpen } from '@/hooks/use-scroll-lock';
