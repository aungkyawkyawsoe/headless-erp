import { describe, expect, it } from 'vitest';

import { flattenTranslations, interpolate, translate } from './i18n';

describe('flattenTranslations', () => {
	it('flattens module → namespace → key to dotted keys', () => {
		const flat = flattenTranslations({ studio: { shell: { theme: 'Thème' } } });
		expect(flat).toEqual({ 'studio.shell.theme': 'Thème' });
	});

	it('skips nested objects and tolerates empty bundles', () => {
		expect(flattenTranslations({ a: { b: { c: { nested: 'x' } } } })).toEqual({});
		expect(flattenTranslations(null)).toEqual({});
	});
});

describe('interpolate', () => {
	it('replaces {placeholders}', () => {
		expect(interpolate('Hi {name}, {n} items', { name: 'Aung', n: 3 })).toBe('Hi Aung, 3 items');
	});
	it('leaves unknown placeholders intact', () => {
		expect(interpolate('Hi {name}', {})).toBe('Hi {name}');
	});
});

describe('translate', () => {
	const dict = { 'studio.shell.theme': 'Thème' };
	it('returns the translation when present', () => {
		expect(translate(dict, 'studio.shell.theme', 'Theme')).toBe('Thème');
	});
	it('falls back to the literal when missing (never a raw key)', () => {
		expect(translate(dict, 'studio.shell.missing', 'Theme')).toBe('Theme');
	});
	it('interpolates vars', () => {
		expect(translate({ 'x.y.z': 'Hi {name}' }, 'x.y.z', undefined, { name: 'Bo' })).toBe('Hi Bo');
	});
});
