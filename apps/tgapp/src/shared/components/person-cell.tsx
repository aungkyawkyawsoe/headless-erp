/**
 * One actor's role over their resolved name — the doc detail pages' shared
 * metadata cell. The markup was copied (as `PersonCell` / `ActorCell`) into the
 * adjustment, stock-move and store-request detail pages; one definition now.
 *
 * Takes the actor STRUCTURALLY (`{ name }`) so each module passes its own
 * resolved-person shape without a cross-module type import.
 */
export function PersonCell({ role, person }: { role: string; person: { name?: string | null } }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-[9px] font-semibold uppercase tracking-wide leading-myanmar text-muted-foreground">{role}</span>
			<span className="truncate text-[12px] font-semibold leading-myanmar text-foreground">{person.name ?? '—'}</span>
		</div>
	);
}
