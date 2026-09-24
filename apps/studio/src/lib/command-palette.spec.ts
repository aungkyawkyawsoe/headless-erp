import { describe, expect, it } from 'vitest';

import { filterCommands, type PaletteCommand } from './command-palette';

const cmd = (id: string, label: string, group = 'Go', keywords?: string): PaletteCommand => ({
	id,
	label,
	group,
	keywords,
	run: () => {},
});

const COMMANDS = [cmd('home', 'Apps gallery'), cmd('studio', 'Studio Admin'), cmd('orders', 'Orders', 'Apps', 'orders module')];

describe('filterCommands', () => {
	it('returns everything for an empty query', () => {
		expect(filterCommands(COMMANDS, '')).toHaveLength(3);
		expect(filterCommands(COMMANDS, '   ')).toHaveLength(3);
	});

	it('matches label case-insensitively', () => {
		expect(filterCommands(COMMANDS, 'studio').map((c) => c.id)).toEqual(['studio']);
		expect(filterCommands(COMMANDS, 'APPS')).toHaveLength(2); // 'Apps gallery' + group 'Apps'
	});

	it('matches keywords and group', () => {
		expect(filterCommands(COMMANDS, 'module').map((c) => c.id)).toEqual(['orders']);
		expect(filterCommands(COMMANDS, 'go').map((c) => c.id)).toEqual(['home', 'studio']);
	});

	it('returns nothing when nothing matches', () => {
		expect(filterCommands(COMMANDS, 'zzzz')).toEqual([]);
	});
});
