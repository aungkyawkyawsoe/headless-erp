/**
 * A titled dialog that hosts one admin panel (permissions / workflow / audit /
 * policies / generation) for a collection.
 *
 * The collection admin surfaces are all the same shell — a `Dialog` wrapping a
 * `DialogHeader` and a panel — so the chrome lives here once and each caller
 * supplies only the title, description and panel. Behaviour is unchanged.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@mmbix/design-system';

export function PanelDialog({
	open,
	onOpenChange,
	title,
	description,
	contentStyle,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	contentStyle?: CSSProperties;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent style={contentStyle}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{children}
			</DialogContent>
		</Dialog>
	);
}
