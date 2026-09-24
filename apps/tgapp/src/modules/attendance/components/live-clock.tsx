import { useEffect, useState } from 'react';

import { formatClockTime } from '@/shared/time/myanmar';

/** "Thu, Sep 3" — the clock's date line in English (locale-independent). */
function formatClockDate(date: Date): string {
	return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Ticking clock — the header's right slot, exactly per the design reference:
 * a bold `07:51:08 PM` over the date line ("Thu, Sep 3"). Ticks once per
 * second; the single `setInterval` is owned by this component.
 */
export function LiveClock() {
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		const id = setInterval(() => setNow(new Date()), 1000);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="flex shrink-0 flex-col items-end justify-center gap-1 text-right">
			<div className="text-base font-bold leading-6 tracking-tight text-foreground tabular-nums">{formatClockTime(now)}</div>
			<div className="text-meta leading-none text-muted-foreground">{formatClockDate(now)}</div>
		</div>
	);
}
