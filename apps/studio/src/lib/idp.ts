// Business modules (HR / Vehicle / Store) are managed under the IDP catalog —
// they don't belong on the app-level launcher grid, and their back navigation
// returns to the IDP catalog rather than the Apps page.
const IDP_MANAGED_MODULES = new Set(['hr', 'vehicle', 'store']);

export function isIdpManagedModule(slug: string): boolean {
	return IDP_MANAGED_MODULES.has(slug);
}

/**
 * Collections hidden from the general schema registry: engine system
 * collections (`_` prefix) and IDP-internal collections (`idp_` prefix).
 * IDP keeps its own lifecycle tables (deployments/environments/ownership) out
 * of the module-free Collections surface — those are managed via the IDP pages.
 */
export function isHiddenCollection(slug: string): boolean {
	return slug.startsWith('_') || slug.startsWith('idp_');
}
