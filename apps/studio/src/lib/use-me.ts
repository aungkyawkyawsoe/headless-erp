/**
 * `useMe` — the session's identity + capabilities, from `/auth/me`.
 *
 * One query per session (cached), shared by every surface that needs to gate
 * itself. `resolved` is false until the read settles, so a gate can keep its
 * admin-only UI hidden rather than flash it before the answer arrives.
 */
import { useQuery } from '@tanstack/react-query';
import { meQuery } from './queries';
import { canAdminister, canReadCollection, isAdmin } from './capabilities';

export function useMe(token: string) {
	const q = useQuery(meQuery(token));
	const me = q.data ?? null;
	return {
		me,
		/** True once the read settled (success OR failure) — safe to decide UI. */
		resolved: q.isSuccess || q.isError,
		isAdmin: isAdmin(me),
		canAdminister: canAdminister(me),
		canRead: (slug: string) => canReadCollection(me, slug),
	};
}
