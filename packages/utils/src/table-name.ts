/**
 * Table Naming Utilities
 *
 * Consistent table name generation based on a configurable TABLE_PREFIX.
 *
 * Design:
 *   - System tables: `{prefix}_` → e.g., `cms__entity_schemas` (double underscore)
 *   - User collections: `{prefix}{slug}` → e.g., `cms_articles` (single underscore)
 *
 * The `is_system` field on `_entity_schemas` distinguishes system vs user tables.
 */

/**
 * Normalize a table prefix by ensuring it ends with exactly one trailing underscore.
 * Strips extra underscores at the end, then appends one.
 *
 * Example:
 *   normalizePrefix('cms')    → 'cms_'
 *   normalizePrefix('cms_')   → 'cms_'
 *   normalizePrefix('cms__')  → 'cms_'
 */
export function normalizePrefix(prefix: string): string {
	return prefix.replace(/_+$/, '') + '_';
}

/**
 * Build the table name for a system table.
 * System tables use a double-underscore separator after the prefix.
 *
 * Example: systemTable('entity_schemas', 'cms_') → 'cms__entity_schemas'
 */
export function systemTable(name: string, prefix: string): string {
	return `${normalizePrefix(prefix)}_${name}`;
}

/**
 * Build the table name for a user collection by slug.
 * User collections use a single underscore after the prefix.
 *
 * Example: collectionTable('articles', 'cms_') → 'cms_articles'
 */
export function collectionTable(slug: string, prefix: string): string {
	return `${normalizePrefix(prefix)}${slug}`;
}
