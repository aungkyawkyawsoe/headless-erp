import { CarFront, Cog, Droplet, Filter, FolderOpen, LifeBuoy, Paintbrush, Wrench, Zap, type LucideIcon } from 'lucide-react';

/**
 * One glyph per MRO category, keyed by the category's ENGLISH name (the stable
 * identity — the Burmese label is display-only), with an unknown/legacy label
 * falling back to a folder so a taxonomy edit can never break a card.
 *
 * The canonical eight lead; the LEGACY names (the pre-consolidation taxonomy an
 * older local/legacy dataset may still carry) are aliased onto the same glyphs so
 * those categories don't all collapse to the folder default.
 *
 * Shared by the category strip on the masters hub and each item-group card, so a
 * category reads with the SAME glyph everywhere it appears.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
	// Canonical taxonomy.
	'Engine & Gear Box': Cog,
	'Body and Paint': Paintbrush,
	'Electric & Lighting': Zap,
	'Oil & Grease': Droplet,
	'Suspension & Steering': CarFront,
	'Filter & Cleaning': Filter,
	'Tyre & Alloy': LifeBuoy,
	Tools: Wrench,
	// Legacy aliases.
	'Lubricants & Fluids': Droplet,
	'Grease & Fluids': Droplet,
	Filters: Filter,
	Wiring: Zap,
	'Peripherals & Electrical': Zap,
	'Fasteners & Fittings': Wrench,
	'Hand Tools & Workshop Equipment': Wrench,
	'Tools & Equipment': Wrench,
	'Tools & Assets': Wrench,
	'Brake & Suspension': CarFront,
	'Engine & Powertrain': Cog,
	'Gearbox & Accessories': Cog,
	'Tyres & Wheels': LifeBuoy,
	'Body & Lighting': Paintbrush,
	'Body & Cabin Parts': Paintbrush,
};

/** The glyph for a category's English name — `FolderOpen` when unmapped. */
export function categoryIcon(nameEn: string | null | undefined): LucideIcon {
	return (nameEn && CATEGORY_ICONS[nameEn]) || FolderOpen;
}
