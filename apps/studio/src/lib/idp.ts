/**
 * Collections hidden from the general schema registry: engine system
 * collections (`_` prefix) and IDP-internal collections (`idp_` prefix).
 * IDP keeps its own lifecycle tables (deployments/environments/ownership) out
 * of the module-free Collections surface — those are managed via the IDP pages.
 */
export function isHiddenCollection(slug: string): boolean {
	return slug.startsWith('_') || slug.startsWith('idp_');
}
