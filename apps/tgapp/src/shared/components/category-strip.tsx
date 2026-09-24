import { LayoutGrid } from 'lucide-react';

import { categoryIcon } from './category-icon';
import { IconTabStrip, type IconTab } from './icon-tab-strip';

/** One selectable category tab — the `mro_item_categories` masters, plus the
 *  leading "All" sentinel (`id: ''`). */
export interface CategoryTab {
	/** Category id, or `''` for the "All" tab. */
	id: string;
	/** The category's English name (the icon key + fallback label). */
	nameEn: string | null;
	/** The category's Burmese name — the primary (large) label. */
	nameMm: string | null;
}

interface CategoryStripProps {
	tabs: readonly CategoryTab[];
	/** The active tab id (`''` = All). */
	value: string;
	onChange: (id: string) => void;
}

/**
 * The masters hub's category selector — the shared `IconTabStrip` fed one tile
 * per `mro_item_categories` master, with the leading "All".
 *
 * Each tile shows the category's MYANMAR name (the operator's language) under a
 * large category glyph. It replaces the old top segmented tab row: picking a tile
 * narrows the item-name list below to that category, while the Item-Groups /
 * Suppliers SCOPE switch lives in the bottom bar's filter sheet.
 */
export function CategoryStrip({ tabs, value, onChange }: CategoryStripProps) {
	const options: IconTab<string>[] = tabs.map((tab) => {
		const isAll = tab.id === '';
		return {
			value: tab.id,
			icon: isAll ? LayoutGrid : categoryIcon(tab.nameEn),
			label: isAll ? 'အားလုံး' : tab.nameMm?.trim() || tab.nameEn?.trim() || 'Uncategorized',
		};
	});

	return <IconTabStrip tabs={options} value={value} onChange={onChange} ariaLabel="Category" />;
}
