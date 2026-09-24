import { TYRE_STATUS_META, type TyreStatus } from '../data/status';

/** The two pill sizes in use — the register/detail size and the tighter dialog
 *  size (previously the padding/font drifted between four local copies). */
const SIZES = {
	sm: 'px-2.5 py-0.5 text-[10px]',
	xs: 'px-2 py-0.5 text-[9px]',
} as const;

/**
 * The tyre status pill — ONE implementation for the register card, the detail
 * body, the wheel dialogs and the transfer request section. The tint/label come
 * from the module's `TYRE_STATUS_META` (single source), so only the size varies.
 */
export function TyreStatusPill({ status, size = 'sm' }: { status: TyreStatus; size?: keyof typeof SIZES }) {
	const meta = TYRE_STATUS_META[status];
	return (
		<span className={`shrink-0 rounded-full font-semibold leading-myanmar whitespace-nowrap ${SIZES[size]} ${meta.className}`}>
			{meta.label}
		</span>
	);
}
