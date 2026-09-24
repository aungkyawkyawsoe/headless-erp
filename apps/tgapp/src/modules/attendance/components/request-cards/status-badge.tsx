import { STATUS_META } from '../../data/request-meta';
import type { HrRequestStatus } from '../../data/types';

/** Status pill — ROUNDED-FULL + tinted (soft bg + tone text), no border.
 *  Shared by request cards and the approval rows (re-exported from
 *  `components/request-card`). */
export function RequestStatusBadge({ status }: { status?: HrRequestStatus | null }) {
	const meta = STATUS_META[status ?? 'pending'] ?? STATUS_META.pending;
	return (
		<span className={`shrink-0 rounded-full px-3 py-0.5 text-meta font-semibold leading-myanmar ${meta.className}`}>{meta.label}</span>
	);
}
