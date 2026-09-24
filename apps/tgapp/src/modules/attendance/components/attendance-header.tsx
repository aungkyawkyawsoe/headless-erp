import { User } from 'lucide-react';

import { LiveClock } from './live-clock';
import { CARD_FRAME } from '@/shared/components/card';
import { Shimmer } from '@/shared/components/skeletons';

/**
 * Fallback identity for when the session has no directory row yet — dashes
 * (name + eid) so the header never renders empty or a bare "?" circle.
 */
const DEFAULT_NAME = '----';
const DEFAULT_EID = '----';

interface AttendanceHeaderProps {
	/** Display name (falls back to the English name at the call site). */
	name?: string | null;
	/** Employee id shown under the name (e.g. "MFF-009"). */
	eid?: string | null;
	/** Directory photo URL — the initials circle (or person icon) when absent. */
	photoUrl?: string | null;
	/** On the clock right now (a check-in exists, no check-out yet) — shows the
	 *  green presence dot on the avatar. */
	online?: boolean;
	loading?: boolean;
	/** Spacing overrides from the page (the dashboard gives this card a bottom
	 *  margin so the punch cards below it are not flush against it). */
	className?: string;
}

/**
 * The dashboard's profile card — avatar + name + eid on the left, the live MMT
 * clock on the right, on a raised card (the design reference's top block).
 *
 * No user (session resolved but no employee row / failed lookup) → the default
 * identity above with a person-icon avatar; a real user without a photo keeps
 * the initials circle; loading keeps the dots.
 */
export function AttendanceHeader({ name, eid, photoUrl, online = false, loading, className }: AttendanceHeaderProps) {
	const displayName = name?.trim() || null;
	const displayEid = eid?.trim() || null;
	const noUser = !loading && !displayName && !displayEid;

	const resolvedName = noUser ? DEFAULT_NAME : (displayName ?? '—');
	const resolvedEid = noUser ? DEFAULT_EID : (displayEid ?? '—');
	const resolvedPhoto = noUser ? null : photoUrl;
	const initial = resolvedName.charAt(0);

	return (
		<div className={`flex items-center justify-between gap-3 ${CARD_FRAME} p-4 shadow-sm ${className ?? ''}`}>
			{loading ? (
				/* Shimmer placeholder — avatar circle + name/eid lines; the clock is
				 * live regardless, so it renders normally next to the skeleton. */
				<div className="flex min-w-0 items-center gap-3" aria-hidden>
					<Shimmer className="size-11 shrink-0 rounded-full" />
					<div className="flex flex-col gap-2">
						<Shimmer className="h-4 w-28 rounded" />
						<Shimmer className="h-3 w-16 rounded" />
					</div>
				</div>
			) : (
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<div className="relative shrink-0">
						{resolvedPhoto ? (
							<img src={resolvedPhoto} alt={resolvedName} className="size-11 rounded-full border border-border bg-muted object-cover" />
						) : (
							<span className="flex size-11 items-center justify-center rounded-full border border-border bg-primary/10 text-lg font-semibold text-foreground">
								{noUser ? <User className="size-5" aria-hidden /> : initial}
							</span>
						)}
						{online && (
							// The state is also carried in TEXT on the punch cards below — this
							// dot is the pre-attentive accent, never the only signal.
							<span
								role="img"
								className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-card bg-status-success"
								aria-label="Currently checked in"
							/>
						)}
					</div>
					<div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
						<h1 className="line-clamp-2 text-sm font-semibold leading-6 text-foreground">{resolvedName}</h1>
						<p className="truncate text-xs leading-none text-muted-foreground">{resolvedEid}</p>
					</div>
				</div>
			)}
			<LiveClock />
		</div>
	);
}
