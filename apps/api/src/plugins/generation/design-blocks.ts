/**
 * Design → UI compiler — `DesignDNA → page blocks`.
 *
 * The schema path (`inferFields`) already turns a design into a collection, but
 * nothing turned design INTENT into a screen, so a proposal produced data with
 * no UI. This maps each design component onto a REAL `BLOCK_REGISTRY` block
 * (a `table`, an `entity-form`, a `kpi`, …) bound to the collection the proposal
 * creates, taking each block's config baseline from `blockDefaults` (the same
 * SSOT the renderer uses). Pure and deterministic; an unknown component kind is
 * skipped WITH a warning rather than invented into a block that renders as
 * nothing.
 */
import { snakeName } from '@mmbix/core';
import { blockDefaults } from '@mmbix/ui-views/block-registry';
import type { DesignDNA, ProposedPage, ProposalWarning } from '@mmbix/types';

/** Design component kind → a real block type. Anything absent is skipped. */
const KIND_TO_BLOCK: Record<string, string> = {
	table: 'table',
	datatable: 'datatable',
	'data-table': 'table',
	grid: 'table',
	list: 'list',
	form: 'entity-form',
	'entity-form': 'entity-form',
	'create-form': 'entity-form',
	'edit-form': 'entity-form',
	'stat-card': 'kpi',
	stat: 'kpi',
	kpi: 'kpi',
	metric: 'kpi',
	'card-grid': 'entity-card-grid',
	cards: 'entity-card-grid',
	kanban: 'kanban',
	board: 'kanban',
	calendar: 'calendar',
	header: 'section-header',
	'page-header': 'section-header',
	title: 'section-header',
	chart: 'chart',
	graph: 'chart',
	report: 'report',
	pivot: 'pivot',
};

export interface DesignBlocksOptions {
	/** The collection slug every data block is bound to. */
	collection: string;
	/** Hard cap on pages (a design with many screens must not create unbounded pages). */
	maxPages?: number;
}

export interface DesignBlocksResult {
	pages: ProposedPage[];
	warnings: ProposalWarning[];
}

/** `"Purchase Order screen"` → `purchase-order-screen` (a URL-safe page path segment). */
function pathSegment(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

/** A page title from the anatomy's first line, else the screen id. */
function titleOf(anatomy: string, fallback: string): string {
	const first = anatomy
		.split('\n')
		.map((l) => l.trim())
		.find(Boolean);
	return (first ?? fallback).slice(0, 120);
}

/** Compile a design into pages of real blocks bound to `opts.collection`. */
export function designToBlocks(dna: DesignDNA, opts: DesignBlocksOptions): DesignBlocksResult {
	const warnings: ProposalWarning[] = [];
	const pages: ProposedPage[] = [];
	const maxPages = Math.max(1, opts.maxPages ?? 10);
	const usedPaths = new Set<string>();

	for (const [screenIndex, screen] of dna.screens.slice(0, maxPages).entries()) {
		const blocks: Array<Record<string, unknown>> = [];
		for (const [componentIndex, component] of (screen.components ?? []).entries()) {
			const kind = String(component.kind ?? '')
				.trim()
				.toLowerCase();
			const type = KIND_TO_BLOCK[kind];
			if (!type) {
				warnings.push({
					code: 'unknown_component',
					message: `Screen "${screen.id}": no block for design component "${component.kind}" — skipped`,
				});
				continue;
			}
			// Start from the block's OWN defaults (the renderer's SSOT) and bind the
			// collection; a label from the design becomes the block's title.
			const base = blockDefaults(type);
			const config: Record<string, unknown> = { ...base, collection: opts.collection };
			if (component.label) {
				if ('title' in base) config.title = component.label;
				else if ('label' in base) config.label = component.label;
				else if ('text' in base) config.text = component.label;
			}
			blocks.push({
				id: `b${screenIndex}c${componentIndex}`,
				type,
				...(component.label ? { label: component.label.slice(0, 120) } : {}),
				layout: { order: blocks.length },
				config,
			});
		}
		if (blocks.length === 0) {
			warnings.push({ code: 'empty_screen', message: `Screen "${screen.id}" has no mappable components — no page created` });
			continue;
		}
		const segment = pathSegment(screen.id) || pathSegment(opts.collection) || 'page';
		// Two screens must not collide on one path (the second gets a suffix).
		let path = `/${segment}`;
		for (let i = 2; usedPaths.has(path); i++) path = `/${segment}-${i}`;
		usedPaths.add(path);
		pages.push({ path, title: titleOf(screen.anatomy, snakeName(screen.id) || screen.id), blocks });
	}

	if (dna.screens.length > maxPages) {
		warnings.push({ code: 'screens_truncated', message: `Considered the first ${maxPages} of ${dna.screens.length} screens` });
	}
	return { pages, warnings };
}
