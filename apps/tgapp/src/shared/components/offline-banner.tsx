import { RefreshCw, WifiOff } from 'lucide-react';

import { useOnline, usePendingCount, syncOfflineNow } from '@/shared/hooks/use-offline';

/**
 * App-wide offline / pending-sync indicator.
 *
 * Renders NOTHING while the API is reachable and the queue is empty, so it never
 * affects normal layout — it only appears in the two abnormal states a mobile
 * Telegram Mini App actually hits: the link is down, or writes are waiting to
 * replay. It parks just below the fixed app header (`top-header`) so it never
 * fights the bottom action bar, and taps-through when idle.
 */
export function OfflineBanner() {
	const online = useOnline();
	const pending = usePendingCount();

	if (online && pending === 0) return null;

	const offline = !online;
	const pendingLabel = pending === 1 ? '1 change' : `${pending} changes`;

	return (
		<div className="pointer-events-none fixed inset-x-0 top-header z-40 flex justify-center px-4">
			<div
				role="status"
				aria-live="polite"
				className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg ${
					offline
						? 'border-status-danger/30 bg-status-danger-soft text-status-danger'
						: 'border-status-warning/30 bg-status-warning-soft text-status-warning'
				}`}
			>
				{offline ? (
					<WifiOff className="size-3.5 shrink-0" aria-hidden />
				) : (
					<RefreshCw className="size-3.5 shrink-0 animate-spin" aria-hidden />
				)}
				{offline ? (
					<span>{pending > 0 ? `Offline · ${pendingLabel} waiting to sync` : 'Offline — changes will sync when back online'}</span>
				) : (
					<button type="button" onClick={() => void syncOfflineNow()} className="leading-none">
						{pendingLabel} waiting to sync — tap to retry
					</button>
				)}
			</div>
		</div>
	);
}
