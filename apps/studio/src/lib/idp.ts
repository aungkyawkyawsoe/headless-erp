// Business modules surfaced under the IDP catalog rather than the app-level
// launcher grid, whose back navigation returns to the IDP catalog. A headless
// factory ships none — a project adds its own module slugs here.
const IDP_MANAGED_MODULES = new Set<string>();

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
