/**
 * Card grid renderer — the single source of truth for how a collection's
 * records render as cards (schema_json.card_view — preview == runtime). Used by
 * the Studio's card editor canvas (live preview) and the admin frontend's
 * collection list (EntityCardGrid) so both produce identical output.
 *
 * Two layouts:
 *  - 'hero' (default): image band on top, details below.
 *  - 'row': photo sidebar on the left (status dot + bottom overlay), details on
 *    the right — directory-card style (e.g. employee cards).
 */
import { useMemo, useState, type ReactNode, type ReactElement } from 'react';
import { Card, CardContent, CardTitle } from '@mmbix/design-system';
import { Plus } from 'lucide-react';
import { cardFieldsOf, type CardFieldMeta, type CardViewConfig } from './card-view';
import { formatFieldValue, type FieldSelectOption } from './field-format';

/** Minimal row shape — a record with an id plus arbitrary field values. */
export interface CardRowLike {
	id?: string | number;
	[key: string]: unknown;
}

/** Minimal field shape accepted by the card renderer (superset of FieldDef). */
export interface CardFieldLike {
	name: string;
	type: string;
	label?: string;
	display_template?: string | null;
	/** Select-field options (plain strings or {value, label}) — display the label in card text. */
	options?: FieldSelectOption[] | null;
}

export interface CardViewGridProps {
	rows: CardRowLike[];
	fields: CardFieldLike[];
	cv: CardViewConfig;
	/** Open a record (navigate to its edit form). Card becomes clickable when provided. */
	onOpen?: (id: string) => void;
	/** Optional action rendered in each card's header row (e.g. an open button). */
	headerAction?: (id: string) => ReactNode;
	/** Studio-only: hover "+" over the photo opens the image-field picker (anchor = the button). */
	onPickImage?: (id: string, anchor: HTMLElement) => void;
}

/** File values arrive as URL strings — render them as the card image. */
function imageUrlOf(value: unknown): string | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	return value.trim();
}

/** Uncurated cards cap at this many fields (mirrors the table's DEFAULT_LIST_COLUMNS). */
export const DEFAULT_CARD_FIELDS = 6;

/** Ordered, visible info fields for a card config.
 *  Mirrors the table's curation rule: when the Studio configured a field list,
 *  ONLY those fields render; without a curated list, the first
 *  DEFAULT_CARD_FIELDS user fields show (no 40-field dump).
 *
 *  NOTE: cardFieldsOf appends every unconfigured field as "visible" — curated
 *  mode must drop them by checking membership in the configured names, otherwise
 *  `visible !== false` keeps them all (undefined !== false is true). */
export function cardVisibleFields(cv: CardViewConfig, fields: CardFieldLike[]): CardFieldMeta[] {
	const all = cardFieldsOf(cv, fields);
	const curated = (cv?.fields?.length ?? 0) > 0;
	if (!curated) return all.slice(0, DEFAULT_CARD_FIELDS);
	const names = new Set((cv.fields ?? []).map((f) => f.name));
	return all.filter((f) => names.has(f.name) && f.visible !== false);
}

/** Resolve the card's title field (configured, else first visible) and image field. */
export function cardTitleAndImage(
	cv: CardViewConfig,
	fields: CardFieldLike[],
	visible: CardFieldMeta[],
): { title: string | null; image: string | null } {
	const byName = new Set(fields.map((f) => f.name));
	const title = cv.titleField && byName.has(cv.titleField) ? cv.titleField : (visible[0]?.name ?? null);
	const image = cv.imageField && byName.has(cv.imageField) ? cv.imageField : null;
	return { title, image };
}

/** Initials for the photo placeholder — first letters of the first two words. */
function initialsOf(value: unknown): string {
	const s = String(value ?? '').trim();
	if (!s) return '?';
	return s
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w[0])
		.join('')
		.toUpperCase();
}

/** Tiny SVG icon for a field type (row-layout info rows). Returns null for generic types. */
function fieldTypeIcon(type: string): ReactElement | null {
	switch (type) {
		case 'date':
		case 'datetime':
		case 'timestamp':
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
					<line x1="16" y1="2" x2="16" y2="6" />
					<line x1="8" y1="2" x2="8" y2="6" />
					<line x1="3" y1="10" x2="21" y2="10" />
				</svg>
			);
		case 'phone':
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.58 3.42 2 2 0 0 1 3.56 1.25h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.79a16 16 0 0 0 5.55 5.55l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z" />
				</svg>
			);
		case 'email':
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
					<polyline points="22,6 12,13 2,6" />
				</svg>
			);
		case 'url':
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
					<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
				</svg>
			);
		case 'location':
			return (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
					<circle cx="12" cy="10" r="3" />
				</svg>
			);
		default:
			return null;
	}
}

