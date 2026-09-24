/**
 * KanbanBoard — shared kanban renderer (Studio live preview == runtime list).
 *
 * A thin adapter over the design-system kanban component
 * (`@mmbix/design-system/kanban`): it groups the collection's records into
 * columns by `config.groupBy` (ui-views `groupRowsForKanban`) and injects the
 * CRM-style card layout (title, amount, info lines, tag pills, assignee avatar)
 * plus a compact column header — title with the column sum inline
 * ("Contract 3.3 M") — preview == runtime, both apps render the same board.
 */
import { useMemo } from 'react';
import {
	KanbanBoard as DSKanbanBoard,
	type KanbanCardRenderProps,
	type KanbanColumnDef,
	type KanbanColumnHeaderProps,
	type KanbanItem,
	type KanbanItemMoveEvent,
} from '@mmbix/design-system/kanban';
import { Avatar, AvatarFallback, Button, Skeleton } from '@mmbix/design-system';
import { Clock, Mail, Phone, Plus } from 'lucide-react';
import { isEmptyValue, formatFieldValue, relationLabel } from './field-format';
import { groupRowsForKanban, type KanbanViewConfig } from './kanban-view';

export interface KanbanRowLike {
	id: string | number;
	[key: string]: unknown;
}

export interface KanbanFieldLike {
	name: string;
	type: string;
	label?: string;
	display_template?: string | null;
	/** Select-field options (plain strings or {label, value}) — used to pretty-print column labels. */
	options?: Array<string | { label?: string; value?: string }>;
}

export interface KanbanBoardProps {
	config: KanbanViewConfig;
	rows: Array<Record<string, unknown>>;
	fields: KanbanFieldLike[];
	loading?: boolean;
	/** Fallback title field when config.titleField is empty. */
	displayField?: string | null;
	onCreate?: () => void;
	onOpen?: (id: string) => void;
	/** Persist a drag: move record `id` into the column `group` (group value). */
	onMoveCard?: (id: string, group: string) => void;
	emptyLabel?: string;
}

/** Board item — the record wrapped with its stable id for dnd-kit. */
interface RowItem extends KanbanItem {
	row: Record<string, unknown>;
}

/** First letters of the first two words — avatar fallback text. */
function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	return (
		words
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
}

/** Map a field type to its activity icon (phone/email/datetime → icon). */
function activityIconFor(type: string) {
	if (type === 'phone') return Phone;
	if (type === 'email') return Mail;
	if (type === 'datetime' || type === 'timestamp' || type === 'date' || type === 'time') return Clock;
	return null;
}

/** Soft pill color derived from the tag text (stable hash). */
const PILL_COLORS = ['#dbeafe', '#fce7f3', '#dcfce7', '#fef3c7', '#e0e7ff'];
function pillColor(text: string): string {
	let h = 0;
	for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 997;
	return PILL_COLORS[h % PILL_COLORS.length];
}

/** Whole days since an ISO date ('' when missing/future). */
function daysAgo(value: unknown): string {
	if (isEmptyValue(value)) return '';
	const d = new Date(String(value));
	if (Number.isNaN(d.getTime())) return '';
	const diff = Date.now() - d.getTime();
	if (diff < 0) return '';
	const days = Math.floor(diff / 86_400_000);
	if (days === 0) return 'today';
	return `${days}d`;
}

