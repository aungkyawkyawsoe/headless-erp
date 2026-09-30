import { describe, expect, it } from 'vitest';
import { blockTypeSummary, confidenceTone, nextGenerationActions, summarizeProposal } from './generation';
import type { SchemaProposal } from '@mmbix/types';

describe('nextGenerationActions', () => {
	it('a draft under review must be submitted before it can be applied', () => {
		expect(nextGenerationActions('draft', true)).toEqual(['submit', 'reject']);
	});
	it('a review-optional draft may be applied directly', () => {
		expect(nextGenerationActions('draft', false)).toContain('apply');
	});
	it('review can be approved or rejected; promoted can only be applied', () => {
		expect(nextGenerationActions('review', true)).toEqual(['approve', 'reject']);
		expect(nextGenerationActions('promoted', true)).toEqual(['apply']);
	});
	it('live and rejected are terminal', () => {
		expect(nextGenerationActions('live', true)).toEqual([]);
		expect(nextGenerationActions('rejected', true)).toEqual([]);
	});
});

describe('confidenceTone', () => {
	it('maps confidence to a legible tone', () => {
		expect(confidenceTone(0)).toBe('low');
		expect(confidenceTone(1)).toBe('medium');
		expect(confidenceTone(2)).toBe('high');
	});
});

describe('summarizeProposal', () => {
	it('counts fields by inference source and surfaces warnings', () => {
		const proposal: SchemaProposal = {
			collection: {
				slug: 'x',
				name: 'X',
				fields: [
					{ name: 'a', type: 'currency', required: false, inference: { confidence: 2, reason: 'declared', source: 'declared' } },
					{ name: 'b', type: 'date', required: false, inference: { confidence: 1, reason: 'rule', source: 'rule' } },
					{ name: 'c', type: 'text', required: false, inference: { confidence: 0, reason: 'fallback', source: 'rule' } },
				],
			},
			relations: [{ from: 'x', to: 'y', cardinality: 'many', confidence: 2, reason: 'declared relation' }],
			warnings: [{ code: 'w', message: 'm' }],
		};
		expect(summarizeProposal(proposal)).toEqual({
			fields: 3,
			declared: 1,
			rules: 1,
			heuristic: 1,
			relations: 1,
			warnings: 1,
			pages: 0,
			blocks: 0,
		});
	});

	it('counts the proposed UI (pages + blocks) when the design implied a screen', () => {
		const proposal: SchemaProposal = {
			collection: {
				slug: 'po',
				name: 'PO',
				fields: [{ name: 'code', type: 'text', required: true, inference: { confidence: 1, reason: 'rule', source: 'rule' } }],
			},
			relations: [],
			warnings: [],
			pages: [
				{ path: '/po', title: 'PO', blocks: [{ type: 'entity-form' }, { type: 'table' }] },
				{ path: '/po-lines', title: 'Lines', blocks: [{ type: 'table' }] },
			],
		};
		const summary = summarizeProposal(proposal);
		expect(summary.pages).toBe(2);
		expect(summary.blocks).toBe(3);
	});
});

describe('blockTypeSummary', () => {
	it('lists unique block types, bounded', () => {
		const proposal = {
			collection: { slug: 'x', name: 'X', fields: [] },
			relations: [],
			warnings: [],
			pages: [
				{ path: '/a', title: 'A', blocks: [{ type: 'table' }, { type: 'table' }, { type: 'kpi' }] },
				{ path: '/b', title: 'B', blocks: [{ type: 'chart' }, { type: 'list' }, { type: 'calendar' }] },
			],
		} as unknown as SchemaProposal;
		expect(blockTypeSummary(proposal)).toBe('table, kpi, chart, list +1');
		// No pages → empty, so the panel can omit the line entirely.
		expect(blockTypeSummary({ collection: { slug: 'x', name: 'X', fields: [] }, relations: [], warnings: [] })).toBe('');
	});
});
