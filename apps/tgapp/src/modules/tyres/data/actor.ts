/**
 * The ONE way a tyre/mro kiosk writer resolves the acting employee for `by_user`
 * attribution on the immutable lifecycle event it appends.
 *
 * Every kiosk mutation (wear / un-wear / move / return / scrap / stage) must name
 * who did it, or the engine's audit trail is worthless. The session carries the
 * linked `hrm_employees` row; an admin/password session has none, so the attempt
 * fails LOUDLY rather than appending an unattributed event.
 */
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';

/** The acting employee's `hrm_employees.id`. Throws with an actionable message
 *  when the session has no linked employee. */
export async function requireActorId(): Promise<string> {
	const actor = await fetchCurrentEmployee();
	if (!actor) throw new Error('No employee account is linked to this session — log in to make tyre changes.');
	return actor.id;
}
