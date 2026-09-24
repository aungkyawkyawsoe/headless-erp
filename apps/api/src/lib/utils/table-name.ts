/**
 * Table Naming Utilities — API-specific convenience wrapper
 *
 * Wraps @mmbix/utils to inject the table prefix from app config.
 * Use this in apps/api/ where you need collectionTable/systemTable.
 */
export { sanitizeIdentifier, SanitizeError } from '@mmbix/utils';
export { systemTable as _systemTable, collectionTable as _collectionTable } from '@mmbix/utils';

import { getConfig } from '@mmbix/config';
import { systemTable as coreSystemTable, collectionTable as coreCollectionTable } from '@mmbix/utils';

export function systemTable(name: string): string {
	return coreSystemTable(name, getConfig().tablePrefix || 'cms_');
}

export function collectionTable(slug: string): string {
	return coreCollectionTable(slug, getConfig().tablePrefix || 'cms_');
}