/** Status dot color — truthy boolean / "active"-ish select value → green, else muted.
 *  NOTE: no HR-specific values ('permanent' is an employment status, not a
 *  generic truthy status) — a `products` collection must not light up green
 *  for an unrelated select value. */
function statusColor(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	const truthy =
		value === true ||
		value === 1 ||
		value === '1' ||
		(typeof value === 'string' && ['active', 'yes', 'true', 'on'].includes(value.toLowerCase()));
	return truthy ? 'var(--mmbix-status-success, #10b981)' : 'var(--mmbix-status-muted, #9ca3af)';
}

/** Plain count for counter boxes — arrays → length, numbers → value, else '—'. */
function countOf(value: unknown): string {
	if (Array.isArray(value)) return String(value.length);
	if (typeof value === 'number') return String(value);
	if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return String(Number(value));
	return '—';
}

/** Counter box colors — green, orange, red (reference directory-card style). */
const COUNTER_COLORS = [
	{ bg: '#e8f5e9', fg: '#2e7d32' },
	{ bg: '#fff3e0', fg: '#e65100' },
	{ bg: '#fdecea', fg: '#c62828' },
];

/** Badge text — gender selects map to their symbols (♂/♀) ONLY when the badge
 *  field is gender-ish (field-name opt-in), so a `products` collection never
 *  renders gender glyphs for an arbitrary select value. */
function badgeText(value: unknown, field?: string): string {
	const isGender = field ? /gender|sex/i.test(field) : false;
	if (isGender) {
		const s = String(value ?? '')
			.trim()
			.toLowerCase();
		if (s === 'male') return '♂';
		if (s === 'female') return '♀';
	}
	return String(value ?? '');
}

/** Compact tenure text — only meaningful for start/join dates (e.g. "1y 2m 6d"). */
function tenureText(d: Date): string {
	const now = new Date();
	if (d > now) return '';
	let years = now.getFullYear() - d.getFullYear();
	let months = now.getMonth() - d.getMonth();
	let days = now.getDate() - d.getDate();
	if (days < 0) {
		months--;
		days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
	}
	if (months < 0) {
		years--;
		months += 12;
	}
	if (years > 0) return `${years}y ${months}m ${days}d`;
	if (months > 0) return `${months}m ${days}d`;
	return `${Math.max(0, days)}d`;
}

/** Date-line value — plain locale date for generic fields; a start/join-ish
 *  field (name opt-in) additionally gets the tenure prefix, e.g. "1y 3d  (Aug 4, 2025)". */
function dateLine(value: unknown, field?: string): string {
	const d = new Date(String(value));
	if (Number.isNaN(d.getTime())) return String(value ?? '');
	const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	if (!field || !/join|hire|start|since|tenure|entry/i.test(field)) return date;
	const tenure = tenureText(d);
	return tenure ? `${tenure}  (${date})` : date;
}

/** Age in years from a date-of-birth value (for the badge). */
function ageOf(value: unknown): string {
	const d = new Date(String(value));
	if (Number.isNaN(d.getTime()) || d > new Date()) return '';
	const now = new Date();
	let age = now.getFullYear() - d.getFullYear();
	const m = now.getMonth() - d.getMonth();
	if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
	return String(Math.max(0, age));
}

/** Studio-only hover "+" over the card photo — opens the image-field picker. */
function PickImageButton({ visible, onPick }: { visible: boolean; onPick: (anchor: HTMLElement) => void }) {
	return (
		<button
			type="button"
			title="Pick image field"
			aria-label="Pick image field"
			onClick={(e) => {
				e.stopPropagation();
				onPick(e.currentTarget);
			}}
			style={{
				position: 'absolute',
				bottom: 6,
				right: 6,
				zIndex: 3,
				width: 22,
				height: 22,
				padding: 0,
				borderRadius: 999,
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				border: '1px solid rgba(255,255,255,0.55)',
				background: 'rgba(15,23,42,0.6)',
				color: '#fff',
				cursor: 'pointer',
				opacity: visible ? 1 : 0,
				transition: 'opacity 0.12s',
			}}
		>
			<Plus size={12} />
		</button>
	);
}

