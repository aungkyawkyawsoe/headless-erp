/**
 * The item thumbnail — the ONE way an item's left glyph is drawn, so the catalog
 * card and the stock lines page never disagree about what a row's avatar is.
 *
 * A real catalogs screen shows the ITEM: the SKU's photo when it has one, and a
 * monogram tile (its initials) when it does not. A generic package glyph is
 * deliberately NOT the fallback — it is identical on every row, so it carries no
 * information (Data-Ink) and reads as decoration rather than identity.
 */

/** The monogram: up to two initials from the label, uppercase; '#' when the
 *  label has no letters/digits to draw from. Deterministic (same name ⇒ same
 *  glyph), so a list never flickers between renders. */
export function initialsOf(name: string | null | undefined): string {
	const words = String(name ?? '')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
	const initials = words
		.slice(0, 2)
		.map((word) => [...word][0])
		.join('');
	return initials ? initials.toUpperCase() : '#';
}

interface ItemThumbProps {
	/** The item's display name — the monogram's source. */
	name: string;
	/** The SKU's photo URL (`/api/media/<key>`) or null. */
	image?: string | null;
	/** Sizing/shape classes for the tile (both states share them). */
	className: string;
}

export function ItemThumb({ name, image, className }: ItemThumbProps) {
	if (image) {
		return <img src={image} alt="" className={`${className} border border-border/60 bg-muted/40 object-cover`} />;
	}
	return (
		<span aria-hidden className={`${className} items-center justify-center bg-muted/60 font-bold tracking-wide text-muted-foreground`}>
			{initialsOf(name)}
		</span>
	);
}
