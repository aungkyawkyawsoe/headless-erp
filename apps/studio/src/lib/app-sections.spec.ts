/**
 * The app workbench's mode routing — pure helpers.
 *
 * These pin the contract the mode routes rely on: an unknown segment falls back
 * to `models` (never a blank pane), a bare `/apps/:slug` canonicalises to exactly
 * one path, the legacy `?section=` bookmarks still resolve, and a foreign mode's
 * params never leak into the active mode.
 */
import { describe, expect, it } from 'vitest';
import {
	APP_SECTIONS,
	DEFAULT_APP_SECTION,
	appSectionPath,
	isAppSection,
	legacySectionTarget,
	normalizeSectionParams,
	resolveAppSection,
} from './app-sections';

describe('resolveAppSection', () => {
	it('resolves each known mode', () => {
		for (const s of APP_SECTIONS) expect(resolveAppSection(s)).toBe(s);
	});

	it('falls back to the default for a bare path, an unknown mode, or a nested splat', () => {
		expect(resolveAppSection(undefined)).toBe(DEFAULT_APP_SECTION);
		expect(resolveAppSection('')).toBe(DEFAULT_APP_SECTION);
		expect(resolveAppSection('nope')).toBe(DEFAULT_APP_SECTION);
		// The splat may carry a nested path — only the first segment is the mode.
		expect(resolveAppSection('menus/extra')).toBe('menus');
		expect(resolveAppSection('bogus/extra')).toBe(DEFAULT_APP_SECTION);
	});
});

describe('isAppSection', () => {
	it('accepts every mode and rejects anything else', () => {
		for (const s of APP_SECTIONS) expect(isAppSection(s)).toBe(true);
		expect(isAppSection('collection')).toBe(false);
		expect(isAppSection('')).toBe(false);
		expect(isAppSection('MODELS')).toBe(false);
	});
});

describe('appSectionPath', () => {
	it('writes the one canonical route shape', () => {
		expect(appSectionPath('orders', 'models')).toBe('/apps/orders/models');
		expect(appSectionPath('orders', 'pages')).toBe('/apps/orders/pages');
	});
});

describe('legacySectionTarget', () => {
	it('maps pre-mode-route bookmarks onto modes', () => {
		expect(legacySectionTarget('collection')).toBe('models');
		expect(legacySectionTarget('menu')).toBe('menus');
		expect(legacySectionTarget('builder')).toBe('pages');
	});

	it('returns null only when the param is absent', () => {
		expect(legacySectionTarget(null)).toBeNull();
		expect(legacySectionTarget(undefined)).toBeNull();
		expect(legacySectionTarget('')).toBeNull();
	});

	it('still lands an unrecognised legacy value on a real mode', () => {
		expect(legacySectionTarget('whatever')).toBe(DEFAULT_APP_SECTION);
	});
});

describe('normalizeSectionParams', () => {
	const params = (qs: string) => new URLSearchParams(qs);

	it('leaves the pages mode untouched', () => {
		const { params: next, changed } = normalizeSectionParams('pages', params('page=p1&template=blank&view=form'));
		expect(changed).toBe(false);
		expect(next.toString()).toBe('page=p1&template=blank&view=form');
	});

	it('drops the pages-only params in every other mode', () => {
		const { params: menus, changed: menusChanged } = normalizeSectionParams('menus', params('page=p1&template=blank'));
		expect(menusChanged).toBe(true);
		expect(menus.has('page')).toBe(false);
		expect(menus.has('template')).toBe(false);

		const { params: models, changed: modelsChanged } = normalizeSectionParams('models', params('collection=orders&page=p1'));
		expect(modelsChanged).toBe(true);
		expect(models.get('collection')).toBe('orders');
		expect(models.has('page')).toBe(false);
	});

	it('clamps a stale builder view in the models mode, but keeps table/schema', () => {
		const stale = normalizeSectionParams('models', params('view=form'));
		expect(stale.changed).toBe(true);
		expect(stale.params.get('view')).toBe('schema');

		expect(normalizeSectionParams('models', params('view=table')).changed).toBe(false);
		expect(normalizeSectionParams('models', params('view=schema')).changed).toBe(false);
	});

	it('does not invent a view param when none is present', () => {
		const { params: next, changed } = normalizeSectionParams('models', params('collection=orders'));
		expect(changed).toBe(false);
		expect(next.has('view')).toBe(false);
	});

	it('never mutates the input params', () => {
		const input = params('page=p1&view=form');
		normalizeSectionParams('models', input);
		expect(input.toString()).toBe('page=p1&view=form');
	});
});
