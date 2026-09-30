import StatusBadge from './StatusBadge';

/**
 * A deployment-status pill. Kept as a thin alias so existing imports keep working
 * — the colour is now the ONE tokenized `StatusBadge` (see `lib/status.ts`), so a
 * status reads the same here as on every other screen. */
export default function IdpStatusBadge({ status }: { status: string }) {
	return <StatusBadge status={status} />;
}
