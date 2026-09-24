import type { MroOutboundType } from './types';

/**
 * The canonical flow's per-type metadata — the single source the shared list /
 * create pages read. All three outbound kinds (ထုတ်ပေး / ပယ်ဖျက် / စွန့်ပစ်) are
 * the SAME engine document flow (`mro_outbounds` + lines) and differ only in
 * `type` + this copy. The launcher's ONE outbound hub (`/app/outbounds`)
 * switches these kinds with its tab row; list + create routes carry the active
 * kind in `?type=` so a create returns to the tab it came from.
 */
export interface OutboundTypeMeta {
	/** The card's small type tag (e.g. ထုတ်ပေး). */
	tagLabel: string;
	/** The `/+` create page's app-bar title. */
	createTitle: string;
	/** The create form's intro line — what this flow is FOR (Burmese). */
	semantics: string;
	/** The list route the create page navigates back to. */
	listRoute: string;
	/** The `/+` destination behind the list's + button. */
	createRoute: string;
}

export const OUTBOUND_TYPE_META: Record<MroOutboundType, OutboundTypeMeta> = {
	goods_issue: {
		tagLabel: 'Issue',
		createTitle: 'New Issue',
		semantics: 'Issue good, usable stock',
		listRoute: '/app/outbounds',
		createRoute: '/app/outbounds/+',
	},
	write_offs: {
		tagLabel: 'Write-off',
		createTitle: 'New Write-off',
		semantics: 'Write off expired / unusable stock',
		listRoute: '/app/outbounds?type=write_offs',
		createRoute: '/app/outbounds/+?type=write_offs',
	},
	defects_missing: {
		tagLabel: 'Dispose',
		createTitle: 'New Dispose',
		semantics: 'Dispose defect / missing stock',
		listRoute: '/app/outbounds?type=defects_missing',
		createRoute: '/app/outbounds/+?type=defects_missing',
	},
};

/** All three engine values — the `type` guard's membership list. */
const OUTBOUND_TYPE_VALUES: readonly MroOutboundType[] = ['goods_issue', 'write_offs', 'defects_missing'];

/** True when a row's `type` is one of the three outbound kinds. */
export function isOutboundType(value: unknown): value is MroOutboundType {
	return typeof value === 'string' && (OUTBOUND_TYPE_VALUES as readonly string[]).includes(value);
}
