// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandBadge, PlateChip } from './plate-chip';

/**
 * The vehicle identity cluster carries the DISPLAY face (`font-display` →
 * Exo 2), so a plate reads as the one industrial identifier a scan lands on. It
 * is `unicode-range`-guarded with no Myanmar subset, which is why the chip may
 * carry it unconditionally: a Burmese glyph can never even request the face.
 */

afterEach(cleanup);

describe('plate chip — the vehicle identity face', () => {
	it('paints the plate in the display face', () => {
		render(<PlateChip>6S-2439</PlateChip>);
		expect(screen.getByText('6S-2439').className).toContain('font-display');
	});

	it('keeps a caller class merged onto the chip', () => {
		render(<PlateChip className="w-fit shrink-0">6S-2439</PlateChip>);
		const chip = screen.getByText('6S-2439');
		expect(chip.className).toContain('font-display');
		expect(chip.className).toContain('w-fit');
	});

	it('paints the brand badge beside a plate in the same face', () => {
		render(<BrandBadge>ISUZU</BrandBadge>);
		expect(screen.getByText('ISUZU').className).toContain('font-display');
	});
});
