import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@mmbix/design-system';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, CopyPlus, Trash2 } from 'lucide-react';

export interface BlockContextMenuProps {
	onDuplicate?: () => void;
	onCopy?: () => void;
	onPaste?: () => void;
	/** Paste is offered only when the clipboard actually holds a block. */
	canPaste?: boolean;
	onMoveUp?: () => void;
	onMoveDown?: () => void;
	onDelete?: () => void;
	children: ReactNode;
}

/** Right-click context menu for canvas elements — tools come to the cursor (Fitts's Law). */
export default function BlockContextMenu({
	onDuplicate,
	onCopy,
	onPaste,
	canPaste,
	onMoveUp,
	onMoveDown,
	onDelete,
	children,
}: BlockContextMenuProps) {
	return (
		<ContextMenu>
			<ContextMenuTrigger>{children}</ContextMenuTrigger>
			<ContextMenuContent sideOffset={4} style={{ minWidth: 190 }}>
				{onDuplicate && (
					<ContextMenuItem onClick={onDuplicate}>
						<CopyPlus size={13} /> Duplicate
						<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#9ca3af' }}>⌘D</span>
					</ContextMenuItem>
				)}
				{onCopy && (
					<ContextMenuItem onClick={onCopy}>
						<Copy size={13} /> Copy
						<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#9ca3af' }}>⌘C</span>
					</ContextMenuItem>
				)}
				{onPaste && canPaste !== false && (
					<ContextMenuItem onClick={onPaste}>
						<ClipboardPaste size={13} /> Paste
						<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#9ca3af' }}>⌘V</span>
					</ContextMenuItem>
				)}
				{(onMoveUp || onMoveDown) && (
					<>
						<ContextMenuSeparator />
						{onMoveUp && (
							<ContextMenuItem onClick={onMoveUp}>
								<ArrowUp size={13} /> Move up
							</ContextMenuItem>
						)}
						{onMoveDown && (
							<ContextMenuItem onClick={onMoveDown}>
								<ArrowDown size={13} /> Move down
							</ContextMenuItem>
						)}
					</>
				)}
				{onDelete && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem onClick={onDelete} variant="destructive">
							<Trash2 size={13} /> Delete
							<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#9ca3af' }}>⌫</span>
						</ContextMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
