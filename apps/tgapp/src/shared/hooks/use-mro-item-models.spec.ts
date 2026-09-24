import { describe, expect, it } from 'vitest';

import {
	filterMroItemModels,
	mroItemLineLabel,
	mroItemModelLabel,
	mroItemModelMatches,
	MRO_ITEM_PICKER_LIMIT,
	type MroItemModelDirectoryRow,
} from './use-mro-item-models';

/**
 * The picker's ONE client-side matcher (shared by every doc form's item sheet,
 * the requisition combobox and the stock kiosk). These pin that a SKU is findable
 * by its English name, its Burmese name, its PARENT item name (so “Tyre” /
 * “တာယာ” lands on every size) and the tracking policy word — and that the
 * rendered set is capped so an unfiltered catalogue can't paint every row.
 */
const TYRE: MroItemModelDirectoryRow = {
	id: 'm1',
	name_en: '11R 22.5',
	name_mm: 'တာယာ 11R 22.5',
	tracking: 'serial',
	group_name_en: 'Tyre',
	group_name_mm: 'တာယာ',
};

const BOLT: MroItemModelDirectoryRow = {
	id: 'm2',
	name_en: 'M16 × 60',
	name_mm: 'ဘော့လ် M16 × 60',
	tracking: 'standard',
	group_name_en: 'Bolt',
	group_name_mm: 'ဘော့လ်',
};

describe('mroItemModelMatches', () => {
	it('matches an empty query (everything passes)', () => {
		expect(mroItemModelMatches(TYRE, '')).toBe(true);
		expect(mroItemModelMatches(TYRE, '   ')).toBe(true);
	});

	it('matches the English SKU name', () => {
		expect(mroItemModelMatches(TYRE, '11r')).toBe(true);
	});

	it('matches the Burmese SKU name', () => {
		expect(mroItemModelMatches(TYRE, 'တာယာ')).toBe(true);
	});

	it('matches the parent ITEM name in either language', () => {
		expect(mroItemModelMatches(TYRE, 'tyre')).toBe(true);
		expect(mroItemModelMatches(BOLT, 'bolt')).toBe(true);
	});

	it('matches the tracking policy word', () => {
		expect(mroItemModelMatches(TYRE, 'serial')).toBe(true);
	});

	it('rejects a term that appears nowhere', () => {
		expect(mroItemModelMatches(TYRE, 'battery')).toBe(false);
	});
});

describe('mroItemModelLabel', () => {
	it('prefixes the parent item name over the SKU', () => {
		expect(mroItemModelLabel(TYRE)).toBe('Tyre · 11R 22.5');
		expect(mroItemModelLabel(BOLT)).toBe('Bolt · M16 × 60');
	});

	it('keeps just the SKU when there is no parent name', () => {
		expect(mroItemModelLabel({ name_en: 'AF-4004' })).toBe('AF-4004');
	});

	it('does not repeat a group the SKU name already says', () => {
		expect(mroItemModelLabel({ name_en: 'Tyre 11R 22.5', group_name_en: 'Tyre' })).toBe('Tyre 11R 22.5');
	});

	it('falls back to the Burmese name, then to an em dash — never empty', () => {
		expect(mroItemModelLabel({ name_mm: 'တာယာ 11R 22.5', group_name_en: 'Tyre' })).toBe('Tyre · တာယာ 11R 22.5');
		expect(mroItemModelLabel({})).toBe('—');
	});
});

/**
 * A LINE's label — the same `item name · SKU`, with the fallback chain every line card
 * needs. The ORDER matters: only the directory row knows the parent item name, so it
 * wins; a seeded line whose SKU is missing from the cached directory (or a screen
 * painting before that master read lands) still names itself, and an empty line says
 * the placeholder rather than an em dash.
 */
describe('mroItemLineLabel', () => {
	it('prefers the directory row — the item NAME over the SKU', () => {
		expect(mroItemLineLabel({ model: TYRE, storedName: '11R 22.5', modelId: 'm1' })).toBe('Tyre · 11R 22.5');
		expect(mroItemLineLabel({ model: BOLT, modelId: 'm2' })).toBe('Bolt · M16 × 60');
	});

	it('falls back to the STORED SKU name, then its id — a line is never blank', () => {
		expect(mroItemLineLabel({ storedName: 'Global Tyre 11R', modelId: 'm9' })).toBe('Global Tyre 11R');
		expect(mroItemLineLabel({ modelId: 'm9' })).toBe('m9');
	});

	it('says the placeholder on an empty line — `Select item` unless the caller names one', () => {
		expect(mroItemLineLabel({})).toBe('Select item');
		expect(mroItemLineLabel({ placeholder: 'Select SKU' })).toBe('Select SKU');
		expect(mroItemLineLabel({ storedName: '   ', modelId: null })).toBe('Select item');
	});
});

describe('filterMroItemModels', () => {
	it('filters by the shared matcher', () => {
		expect(filterMroItemModels([TYRE, BOLT], 'tyre')).toEqual([TYRE]);
		expect(filterMroItemModels([TYRE, BOLT], '')).toEqual([TYRE, BOLT]);
	});

	it('caps the rendered rows so an unfiltered catalogue stays light', () => {
		const many = Array.from({ length: MRO_ITEM_PICKER_LIMIT + 25 }, (_, index) => ({
			id: `m${index}`,
			name_en: `Item ${index}`,
		}));
		expect(filterMroItemModels(many, '')).toHaveLength(MRO_ITEM_PICKER_LIMIT);
	});
});
