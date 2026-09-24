import { List } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/**
 * The search-first kiosk's "browse all" affordance — tucked into the BOTTOM-END
 * corner of the layout, deliberately out of the way.
 *
 * A kiosk opens blank with ONE centred search; its full register/board is a
 * SECONDARY action. It sits at the bottom edge, right-aligned and small, so it
 * stays clear of the search/typing zone and is not tapped by accident while the
 * operator is looking something up — a deliberate corner tap is needed. ONE
 * component behind every kiosk (the shared `SearchKiosk` AND each hand-rolled
 * module screen), so the placement and label style can never drift.
 *
 * Rendered as a SIBLING of the centred search block inside the kiosk's
 * `flex flex-1 flex-col` column: the centred block keeps `flex-1`, so this lands
 * on the bottom edge; `ml-auto` pushes it to the end (right) corner.
 */
export function KioskBrowseLink({ to, label }: { to: string; label: string }) {
	const navigate = useNavigate();
	return (
		<button
			type="button"
			onClick={() => navigate(to)}
			className="ml-auto mt-auto -mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta font-medium text-muted-foreground/75 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
		>
			<List className="size-3" aria-hidden /> {label}
		</button>
	);
}
