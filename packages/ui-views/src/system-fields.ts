/**
 * System fields — engine-managed metadata, never rendered as data columns or
 * form inputs. ONE shared source of truth for the runtime admin (PageView /
 * EntityPage / EntityForm) and every ui-views view config; the Studio DERIVES
 * its own set from this one (apps/studio/src/lib/api.ts) by subtracting `_meta`
 * — it treats `_meta` as a viewable field — instead of keeping a second copy.
 * Re-exported from the ui-views index for app-side consumers.
 */
export const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set([
	'id',
	'doc_status',
	'display_number',
	'_meta',
	'_owner',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'deleted_at',
	'deleted_by',
]);
