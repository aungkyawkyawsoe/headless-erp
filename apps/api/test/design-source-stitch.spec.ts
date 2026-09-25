/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stitch-screens.json';
import { stitchScreenRef, stitchToDesignDNA, type StitchFixture } from '@/plugins/generation/stitch-adapter';
import { normalizeDesignDNA } from '@/plugins/generation/design-dna';
import { buildProposal } from '@/plugins/generation/proposal';

/**
 * Stitch adapter — RECORDED FIXTURES ONLY (no network in CI).
 *
 * Proves the port: a recorded design source payload becomes a vendor-agnostic
 * DesignDNA, survives normalization, and yields a deterministic proposal. The
 * adapter is agent-side; the Worker never speaks to Stitch.
 */

describe('stitch screen ref (real payload shape)', () => {
	it('reads the structural fields off a real get_screen result', () => {
		// Shape verified against the hosted Stitch server: `htmlCode` is a FILE
		// REFERENCE, not markup, and there is no `anatomy` on the wire.
		const screen = {
			name: 'projects/12013215614564949498/screens/8c6cb94d6d6340219c75d8740bd9d6ff',
			title: 'Tasks & Operations Hub',
			deviceType: 'MOBILE',
			width: 390,
			height: 844,
			htmlCode: { name: '.../fileEntries/html', downloadUrl: 'https://x/html', mimeType: 'text/html' },
			screenshot: { name: '.../fileEntries/screenshot', downloadUrl: 'https://x/png' },
		};
		expect(stitchScreenRef(screen)).toEqual({
			id: '8c6cb94d6d6340219c75d8740bd9d6ff',
			title: 'Tasks & Operations Hub',
			deviceType: 'MOBILE',
			htmlUrl: 'https://x/html',
			screenshotUrl: 'https://x/png',
		});
		// A payload with no usable name yields null rather than a guessed id.
		expect(stitchScreenRef({ title: 'x' })).toBeNull();
		expect(stitchScreenRef(null)).toBeNull();
	});
});

describe('stitch design-source adapter (fixtures)', () => {
	const dna = stitchToDesignDNA(fixture as StitchFixture);

	it('maps the fixture to a provider-tagged DesignDNA', () => {
		expect(dna.source.provider).toBe('stitch');
		expect(dna.source.projectId).toBe('demo-erp');
		expect(dna.screens[0].id).toBe('purchase-order');
	});

	it('survives normalization as untrusted input', () => {
		const parsed = normalizeDesignDNA(dna);
		expect(parsed.dna).not.toBeNull();
		expect(parsed.warnings).toEqual([]);
		expect(parsed.dna!.screens[0].components).toHaveLength(2);
	});

	it('produces a deterministic proposal with inferred types + relations', () => {
		const parsed = normalizeDesignDNA(dna).dna!;
		const input = { collection: { name: 'Purchase Order', slug: 'purchase_order' }, dna: parsed };
		const a = buildProposal(input, { maxFields: 40 });
		const b = buildProposal(input, { maxFields: 40 });
		expect(a).toEqual(b);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));

		const types = a.collection.fields.map((f) => f.type);
		expect(types).toContain('currency');
		// The design declared Number for Quantity, and a declared format outranks
		// the label rule (which would otherwise infer integer).
		expect(types).toContain('number');
		expect(types).toContain('date');
		expect(types).toContain('boolean');
		expect(a.relations[0]).toMatchObject({ from: 'purchase_order', to: 'purchase_order_line', cardinality: 'many' });
	});

	it('turns the Stitch screen into a page of real blocks (design → UI)', () => {
		// The point of the bridge: the design does not stop at schema. Each screen
		// becomes a page of blocks from the REAL registry, bound to the collection.
		const parsed = normalizeDesignDNA(dna).dna!;
		const proposal = buildProposal({ collection: { name: 'Purchase Order', slug: 'purchase_order' }, dna: parsed }, { maxFields: 40 });
		expect(proposal.pages).toHaveLength(1);
		const page = proposal.pages![0];
		expect(page.path).toBe('/purchase-order');
		// fixture: a `form` then a `table` component
		expect(page.blocks.map((b) => b.type)).toEqual(['entity-form', 'table']);
		expect((page.blocks[0].config as { collection: string }).collection).toBe('purchase_order');
		expect((page.blocks[1].config as { collection: string }).collection).toBe('purchase_order');
	});
});
