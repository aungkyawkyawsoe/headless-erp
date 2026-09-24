import { SegmentedTabs } from '@/shared/components/segmented-tabs';

export type TyreModuleScope = 'serial' | 'fleet';

/**
 * The tyre module's scope tabs — By Serial (the search-first serial-unit lookup,
 * the module's DEFAULT first tab) ↔ By Fleet (the plate-search-first fleet
 * lookup). Both screens keep this pill row so the operator can switch without
 * leaving the module; each pill is a REAL route, so the URL follows the focused
 * tab:
 *
 *   - By Serial → `/app/tyres/serial` (also the module landing: `/app/tyres`
 *     redirects here, so the launcher tile opens the default tab);
 *   - By Fleet → `/app/tyres/fleet`.
 *
 * Tabs are VIEW STATE, not navigation: switching replaces the current history
 * entry (the pages navigate with `{ replace: true }`), so flicking Serial ↔
 * Fleet any number of times never stacks entries and the module's back arrow
 * leaves for the app gallery in ONE press.
 *
 * The full fleet fitment BOARD (every plate, browse-all) is not a scope tab —
 * it is reached from By Fleet's idle link (`/app/tyres/fitment`).
 */
const SCOPE_OPTIONS: ReadonlyArray<{ value: TyreModuleScope; label: string }> = [
	{ value: 'serial', label: 'By Serial' },
	{ value: 'fleet', label: 'By Fleet' },
];

const SCOPE_ROUTES: Record<TyreModuleScope, string> = {
	serial: '/app/tyres/serial',
	fleet: '/app/tyres/fleet',
};

interface TyreModuleScopeNavProps {
	active: TyreModuleScope;
	onNavigate: (to: string) => void;
}

export function TyreModuleScopeNav({ active, onNavigate }: TyreModuleScopeNavProps) {
	return (
		<SegmentedTabs
			options={SCOPE_OPTIONS}
			value={active}
			onChange={(scope) => onNavigate(SCOPE_ROUTES[scope])}
			showCount={false}
			ariaLabel="Tyre module scope"
		/>
	);
}
