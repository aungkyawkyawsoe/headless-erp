import { Badge } from '@mmbix/design-system';

/** Deployment workflow states → preattentive color coding.
 *  live=green, promoted=blue, review=amber, draft=gray, rolled_back=red. */
const STATUS_COLORS: Record<string, { color: string; bg: string; border: string }> = {
	live: { color: '#15803d', bg: '#ecfdf5', border: '#86efac' },
	promoted: { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
	review: { color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
	draft: { color: '#4b5563', bg: '#f9fafb', border: '#d1d5db' },
	rolled_back: { color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5' },
};

const FALLBACK = { color: '#4b5563', bg: '#f9fafb', border: '#d1d5db' };

/** A deployment-status Badge with a stable color per workflow state. */
export default function IdpStatusBadge({ status }: { status: string }) {
	const key = (status ?? '').toLowerCase();
	const c = STATUS_COLORS[key] ?? FALLBACK;
	return (
		<Badge
			variant="outline"
			style={{
				color: c.color,
				background: c.bg,
				borderColor: c.border,
				fontWeight: 600,
				textTransform: 'capitalize',
			}}
		>
			{status || '—'}
		</Badge>
	);
}