/** Render one record as a design-system Card per its card config layout. */
function CardItem({
	row,
	byName,
	cv,
	visible,
	onOpen,
	headerAction,
	onPickImage,
}: {
	row: CardRowLike;
	byName: Map<string, CardFieldLike>;
	cv: CardViewConfig;
	visible: CardFieldMeta[];
	onOpen?: (id: string) => void;
	headerAction?: (id: string) => ReactNode;
	onPickImage?: (id: string, anchor: HTMLElement) => void;
}) {
	const [photoHover, setPhotoHover] = useState(false);
	const { title, image } = cardTitleAndImage(cv, [...byName.values()], visible);
	// Info rows = visible fields minus the title, hero and every specialized role
	// field (badge/accent/subtitle/footer/counter all render in their own slots).
	const reserved = new Set(
		[title, image, cv.badgeField, cv.accentField, cv.subtitleField, ...(cv.footerFields ?? []), ...(cv.counterFields ?? [])].filter(
			Boolean,
		),
	);
	const info = visible.filter((f) => !reserved.has(f.name));
	const id = String(row.id ?? '');
	const titleDef = title ? byName.get(title) : null;

	if (cv.layout === 'row') {
		// ── Row layout: photo sidebar (status dot + bottom overlay) + details. ──
		const hero = image ? imageUrlOf(row[image]) : null;
		const status = cv.statusField && byName.has(cv.statusField) ? statusColor(row[cv.statusField]) : null;
		const overlays = (cv.overlayFields ?? [])
			.slice(0, 2)
			.map((name) => {
				const def = byName.get(name);
				return def ? formatFieldValue(def, row[name]) : null;
			})
			.filter((v): v is string => v !== null && v !== '—');
		// Specialized field roles (badge pill, teal accent, subtitle, footer pills, counters).
		const badgeDef = cv.badgeField && byName.has(cv.badgeField) ? byName.get(cv.badgeField) : null;
		const accentDef = cv.accentField && byName.has(cv.accentField) ? byName.get(cv.accentField) : null;
		const subtitleDef = cv.subtitleField && byName.has(cv.subtitleField) ? byName.get(cv.subtitleField) : null;
		const footerDefs = (cv.footerFields ?? [])
			.slice(0, 3)
			.map((name) => ({ name, def: byName.get(name) }))
			.filter((x): x is { name: string; def: CardFieldLike } => !!x.def);
		const counters = (cv.counterFields ?? [])
			.slice(0, 3)
			.map((name) => byName.get(name))
			.filter((d): d is CardFieldLike => !!d);
		const reserved = new Set(
			[
				title,
				image,
				cv.badgeField,
				cv.accentField,
				cv.subtitleField,
				cv.ageField,
				...(cv.footerFields ?? []),
				...(cv.counterFields ?? []),
			].filter(Boolean),
		);
		const info = visible.filter((f) => !reserved.has(f.name));
		return (
			<Card
				key={id}
				size="sm"
				className={onOpen ? 'cursor-pointer transition-shadow hover:shadow-md' : undefined}
				onClick={onOpen ? () => onOpen(id) : undefined}
				title={onOpen ? 'Open record' : undefined}
				style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: '10rem', padding: 0 }}
			>
				<div
					style={{
						width: 112,
						flexShrink: 0,
						display: 'flex',
						flexDirection: 'column',
						alignSelf: 'stretch',
						minWidth: 0,
					}}
				>
					{/* Photo area — image/initials + status dot. */}
					<div
						style={{
							position: 'relative',
							flex: 1,
							minHeight: 0,
							overflow: 'hidden',
							background: 'linear-gradient(180deg, rgba(20,184,166,0.22), rgba(59,130,246,0.12))',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
						}}
					>
						{hero ? (
							<img
								src={hero}
								alt=""
								style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
								onError={(e) => {
									(e.currentTarget as HTMLImageElement).style.display = 'none';
								}}
							/>
						) : (
							<span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'rgba(15,23,42,0.45)' }}>
								{initialsOf(titleDef ? row[title as string] : id)}
							</span>
						)}
						{status ? (
							<span
								title="Status"
								style={{
									position: 'absolute',
									top: 8,
									left: 8,
									width: 10,
									height: 10,
									borderRadius: 999,
									border: '2px solid var(--mmbix-card, #ffffff)',
									background: status,
									zIndex: 2,
								}}
							/>
						) : null}
					</div>
					{/* Employee-ID block — plain band under the photo (overlayFields): employee
					    code + small label. Hovering the band fades the text and overlays a "+"
					    that opens the photo picker (studio + frontend wire onPickImage). The text
					    keeps its space (visibility, not removal) so the band height never changes. */}
					{overlays.length > 0 ? (
						<div
							style={{
								position: 'relative',
								background: 'rgba(15,23,42,0.78)',
								padding: '0.35rem 0.45rem',
								display: 'flex',
								flexDirection: 'column',
								gap: 1,
								...(onPickImage ? { cursor: 'pointer' } : {}),
							}}
							onMouseEnter={onPickImage ? () => setPhotoHover(true) : undefined}
							onMouseLeave={onPickImage ? () => setPhotoHover(false) : undefined}
						>
							{overlays.map((v, i) => (
								<span
									key={i}
									style={{
										fontSize: i === 0 ? '0.72rem' : '0.6rem',
										fontWeight: 700,
										lineHeight: 1.35,
										color: i === 0 ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.7)',
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										visibility: onPickImage && photoHover ? 'hidden' : 'visible',
									}}
								>
									{v}
								</span>
							))}
							{onPickImage && photoHover ? (
								<button
									type="button"
									title="Pick image"
									aria-label="Pick image field"
									onClick={(e) => {
										e.stopPropagation();
										onPickImage(id, e.currentTarget);
									}}
									style={{
										position: 'absolute',
										top: 0,
										bottom: 0,
										left: 0,
										right: 0,
										margin: 'auto',
										width: 28,
										height: 28,
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										padding: 0,
										border: 'none',
										background: 'transparent',
										color: '#fff',
										cursor: 'pointer',
									}}
								>
									<Plus size={14} />
								</button>
							) : null}
						</div>
					) : null}
				</div>
				<CardContent style={{ flex: 1, minWidth: 0, padding: '0.65rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					{/* Header — title + blue badge pill + optional open action. */}
					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<CardTitle
							style={{
								flex: 1,
								minWidth: 0,
								fontSize: '0.92rem',
								fontWeight: 600,
								margin: 0,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
						>
							{titleDef ? formatFieldValue(titleDef, row[title as string]) : `Record ${id}`}
						</CardTitle>
						{badgeDef ? (
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
								{badgeText(row[cv.badgeField as string], cv.badgeField)}
								{cv.ageField && byName.has(cv.ageField) && ageOf(row[cv.ageField as string]) ? ` ${ageOf(row[cv.ageField as string])}` : ''}
							</span>
						) : null}
						{headerAction ? headerAction(id) : null}
					</div>
					{/* Sub-header — teal accent line (e.g. designation) + muted subtitle (e.g. department). */}
					{accentDef ? (
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
							{formatFieldValue(accentDef, row[cv.accentField as string])}
						</span>
					) : null}
					{subtitleDef ? (
						<span
							style={{
								fontSize: '0.74rem',
								fontWeight: 400,
								color: 'var(--mmbix-muted-foreground, #6c757d)',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
						>
							{formatFieldValue(subtitleDef, row[cv.subtitleField as string])}
						</span>
					) : null}
					{/* Info rows — row layout: icon + value on one line (dates get tenure + date). */}
					{info.map((f) => {
						const def = byName.get(f.name);
						if (!def) return null;
						const icon = fieldTypeIcon(def.type);
						const value =
							def.type === 'date' || def.type === 'datetime' || def.type === 'timestamp'
								? dateLine(row[f.name], f.name)
								: formatFieldValue(def, row[f.name]);
						return (
							<div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0 }}>
								{icon ? (
									<span
										style={{ flexShrink: 0, color: 'var(--mmbix-muted-foreground, #9ca3af)', display: 'inline-flex', alignItems: 'center' }}
										aria-hidden="true"
									>
										{icon}
									</span>
								) : null}
								<span style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
							</div>
						);
					})}
					{/* Footer — plain-text footer fields (no badge pills) + colored counters, pinned to the bottom. */}
					{(footerDefs.length > 0 || counters.length > 0) && (
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
							<div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
								{footerDefs.map(({ name, def }, i) => (
									<span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
										{i > 0 ? <span style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>·</span> : null}
										<span
											style={{
												fontSize: '0.72rem',
												fontWeight: 500,
												color: 'var(--mmbix-muted-foreground, #6b7280)',
												whiteSpace: 'nowrap',
												overflow: 'hidden',
												textOverflow: 'ellipsis',
											}}
										>
											{formatFieldValue(def, row[name])}
										</span>
									</span>
								))}
							</div>
							{counters.length > 0 ? (
								<div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
									{counters.map((def, i) => (
										<span
											key={def.name}
											title={def.label || def.name}
											style={{
												minWidth: 20,
												height: 20,
												padding: '0 4px',
												borderRadius: 4,
												display: 'inline-flex',
												alignItems: 'center',
												justifyContent: 'center',
												fontSize: '0.64rem',
												fontWeight: 700,
												color: COUNTER_COLORS[i].fg,
												background: COUNTER_COLORS[i].bg,
											}}
										>
											{countOf(row[def.name])}
										</span>
									))}
								</div>
							) : null}
						</div>
					)}
				</CardContent>
			</Card>
		);
	}

	// ── Hero layout (default): image band on top, details below. ──
	const hero = image ? imageUrlOf(row[image]) : null;
	return (
		<Card
			key={id}
			size="sm"
			className={onOpen ? 'cursor-pointer transition-shadow hover:shadow-md' : undefined}
			onClick={onOpen ? () => onOpen(id) : undefined}
			title={onOpen ? 'Open record' : undefined}
		>
			{hero ? (
				<div style={{ position: 'relative' }} onMouseEnter={() => setPhotoHover(true)} onMouseLeave={() => setPhotoHover(false)}>
					<img
						src={hero}
						alt=""
						style={{
							height: 130,
							width: '100%',
							objectFit: 'cover',
							borderTopLeftRadius: 'var(--radius, 0.5rem)',
							borderTopRightRadius: 'var(--radius, 0.5rem)',
							display: 'block',
						}}
						onError={(e) => {
							(e.currentTarget as HTMLImageElement).style.display = 'none';
						}}
					/>
					{onPickImage ? <PickImageButton visible={photoHover} onPick={(anchor) => onPickImage(id, anchor)} /> : null}
				</div>
			) : null}
			<CardContent style={{ padding: '0.7rem 0.8rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
					<CardTitle
						style={{
							flex: 1,
							minWidth: 0,
							fontSize: '0.9rem',
							fontWeight: 600,
							margin: 0,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{titleDef ? formatFieldValue(titleDef, row[title as string]) : `Record ${id}`}
					</CardTitle>
					{headerAction ? headerAction(id) : null}
				</div>
				{info.map((f) => {
					const def = byName.get(f.name);
					if (!def) return null;
					return (
						<div key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
							<span
								style={{
									fontSize: '0.62rem',
									textTransform: 'uppercase',
									letterSpacing: 0.4,
									color: 'var(--mmbix-muted-foreground, #9ca3af)',
								}}
							>
								{f.label || def.label || f.name}
							</span>
							<span style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{formatFieldValue(def, row[f.name])}
							</span>
						</div>
					);
				})}
			</CardContent>
		</Card>
	);
}

/** Render a collection's records as a responsive card grid per its card config. */
export function CardViewGrid({ rows, fields, cv, onOpen, headerAction, onPickImage }: CardViewGridProps) {
	const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);
	const visible = useMemo(() => cardVisibleFields(cv, fields), [cv, fields]);

	const columns = cv.columns ?? 3;
	// Honor the configured column count EXACTLY (a fixed repeat — auto-fill would
	// recompute columns from the viewport and ignore the Studio's `columns`).
	const gridColumns = columns === 1 ? '1fr' : `repeat(${columns}, minmax(0, 1fr))`;

	return (
		<div className="grid gap-3" style={{ gridTemplateColumns: gridColumns, alignContent: 'start' }}>
			{rows.map((row) => (
				<CardItem
					key={String(row.id ?? '')}
					row={row}
					byName={byName}
					cv={cv}
					visible={visible}
					onOpen={onOpen}
					headerAction={headerAction}
					onPickImage={onPickImage}
				/>
			))}
		</div>
	);
}
