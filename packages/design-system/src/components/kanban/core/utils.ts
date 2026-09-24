import type { KanbanColumnDef, KanbanItem, KanbanItemMoveEvent } from './types';

/**
 * Find the column that contains a given item by id.
 * Returns undefined if the item is not found in any column.
 */
export function findColumnByItemId<TItem extends KanbanItem>(
	columns: KanbanColumnDef<TItem>[],
	itemId: string,
): KanbanColumnDef<TItem> | undefined {
	return columns.find((col) => col.items.some((item) => item.id === itemId));
}

/**
 * Remove an item from its source column and insert it into a target column
 * at the specified index. Returns new column arrays (immutable).
 */
export function moveItemBetweenColumns<TItem extends KanbanItem>(
	columns: KanbanColumnDef<TItem>[],
	itemId: string,
	targetColumnId: string,
	newIndex: number,
): { columns: KanbanColumnDef<TItem>[]; event: KanbanItemMoveEvent<TItem> } {
	let movedItem: TItem | undefined;
	let sourceColumnId: string | undefined;

	const updatedColumns = columns.map((col) => {
		const itemIndex = col.items.findIndex((item) => item.id === itemId);
		if (itemIndex === -1) return col;
		// Copy first — never splice the shared items array (it is referenced
		// by the board's state and would corrupt other columns' data)
		const items = [...col.items];
		[movedItem] = items.splice(itemIndex, 1);
		sourceColumnId = col.id;
		return { ...col, items };
	});

	if (!movedItem || !sourceColumnId) {
		throw new Error(`moveItemBetweenColumns: item "${itemId}" not found in any column`);
	}

	const finalColumns = updatedColumns.map((col) => {
		if (col.id !== targetColumnId) return col;
		const newItems = [...col.items];
		newItems.splice(newIndex, 0, movedItem!);
		return { ...col, items: newItems };
	});

	return {
		columns: finalColumns,
		event: {
			item: movedItem,
			sourceColumnId,
			targetColumnId,
			newIndex,
		},
	};
}

/**
 * Reorder items within a single column. Returns a new column array.
 */
export function reorderItemsInColumn<TItem extends KanbanItem>(
	columns: KanbanColumnDef<TItem>[],
	columnId: string,
	activeIndex: number,
	overIndex: number,
): KanbanColumnDef<TItem>[] {
	return columns.map((col) => {
		if (col.id !== columnId) return col;
		const newItems = [...col.items];
		const [moved] = newItems.splice(activeIndex, 1);
		newItems.splice(overIndex, 0, moved);
		return { ...col, items: newItems };
	});
}

/**
 * Reorder columns. Returns a new array with the column moved.
 */
export function reorderColumns<TItem extends KanbanItem>(
	columns: KanbanColumnDef<TItem>[],
	activeIndex: number,
	overIndex: number,
): KanbanColumnDef<TItem>[] {
	const newColumns = [...columns];
	const [moved] = newColumns.splice(activeIndex, 1);
	newColumns.splice(overIndex, 0, moved);
	return newColumns;
}

/**
 * Format an item count string. Uses the label template or falls back to
 * a bare number.
 */
export function formatItemCount(count: number, template?: string): string {
	if (template) return template.replace('{count}', String(count));
	return String(count);
}