/** The card layout injected into the board via renderCard. */
function KanbanCardView({
	item,
	config,
	fields,
	displayField,
	onCardClick,
}: KanbanCardRenderProps<RowItem> & {
	config: KanbanViewConfig;
	fields: KanbanFieldLike[];
	displayField: string | null;
}) {
	const row = item.row;
	const byName = new Map(fields.map((f) => [f.name, f]));
	const titleDef = config.titleField ? byName.get(config.titleField) : null;
	const amountDef = config.amountField ? byName.get(config.amountField) : null;
	const assignedDef = config.assignedToField ? byName.get(config.assignedToField) : null;
	const infoDefs = (config.infoFields ?? []).map((n) => byName.get(n)).filter((f): f is KanbanFieldLike => Boolean(f));
	const tagDefs = (config.tagFields ?? []).map((n) => byName.get(n)).filter((f): f is KanbanFieldLike => Boolean(f));

	const title = titleDef ? formatFieldValue(titleDef, row[titleDef.name]) : displayField ? String(row[displayField] ?? '') : '';
	const amount = amountDef ? formatFieldValue(amountDef, row[amountDef.name]) : null;
	const assigned = assignedDef ? relationLabel(row[assignedDef.name]) : '';
	const assignedInitials = assigned && assigned !== '—' ? initialsOf(assigned) : null;

	return (
		<div
			data-slot="kanban-card"
			onClick={() => onCardClick?.(item, item.id)}
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: 6,
				padding: '0.55rem 0.65rem',
				borderRadius: 10,
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				background: 'var(--mmbix-card, #ffffff)',
				boxShadow: '0 1px 2px rgba(16,24,40,.06)',
				cursor: onCardClick ? 'pointer' : 'default',
				transition: 'box-shadow .12s ease',
			}}
		>
			{title ? (
				<span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--mmbix-foreground, #111827)', lineHeight: 1.3 }}>{title}</span>
			) : null}
			{amount ? <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--mmbix-foreground, #111827)' }}>{amount}</span> : null}
			{infoDefs.map((f) => {
				const value = formatFieldValue(f, row[f.name]);
				if (isEmptyValue(value)) return null;
				const Icon = activityIconFor(f.type);
				const age = daysAgo(row[f.name]);
				return (
					<span
						key={f.name}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 5,
							fontSize: '0.7rem',
							color: 'var(--mmbix-muted-foreground, #6b7280)',
							minWidth: 0,
						}}
					>
						{Icon ? <Icon size={11} style={{ flexShrink: 0 }} /> : null}
						<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
						{age ? <span style={{ flexShrink: 0, fontSize: '0.62rem', color: '#9ca3af' }}>{age}</span> : null}
					</span>
				);
			})}
			{tagDefs.length > 0 ? (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
					{tagDefs.flatMap((f) => {
						const raw = row[f.name];
						const values = Array.isArray(raw)
							? raw.map((v) => (typeof v === 'object' ? relationLabel(v) : String(v)))
							: [formatFieldValue(f, raw)];
						return values
							.filter((v) => !isEmptyValue(v))
							.map((v, i) => (
								<span
									key={`${f.name}-${i}`}
									style={{
										fontSize: '0.6rem',
										fontWeight: 600,
										padding: '1px 6px',
										borderRadius: 999,
										color: '#334155',
										background: pillColor(v),
										whiteSpace: 'nowrap',
									}}
								>
									{v}
								</span>
							));
					})}
				</div>
			) : null}
			{assignedInitials ? (
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 }}>
					<Avatar style={{ width: 20, height: 20 }}>
						<AvatarFallback style={{ fontSize: '0.6rem', background: 'var(--mmbix-muted, #f3f4f6)' }}>{assignedInitials}</AvatarFallback>
					</Avatar>
				</div>
			) : null}
		</div>
	);
}

/** Column header — title with the column sum inline ("Contract 3.3 M"). */
function KanbanColumnHeaderView({ column }: KanbanColumnHeaderProps<RowItem> & {}) {
	const meta = (column.meta ?? {}) as { sum?: number | null };
	const sum = meta.sum ?? null;
	return (
		<div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 4px' }}>
			<span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--mmbix-foreground, #111827)', textTransform: 'capitalize' }}>
				{column.title}
			</span>
			{sum !== null ? (
				<span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--mmbix-primary, #2563eb)' }}>{compactNumber(sum)}</span>
			) : null}
		</div>
	);
}

