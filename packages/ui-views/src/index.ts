/**
 * Shared view/block logic — the single source of truth for how records are
 * labelled/formatted and how page blocks render. Used by the Studio builder
 * (apps/studio) and the runtime page renderer (apps/tgapp) so both produce
 * identical output (preview == runtime, no raw UUID dumps).
 */

import { relationLabel } from './field-format';

/** System fields — engine-managed metadata, never rendered as data columns or
 *  form inputs. Shared by the runtime admin + all ui-views view configs. */
export { SYSTEM_FIELD_NAMES } from './system-fields';

/**
 * Pick a human-readable display field from a collection's schema fields.
 * Priority: engine display_number → common friendly names → first visible
 * user field. Returns null when the collection has no user fields yet.
 */
export function pickDisplayField(fields: Array<{ name: string }>, systemFields: ReadonlySet<string>): string | null {
	const user = fields.filter((f) => !systemFields.has(f.name));
	if (user.length === 0) return null;
	if (fields.some((f) => f.name === 'display_number')) return 'display_number';
	for (const cand of ['name', 'title', 'label', 'code']) {
		if (user.some((f) => f.name === cand)) return cand;
	}
	return user[0].name;
}

/**
 * Label a record using the resolved display field. M2O values arrive as nested
 * objects — extract their display name. Returns null when no display field.
 */
export function displayLabelFor(row: Record<string, unknown>, displayField: string | null): string | null {
	if (!displayField) return null;
	const v = row[displayField];
	if (v === null || v === undefined || v === '') return '—';
	if (typeof v === 'object') return relationLabel(v);
	return String(v);
}

export { relationLabel, formatFieldValue, selectOptionLabel, selectDisplayLabel, humanizeEnumValue } from './field-format';
export type { FieldSelectOption } from './field-format';

/**
 * Stable per-slug accent color for app tiles (Odoo-style dock). Shared by the
 * Studio preview and the runtime dock so an app keeps its identity everywhere.
 */
const APP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#6366f1'];

export function appColor(slug: string): string {
	let h = 0;
	for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 997;
	return APP_COLORS[h % APP_COLORS.length];
}

/** Version of the page block/`_meta` config schema produced by the Studio. */
export const PAGE_SCHEMA_VERSION = 1;

/** Reserved block types that are page metadata, not renderable content. */
const META_BLOCK_TYPES = new Set(['_meta', '_view_config']);

export function isMetaBlockType(type: string): boolean {
	return META_BLOCK_TYPES.has(type);
}

export { BLOCK_REGISTRY, CONTAINER_TYPES, isContainerType, blockColSpan } from './block-registry';
export type { BlockRegistryEntry } from './block-registry';
export { BlockView } from './block-renderer';
export type { PageBlockLike } from './block-renderer';
export { ChartView } from './chart-view';

/** Form-group label icons (shared picker + renderer — preview == runtime). */
export { GroupIcon } from './group-icons';

/** Lucide icon glyph helpers (no runtime CDN fetch — curated set + Box fallback). */
export { useLucideNodes, LucideGlyph } from './lucide-cdn';

/** Per-field grid span resolution (Studio 1/2/3/4 layout — preview == runtime). */
export { fieldSpanOf, isTextareaField } from './field-span';

/** Linkage-rule condition evaluation (visible_when etc. — preview == runtime). */
export { evalFieldCondition } from './field-conditions';
export type { FieldCondition } from './field-conditions';

/** Table-view editor config (schema_json.list_view — preview == runtime). */
export { tableColumnsOf, attachSummaryFooters } from './table-view';
export type { TableColumnMeta, TableViewConfig } from './table-view';

/** Card-view editor config (schema_json.card_view — preview == runtime). */
export { cardFieldsOf } from './card-view';
export type { CardFieldMeta, CardViewConfig } from './card-view';

/** Kanban-view editor config + grouping helpers (schema_json.kanban_view — preview == runtime). */
export { groupRowsForKanban } from './kanban-view';
export type { KanbanFieldMeta, KanbanViewConfig, KanbanColumn } from './kanban-view';

/** Pivot-report block config (rows × columns cross-tab — preview == runtime). */
export type { PivotViewConfig, PivotAggregate } from './pivot-view';

/** ReportView — renders a ReportDefinition in every context (blocks, views, embeds). */
export { ReportView, buildMeasureOptions, buildDimensionOptions } from './report-view';
export type { ReportDataSource, MeasureOption } from './report-view';
export type { ReportDefinition, ReportResult, ReportMeasure } from '@mmbix/types';

/** Shared kanban board renderer (Studio live preview + runtime entity list). */
export { KanbanBoard } from './kanban-board';
export type { KanbanBoardProps, KanbanRowLike, KanbanFieldLike } from './kanban-board';

/** Shared card grid renderer (Studio live preview + runtime EntityCardGrid). */
export { CardViewGrid, cardVisibleFields, DEFAULT_CARD_FIELDS } from './card-view-grid';
export type { CardViewGridProps, CardRowLike, CardFieldLike } from './card-view-grid';

/** Stored icon name → Lucide component (shared Studio + runtime resolution). */
export { smartIconFor } from './icon-resolver';

/** Code-first custom widgets — real DS components, one file per widget
 *  (packages/design-system/src/components/widgets). No database involved.
 *  Re-exported from the `@mmbix/design-system/widgets` subpath so the heavy
 *  Scheduler stays OUT of the DS core bundle (subpath-only invariant). */
export { WIDGET_REGISTRY, widgetDefOf, widgetDefaults } from '@mmbix/design-system/widgets';
export type { WidgetDef, WidgetPropDef, WidgetPropType } from '@mmbix/design-system/widgets';
export type { BindingSpec, DataSource } from './use-binding';
