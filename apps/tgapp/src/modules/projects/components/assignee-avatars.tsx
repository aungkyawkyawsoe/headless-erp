import type { AssigneeInfo } from '../data/types';

/** Two-letter initials for a person without a photo ("Alex Rivera" → "AR"). */
function initials(name: string | null): string {
	if (!name) return '?';
	return (
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
}

/**
 * The avatar sizes — one entry per surface, so the ring/type scale that belongs
 * with a diameter can never drift when a size is reused.
 *
 * `sm` — the compact list row (`TaskCard`). `md` — the detail header, a form's
 * selected chips and the workload leaderboard: big enough that a face is
 * actually recognisable, which is the point of showing who is assigned.
 */
const SIZES = {
	sm: { avatar: 'size-9', text: 'text-xs', ring: 'ring-2' },
	md: { avatar: 'size-11', text: 'text-sm', ring: 'ring-2' },
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * The assignee avatars — the first `max` people with a `+N` overflow chip.
 * Falls back to initials when a person has no photo, and to a muted
 * "Unassigned" label when the task has no assignees at all.
 *
 * People sit SPACED, not overlapped: an overlapped stack crops the faces it
 * exists to show and hides exactly how many people are assigned, which is the
 * question the cluster answers. The size is a named scale (`sm` / `md`), not a
 * caller-supplied class, because the ring colour (`ring-card`) has to match the
 * surface behind the cluster — so it travels WITH the size.
 */
export function AssigneeAvatars({
	assignees,
	max = 4,
	size = 'sm',
	showNames = false,
}: {
	assignees: AssigneeInfo[];
	max?: number;
	size?: AvatarSize;
	/** Render each person's name beside their avatar (roomier surfaces). */
	showNames?: boolean;
}) {
	const scale = SIZES[size];
	if (assignees.length === 0) {
		return <span className="text-meta font-medium leading-myanmar text-muted-foreground">Unassigned</span>;
	}
	const shown = assignees.slice(0, max);
	const extra = assignees.length - shown.length;
	return (
		<span className="flex flex-wrap items-center gap-1.5">
			{shown.map((person) => (
				<span key={person.id} className="flex min-w-0 items-center gap-2">
					<span
						title={person.name ?? undefined}
						className={`flex ${scale.avatar} shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted ${scale.text} font-bold text-muted-foreground ${scale.ring} ring-card`}
					>
						{person.photo ? <img src={person.photo} alt="" className="size-full object-cover" /> : initials(person.name)}
					</span>
					{showNames && person.name && (
						<span className="truncate text-xs font-semibold leading-myanmar text-foreground">{person.name}</span>
					)}
				</span>
			))}
			{extra > 0 && (
				<span
					className={`flex ${scale.avatar} shrink-0 items-center justify-center rounded-full bg-muted ${scale.text} font-bold text-muted-foreground ${scale.ring} ring-card`}
				>
					+{extra}
				</span>
			)}
		</span>
	);
}
