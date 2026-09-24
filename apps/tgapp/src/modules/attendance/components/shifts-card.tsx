import { Clock, MapPin } from 'lucide-react';

import { Shimmer } from '@/shared/components/skeletons';

/** A shift assignment linked to a location. */
export interface ShiftLocation {
	id: string;
	shift_name?: string | null;
	/** Expected start time (HH:MM) */
	start_time?: string | null;
	/** Expected end time (HH:MM) */
	end_time?: string | null;
	lat?: number | null;
	lng?: number | null;
	location_name?: string | null;
	/** Radius in meters for geofencing */
	radius?: number | null;
}

interface ShiftsCardProps {
	shifts?: ShiftLocation[] | null;
	loading?: boolean;
}

/**
 * Card showing the user's assigned shift(s) with time and location info.
 * Data comes from the employee's shift assignments via the API — the
 * `hrm_employees.shifts` m2m expansion (same junction the edit form writes).
 */
export function ShiftsCard({ shifts, loading }: ShiftsCardProps) {
	if (loading) {
		return (
			<div className="rounded-lg border border-border bg-card p-3">
				<div className="flex items-center gap-2">
					<Shimmer className="h-4 w-4 rounded" />
					<Shimmer className="h-3.5 w-16 rounded" />
				</div>
				<div className="mt-2 space-y-2">
					<Shimmer className="h-10 w-full rounded" />
				</div>
			</div>
		);
	}

	const all = shifts ?? [];

	if (all.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-card p-3">
				<div className="flex items-center gap-2 text-sm font-medium text-foreground">
					<Clock className="size-4 text-primary" />
					<span>Working Hours</span>
				</div>
				<p className="mt-1.5 text-xs text-muted-foreground">No shift assigned for today</p>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-card p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<Clock className="size-4 text-primary" />
				<span>Working Hours / Shift</span>
			</div>
			<ul className="mt-2 space-y-2">
				{all.map((shift) => (
					<li key={shift.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs">
						<div className="flex items-center justify-between">
							<span className="font-semibold text-foreground">{shift.shift_name}</span>
							<span className="tabular-nums text-muted-foreground">
								{shift.start_time} – {shift.end_time}
							</span>
						</div>
						{shift.location_name || (shift.lat && shift.lng) ? (
							<div className="mt-1 flex items-center gap-1 text-muted-foreground">
								<MapPin className="size-3 shrink-0" aria-hidden />
								<span className="truncate">{shift.location_name ?? `${shift.lat?.toFixed(4)}, ${shift.lng?.toFixed(4)}`}</span>
								{shift.radius ? <span className="shrink-0 tabular-nums">({shift.radius}m)</span> : null}
							</div>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}
