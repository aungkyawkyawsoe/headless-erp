import { memo } from 'react';
import { User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { EMPLOYEE_STATUS_LABELS } from '../data/status';
import { ErpRow } from '@/shared/components/erp-row';
import type { EmployeeRow } from '../data/types';

/**
 * Employee card — ONE directory row for the ဝန်ထမ်းများ (`/app/employees`) list:
 *
 *  ┌──────────────────────────────────────────┐
 *  │ [avatar] ဦးမျိုးအောင်           9 ရက်     │
 *  │          WH-0001                       ♂ │
 *  └──────────────────────────────────────────┘
 *
 *  - **Identity block** — the directory photo (`avatar`) or the lucide employee
 *    icon when there's no photo, with the status presence dot, the name (MM) and
 *    the EID beneath it;
 *  - **Service-duration badge** — top-right, showing the whole years · months ·
 *    days since `doj` ("1y 2m 5d"); omitted entirely when there's no ဝင်ရက်စွဲ;
 *  - **Gender glyph** — a tinted lucide ♂/♀ icon anchored at the bottom-right
 *    corner. The relations (`department` / `designation`) are intentionally NOT
 *    show here — they're joined only for the on-demand details sheet, so the
 *    initial card reads the scalar projection only.
 *
 * Tapping the card opens the employee's full profile PAGE
 * (`/app/employees/:id`, a real route) — the page owns the navigation.
 */

/** Active-status dot — the avatar's bottom-right presence badge, CENTERED ON
 * the avatar circle's edge so it reads half-on / half-off (the classic
 * presence look — both avatars below place the dot's center on the circle's
 * boundary at the bottom-right diagonal, with the ring color matching the
 * surface behind the avatar). Truthy (`true` / raw DB `1`) = အလုပ်တက်နေ (solid
 * green), anything else = ရပ်နား (solid muted gray — never translucent, so it
 * stays legible over a photo).
 *
 * `variant` picks the tuned inset/ring for the avatar size:
 * - `card` — the 40px directory-card avatar (`bottom-0.5 right-0`, `size-2.5`,
 *   `ring-card`);
 * - `sheet` — the 56px details-sheet avatar (`bottom-2 right-2`, `size-3`,
 *   `ring-popover`).
 *
 * Parent must be `relative` and wrap ONLY the avatar (the dot positions
 * against that exact box). */
export function EmployeeStatusDot({ active, variant = 'card' }: { active?: boolean | number | null; variant?: 'card' | 'sheet' }) {
	const on = active === true || active === 1;
	const label = on ? EMPLOYEE_STATUS_LABELS.active : EMPLOYEE_STATUS_LABELS.inactive;
	const placement = variant === 'sheet' ? 'bottom-1 right-0 size-3 ring-popover' : 'bottom-0.5 right-0 size-2.5 ring-card';
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			className={`absolute shrink-0 rounded-full ring-2 ${placement} ${on ? 'bg-status-success' : 'bg-muted-foreground'}`}
		/>
	);
}

/** Service duration since `doj` — whole years · months · days elapsed (UTC,
 * so the calendar day never shifts with the viewer's timezone), or `null` when
 * the date is missing or malformed. A join date still in the future clamps to
 * 0y 0m 0d. Days borrow across the previous month's length, months across 12. */
function serviceDuration(doj?: string | null): { years: number; months: number; days: number } | null {
	const [year, month, day] = (doj ?? '').split('-').map(Number);
	if (!year || !month || !day) return null;
	const joined = new Date(Date.UTC(year, month - 1, day));
	const now = new Date();
	let years = now.getUTCFullYear() - joined.getUTCFullYear();
	let months = now.getUTCMonth() - joined.getUTCMonth();
	let days = now.getUTCDate() - joined.getUTCDate();
	if (days < 0) {
		months -= 1;
		days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
	}
	if (months < 0) {
		years -= 1;
		months += 12;
	}
	return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

/** "1y 2m 5d" — the badge's duration text: zero years/months are dropped (a
 * fresh hire reads "29d", never "0y 0m 29d"), while the day count always shows
 * so a same-day join still reads "0d". */
function serviceLabel({ years, months, days }: { years: number; months: number; days: number }): string {
	const parts: string[] = [];
	if (years > 0) parts.push(`${years}y`);
	if (months > 0) parts.push(`${months}m`);
	if (days > 0 || parts.length === 0) parts.push(`${days}d`);
	return parts.join(' ');
}

/** The service-duration status pill config — the soft-warning tint family, or
 *  `undefined` when there is no ဝင်ရက်စွဲ (so no empty badge renders). */
function serviceStatus(doj?: string | null): { label: string; className: string } | undefined {
	const duration = serviceDuration(doj);
	if (duration === null) return undefined;
	return { label: serviceLabel(duration), className: 'bg-status-warning-soft text-status-warning' };
}

interface EmployeeCardProps {
	/** The `employees` directory row. */
	employee: EmployeeRow;
	/** Called when the card is tapped — the page navigates to the profile route. */
	onOpen?: (employee: EmployeeRow) => void;
}

export const EmployeeCard = memo(function EmployeeCard({ employee, onOpen }: EmployeeCardProps) {
	const name = employee.name_mm || employee.name_en || '—';

	return (
		<ErpRow
			anchor={name}
			secondary={employee.eid || '—'}
			status={serviceStatus(employee.doj)}
			onOpen={() => onOpen?.(employee)}
			leading={
				<div className="relative shrink-0">
					{/* Directory photo — the `avatar` media field (`/api/media/...`),
						when present; no photo → the lucide employee icon, never initials. */}
					<Avatar className="size-9">
						{employee.avatar ? <AvatarImage src={employee.avatar} alt={name} /> : null}
						<AvatarFallback>
							<User className="size-4.5" strokeWidth={2} aria-hidden />
						</AvatarFallback>
					</Avatar>
					<EmployeeStatusDot active={employee.active} />
				</div>
			}
		/>
	);
});
