/**
 * Collections hidden from the general schema registry: engine system
 * collections (`_` prefix). Everything else is a normal business collection.
 */
export function isHiddenCollection(slug: string): boolean {
	return slug.startsWith('_');
}