/** Compact number for column sums: 3,300,000 → "3.3 M", 1,170,000,000 → "1.17 B". */
function compactNumber(value: number): string {
	const fmt = (n: number) => parseFloat(n.toFixed(2)).toString();
	const abs = Math.abs(value);
	if (abs >= 1e9) return `${fmt(value / 1e9)} B`;
	if (abs >= 1e6) return `${fmt(value / 1e6)} M`;
	if (abs >= 1e3) return `${fmt(value / 1e3)} K`;
	return fmt(value);
}

export function KanbanBoard({
	config,
	rows,
	fields,
	loading,
	displayField,
	onCreate,
	onOpen,
	onMoveCard,
	emptyLabel = 'No records yet',
}: KanbanBoardProps) {
	const groupDef = fields.find((f) => f.name === config.groupBy) ?? null;
	const options =
		groupDef && groupDef.type === 'select' && Array.isArray(groupDef.options)
			? (groupDef.options as Array<string | { label?: string; value?: string }>).map((o) =>
					typeof o === 'string' ? { label: o, value: o } : o,
				)
			: null;

	const columns = useMemo<KanbanColumnDef<RowItem>[]>(
		() =>
			groupRowsForKanban(rows, config, options).map((col) => ({
				id: col.key,
				title: col.label,
				items: col.rows.map((row) => ({ id: String(row.id), row })),
				meta: { sum: col.sum },
				// Borderless columns — the board relies on the muted column background only.
				className: 'border-0',
			})),
		[rows, config, options],
	);

	const dragEnabled = config.dragEnabled === true && !!onMoveCard;
	const columnWidth = config.columnWidth ? `${config.columnWidth}px` : '18.75rem';

	if (loading && rows.length === 0) {
		return (
			<div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
				{[0, 1, 2, 3].map((i) => (
					<div key={i} style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
						<Skeleton style={{ height: 34, borderRadius: 8 }} />
						<Skeleton style={{ height: 90, borderRadius: 8 }} />
						<Skeleton style={{ height: 90, borderRadius: 8 }} />
					</div>
				))}
			</div>
		);
	}

	if (!config.groupBy) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
					minHeight: 180,
					color: 'var(--mmbix-muted-foreground, #9ca3af)',
					fontSize: '0.8rem',
				}}
			>
				Configure a "Group by" field to build the board.
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
					minHeight: 180,
					color: 'var(--mmbix-muted-foreground, #9ca3af)',
					fontSize: '0.8rem',
				}}
			>
				{emptyLabel}
			</div>
		);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 8 }}>
			{onCreate ? (
				<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
					<Button variant="outline" size="sm" onClick={onCreate} style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
						<Plus size={12} /> New
					</Button>
				</div>
			) : null}
			<DSKanbanBoard<RowItem>
				id="mmbix-kanban"
				columns={columns}
				renderCard={(props) => <KanbanCardView {...props} config={config} fields={fields} displayField={displayField ?? null} />}
				renderColumnHeader={(props) => <KanbanColumnHeaderView {...props} />}
				renderEmptyColumn={({ column }) => (
					<div
						style={{
							border: '1px dashed var(--mmbix-border, #d1d5db)',
							borderRadius: 10,
							padding: '1.25rem 0.5rem',
							textAlign: 'center',
							fontSize: '0.68rem',
							color: '#9ca3af',
						}}
					>
						No {String(column.title).toLowerCase()} cards
					</div>
				)}
				renderBoardHeader={null}
				reorderItems={dragEnabled}
				reorderColumns={false}
				columnWidth={columnWidth}
				onCardClick={(item) => onOpen?.(item.id)}
				onItemMove={(e: KanbanItemMoveEvent<RowItem>) => onMoveCard?.(e.item.id, e.targetColumnId)}
				labels={{ emptyColumn: 'No items', dropHere: 'Drop here' }}
			/>
		</div>
	);
}
