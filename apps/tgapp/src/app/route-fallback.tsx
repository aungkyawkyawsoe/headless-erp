/**
 * The Suspense fallback for the lazy route table.
 *
 * Router 7 runs a navigation as a transition, so the previous screen stays
 * painted until the destination's chunk lands and this fallback only shows on a
 * COLD entry (a deep link straight to `/app/<module>` in Telegram). Even then it
 * must not read as a hang: it renders the app's themed background with a centred
 * spinner instead of an unstyled full-viewport spinner that flashes the client's
 * own background.
 *
 * Deliberately lightweight: it must NOT import the launcher registry (and with
 * it every lucide icon), or the entry bundle drags the whole icon set onto the
 * critical path just to title a transient screen. `PageSpinner` is a bare
 * React component with no other imports.
 */
import { PageSpinner } from '@/shared/components/page-spinner';

export function RouteFallback() {
	return <PageSpinner />;
}
