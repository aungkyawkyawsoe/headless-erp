import { toast } from '@mmbix/design-system/toast';

/**
 * The ONE success confirmation for a completed write.
 *
 * Every create/edit path ends by invalidating a TanStack key (and usually
 * `popBack`), which is invisible to the operator: the screen simply closes and
 * the list may already be warm from cache, so "saved" and "the tap did nothing"
 * look identical. A punch already toasted (attendance-page) while a requisition
 * silently vanished — adoption was a coin flip. Routing every save through this
 * helper makes the confirmation the default, not an accident, so a user learns
 * to trust the feedback instead of re-checking the list.
 *
 * Kept side-effect-only (no navigation) so callers keep owning their own
 * `popBack(navigate, …)` destination.
 */
export function notifySaved(title: string, description?: string): void {
	toast.add({ type: 'success', title, description });
}

/**
 * The ONE failure toast for a write that did not complete. Paired with
 * `notifySaved` so success and failure share a channel — screens had drifted
 * between the helper, raw `toast.add`, and an inline banner for the same event.
 * A caller with a field-specific fix still uses an inline error; this is for the
 * SUBMIT-level failure.
 */
export function notifyFailed(title: string, description?: string): void {
	toast.add({ type: 'error', title, description });
}
