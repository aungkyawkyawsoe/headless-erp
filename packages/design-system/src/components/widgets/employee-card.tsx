import { Phone, CalendarDays } from 'lucide-react';

import { Card, CardContent } from '@/card';
import { MediaPanel } from '@/media-panel';
import { InfoRow } from '@/info-row';
import { CounterChip } from '@/counter-chip';
import type { WidgetDef } from './types';

/** Initials from a name — "Hnin Wai Phyo" → "HW". */
function initialsOf(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => w[0]?.toUpperCase() ?? '')
		.join('');
}

/**
 * RecordCard — a HEADLESS record renderer (one widget = one DS file).
 *
 * It holds NO demo data and NO business assumptions: everything is inflated
 * from the block config at render time —
 *   - `data`      the live record (resolved from a `bind` spec by the engine)
 *   - `<slot>Field` mapping props  which record field feeds which visual slot
 *   - `tags` / `counters`          optional JSON configs for chips/metrics
 *
 * Missing fields render nothing (graceful empty states), so the same widget
 * can display an employee, an order, a machine, … — any data, any situation.
 */
export function EmployeeCard(props: Record<string, unknown>) {
	const rec = (props.data ?? null) as Record<string, unknown> | null;
	const field = (slot: string, fallback: unknown = ''): string => {
		const f = typeof props[`${slot}Field`] === 'string' ? String(props[`${slot}Field`]) : '';
		if (rec && f && rec[f] !== undefined && rec[f] !== null) return String(rec[f]);
		return String(fallback ?? '');
	};
	const name = field('name', props.name);
	const role = field('role', props.role);
	const phone = field('phone', props.phone);
	const code = field('code', props.code);
	const sub = field('sub', props.sub);
	const tenure = field('tenure', props.tenure);
	const initials = String(props.initials ?? '') || initialsOf(name);
	const gender = String(props.gender ?? '');
	const status = String(props.status ?? '');
	const tags = Array.isArray(props.tags) ? (props.tags as Array<{ label: string; fg?: string; bg?: string }>) : [];
	const counters = Array.isArray(props.counters) ? (props.counters as Array<{ label: string; count: number; tone?: string }>) : [];
	const hasBody = Boolean(role || phone || tenure || tags.length > 0 || counters.length > 0);

	if (!name && !code && !hasBody) {
		return (
			<Card
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '10rem',
					padding: '1rem',
					color: 'var(--mmbix-muted-foreground, #9ca3af)',
					fontSize: '0.78rem',
				}}
			>
				No data — bind a collection (Data → Data binding) or set the mapping fields.
			</Card>
		);
	}

	return (
		<Card style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: '10rem', padding: 0 }}>
			<MediaPanel initials={initials} status={status} code={code} sub={sub} style={{ width: 112, alignSelf: 'stretch' }} />
			<CardContent style={{ flex: 1, minWidth: 0, padding: '0.65rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span
						style={{
							flex: 1,
							minWidth: 0,
							fontSize: '0.92rem',
							fontWeight: 600,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{name}
					</span>
					{gender ? (
						<span
							style={{
								flexShrink: 0,
								padding: '0.1rem 0.5rem',
								borderRadius: 999,
								fontSize: '0.66rem',
								fontWeight: 700,
								color: '#fff',
								background: 'var(--mmbix-brand-primary, #3b82f6)',
							}}
						>
							{gender}
						</span>
					) : null}
				</div>
				{role ? (
					<span
						style={{
							fontSize: '0.78rem',
							fontWeight: 500,
							color: 'var(--mmbix-accent-teal, #0d9488)',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{role}
					</span>
				) : null}
				{phone ? <InfoRow icon={<Phone size={12} />} value={phone} /> : null}
				{tenure ? <InfoRow icon={<CalendarDays size={12} />} value={tenure} /> : null}
				<div
					style={{
						marginTop: 'auto',
						paddingTop: '0.4rem',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: 6,
					}}
				>
					<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
						{tags.map((t) => (
							<span
								key={t.label}
								style={{
									padding: '0.12rem 0.5rem',
									borderRadius: 4,
									fontSize: '0.66rem',
									fontWeight: 600,
									color: t.fg ?? '#6b7280',
									background: t.bg ?? '#f3f4f6',
								}}
							>
								{t.label}
							</span>
						))}
					</div>
					<div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
						{counters.map((ct) => (
							<CounterChip key={ct.label} label={ct.label} count={ct.count} tone={ct.tone} />
						))}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

/** Registry metadata — one per widget file (see scripts/widgets.mjs). */
export const widgetMeta: WidgetDef = {
	type: 'widget:employee-card',
	label: 'Record Card',
	group: 'Widgets',
	icon: 'id-card',
	defaultColSpan: 4,
	defaultProps: {},
	props: {
		// Data binding — the block renderer resolves `bind` and passes `data`.
		bind: {
			label: 'Data binding (JSON)',
			type: 'code',
			group: 'Data',
			default: '',
			hint: '{ "kind": "count|list|item|aggregate", "collection": "…", "id": "…", "limit": 10 } — empty = config-only (static).',
		},
		collection: { label: 'Collection (for field mapping)', type: 'collection', group: 'Data', hint: 'Populates the field dropdowns below' },
		nameField: { label: 'Name field', type: 'field', group: 'Data', default: 'full_name' },
		roleField: { label: 'Role field', type: 'field', group: 'Data', default: 'role' },
		phoneField: { label: 'Phone field', type: 'field', group: 'Data', default: 'phone' },
		codeField: { label: 'Code field', type: 'field', group: 'Data', default: 'display_number' },
		subField: { label: 'Department field', type: 'field', group: 'Data', default: 'department' },
		tenureField: { label: 'Tenure field', type: 'field', group: 'Data', default: 'joined_at' },
		tags: {
			label: 'Tags (JSON array)',
			type: 'code',
			group: 'General',
			default: '[]',
			hint: '[{ "label": "Senior", "fg": "#fff", "bg": "#2563eb" }]',
		},
		counters: {
			label: 'Counters (JSON array)',
			type: 'code',
			group: 'General',
			default: '[]',
			hint: '[{ "label": "Orders", "count": 3, "tone": "success" }]',
		},
		name: { label: 'Name (static fallback)', type: 'text', group: 'General' },
		initials: { label: 'Initials (auto from name when empty)', type: 'text', group: 'General' },
		status: {
			label: 'Status tone',
			type: 'select',
			group: 'General',
			options: [
				{ value: '', label: 'None' },
				{ value: 'success', label: 'Success' },
				{ value: 'warning', label: 'Warning' },
				{ value: 'danger', label: 'Danger' },
				{ value: 'neutral', label: 'Neutral' },
			],
			default: '',
		},
		code: { label: 'Code (static fallback)', type: 'text', group: 'General' },
		sub: { label: 'Sub-label (static fallback)', type: 'text', group: 'General' },
		role: { label: 'Role (static fallback)', type: 'text', group: 'General' },
		gender: { label: 'Badge text', type: 'text', group: 'General' },
		phone: { label: 'Phone (static fallback)', type: 'text', group: 'General' },
		tenure: { label: 'Tenure (static fallback)', type: 'text', group: 'General' },
	},
	Component: EmployeeCard,
	exportName: 'EmployeeCard',
};
