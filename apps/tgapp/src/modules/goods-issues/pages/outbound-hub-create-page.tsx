import { OutboundCreatePage, type OutboundPrefillLine } from './outbound-create-page';
import { OUTBOUND_TYPE_PARAM } from './outbound-hub-page';
import { decodePrefillJson } from '../data/api';
import { URL_PARAM, stringParam, useViewState } from '@/shared/url-state';

/** The create screen's WHOLE URL view state — the kind tab plus the prefill
 *  context (base64 lines, source requisition id + display ref). */
const OUTBOUND_CREATE_VIEW = {
	[URL_PARAM.type]: OUTBOUND_TYPE_PARAM,
	[URL_PARAM.prefill]: stringParam,
	[URL_PARAM.request]: stringParam,
	[URL_PARAM.requestRef]: stringParam,
} as const;

/**
 * The outbound hub's single `/+` destination (`/app/outbounds/+?type=…`). The
 * kind is URL-driven through the SAME `?type=` parser as the hub tabs, so each
 * tab's + button opens the draft form for that kind and a successful save
 * returns to the tab it came from.
 *
 * `?prefill=<base64-json>` carries a store request's lines (the store-requests
 * card's "Issue" action) — the form opens with those rows already filled so the
 * operator only reviews + confirms. `?request=<reqId>` (plus the optional
 * `?request_ref=<REQ-…>` display number) link the GOODS-ISSUE draft back to the
 * source store request on its header. Absent = a plain empty draft.
 */
export default function OutboundHubCreatePage() {
	const [view] = useViewState(OUTBOUND_CREATE_VIEW);
	const { type, prefill: prefillRaw, request: requestId, request_ref: requestRef } = view;

	const initialLines = parsePrefill(prefillRaw);

	return (
		<OutboundCreatePage type={type} initialLines={initialLines} initialRequestId={requestId ?? undefined} requestRefLabel={requestRef} />
	);
}

/** Decode the `?prefill=` payload — a base64-encoded JSON array of pre-filled
 *  lines. Any malformed payload is dropped (the form opens blank) rather than
 *  throwing out of the route. Only `modelId` + `qty` are read: an outbound line
 *  carries no batch restriction the engine would honour (see `OutboundLineDraft`),
 *  so a legacy payload's extra keys are dropped rather than silently kept. */
function parsePrefill(raw: string | null): OutboundPrefillLine[] | undefined {
	if (!raw) return undefined;
	const parsed = decodePrefillJson<unknown>(raw);
	if (!Array.isArray(parsed)) return undefined;
	const lines: OutboundPrefillLine[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') continue;
		const row = entry as { modelId?: unknown; qty?: unknown };
		if (typeof row.modelId !== 'string' || typeof row.qty !== 'string') continue;
		lines.push({ modelId: row.modelId, qty: row.qty });
	}
	return lines.length > 0 ? lines : undefined;
}
