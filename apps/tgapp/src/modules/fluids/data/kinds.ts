import { FLUID_KIND_LABELS } from '@/modules/fleets/data/status';
import type { FluidKind } from '@/modules/fleets/data/types';
import { enumParam } from '@/shared/url-state';

/**
 * The Fluid module's kind vocabulary — the ONE declaration of the two serviced
 * kinds and their URL view-state parser, shared by the vehicle page's tabs and
 * the record/create page so a kind can never read two ways.
 */

/** The kind tab options — order is render order (Engine oil then Gear oil). */
export const KIND_TABS: ReadonlyArray<{ value: FluidKind; label: string }> = [
	{ value: 'engine_oil', label: FLUID_KIND_LABELS.engine_oil },
	{ value: 'gear_oil', label: FLUID_KIND_LABELS.gear_oil },
];

/** The URL-driven kind (`?type=`) — an unknown value falls back to Engine oil. */
export const KIND_FILTER = enumParam<FluidKind>(
	KIND_TABS.map((tab) => tab.value),
	'engine_oil',
);
