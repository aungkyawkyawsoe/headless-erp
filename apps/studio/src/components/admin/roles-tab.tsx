import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@mmbix/design-system';
import { Check, Minus, Plus, Save, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { createRole, updateRole, getRolePermissions, setPermission, type RolePermission, type RoleRecord } from '../../lib/api';
import { appRequiredCollections } from '../../lib/app-collections';
import { collectionsQuery, modulesQuery, rolesQuery } from '../../lib/queries';
import { invalidateRoles } from '../../lib/query-client';
import {
	FLAG_KEYS,
	FLAG_LABEL,
	columnState,
	columnToggleValue,
	emptyPermission,
	governanceBadges,
	hasGrant,
	isPermDirty,
	matrixStats,
	type FlagKey,
} from '../../lib/role-matrix';

/**
 * Roles & Access — the RBAC admin surface (Studio Admin → Settings → Roles, and
 * the IDP portal → Roles & Access, the SAME component).
 *
 * Layout: a role rail on the left, and for the selected role a governance profile
 * (summary tiles + mini-app board) over a per-collection permission MATRIX on the
 * right. The matrix columns are `_role_permissions` flags; each column header is a
 * tri-state MASTER TOGGLE that acts on the rows the operator has filtered to, and
 * the last column surfaces the row's field-whitelist / row-level rule so a
 * restricted grant is visible at a glance rather than hidden in a panel.
 *
 * Every derivation (summary tiles, column tri-state, dirty diff, governance note)
 * is pure and lives in `lib/role-matrix.ts`; this component only renders it.
 */

const sectionTitle: React.CSSProperties = {
	fontSize: '0.62rem',
	fontWeight: 700,
	textTransform: 'uppercase',
	letterSpacing: '0.07em',
	color: 'var(--mmbix-muted-foreground, #64748b)',
};
const note: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', margin: 0 };
const card: React.CSSProperties = {
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	borderRadius: 12,
	background: 'var(--mmbix-card, #fff)',
	padding: '0.75rem 0.85rem',
	display: 'flex',
	flexDirection: 'column',
	gap: 10,
	boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04), 0 6px 16px rgba(15, 23, 42, 0.03)',
};
const statTile: React.CSSProperties = {
	border: '1px solid var(--mmbix-border, #eef2f6)',
	borderRadius: 10,
	background: 'var(--mmbix-muted, #f8fafc)',
	padding: '0.45rem 0.55rem',
	display: 'flex',
	flexDirection: 'column',
	gap: 1,
	minWidth: 0,
};
const statValue: React.CSSProperties = {
	fontSize: '1.05rem',
	fontWeight: 700,
	lineHeight: 1.1,
	fontVariantNumeric: 'tabular-nums',
	color: 'var(--mmbix-foreground, #0f172a)',
	whiteSpace: 'nowrap',
};
const statLabel: React.CSSProperties = {
	fontSize: '0.58rem',
	fontWeight: 700,
	textTransform: 'uppercase',
	letterSpacing: '0.05em',
	color: 'var(--mmbix-muted-foreground, #94a3b8)',
	whiteSpace: 'nowrap',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
};
const tinyPill: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: 3,
	padding: '1px 7px',
	borderRadius: 999,
	fontSize: '0.6rem',
	fontWeight: 700,
	textTransform: 'uppercase',
	letterSpacing: '0.04em',
	whiteSpace: 'nowrap',
};

/** A governance summary tile — one number with a label. */
function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'warn' | 'good' }) {
	return (
		<div style={statTile}>
			<span
				style={{
					...statValue,
					color:
						tone === 'warn'
							? 'var(--mmbix-tone-warning-fg, #d97706)'
							: tone === 'good'
								? 'var(--mmbix-tone-positive-fg, #059669)'
								: statValue.color,
				}}
			>
				{value}
			</span>
			<span style={statLabel}>{label}</span>
		</div>
	);
}

/** One state inside the current session. */
function RoleRailItem({ role, active, onSelect }: { role: RoleRecord; active: boolean; onSelect: () => void }) {
	return (
		<button
			type="button"
			onClick={onSelect}
			title={role.name}
			aria-current={active ? 'true' : undefined}
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 6,
				width: '100%',
				borderRadius: 8,
				border: active ? '1px solid var(--mmbix-primary, #2563eb)' : '1px solid var(--mmbix-border, #e5e7eb)',
				background: active ? 'color-mix(in srgb, var(--mmbix-primary, #2563eb) 8%, transparent)' : 'var(--mmbix-card, #fff)',
				color: active ? 'var(--mmbix-tone-info-fg, #1d4ed8)' : 'var(--mmbix-foreground, #374151)',
				padding: '0.35rem 0.5rem',
				fontSize: '0.74rem',
				fontWeight: 600,
				cursor: 'pointer',
				textAlign: 'left',
			}}
		>
			<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{role.name}</span>
			{role.is_system === 1 && (
				<span style={{ ...tinyPill, background: 'var(--mmbix-muted, #f1f5f9)', color: 'var(--mmbix-muted-foreground, #64748b)' }}>sys</span>
			)}
		</button>
	);
}

export function RolesTab({ token }: { token: string }) {
	const queryClient = useQueryClient();
	// Roles are one session-level read (`rolesQuery`); the collection library is the
	// same registry list the rest of the Studio already caches. Both mount as cache
	// hits, so opening this tab twice costs zero reads.
	const rolesQ = useQuery(rolesQuery(token));
	const collectionsQ = useQuery(collectionsQuery(token));
	const modulesQ = useQuery(modulesQuery(token));
	const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
	const library = useMemo(() => (collectionsQ.data ?? []).map((c) => c.slug).sort(), [collectionsQ.data]);
	// The app-access board derives from the module registry — no hardcoded list.
	const appCatalog = useMemo(() => (modulesQ.data ?? []).map((m) => ({ id: m.slug, label: m.name })), [modulesQ.data]);
	const [roleId, setRoleId] = useState('');
	const [msg, setMsg] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// Editor drafts for the selected role.
	const [draftDesc, setDraftDesc] = useState<string>('');
	// App board draft: null = every app; otherwise the checked app ids.
	const [draftApps, setDraftApps] = useState<string[] | null>(null);
	const [appsAll, setAppsAll] = useState(true);
	const [permQuery, setPermQuery] = useState('');

	// Per-collection access drafts for the selected role.
	// Key every collection in `library`; existing `_role_permissions` rows seed their
	// flags, unset collections default to no access (deny) so every collection is visible.
	const [permBy, setPermBy] = useState<Record<string, RolePermission>>({});
	// The persisted baseline the drafts are diffed against — what makes "unsaved" real.
	const [permBaseline, setPermBaseline] = useState<Record<string, RolePermission>>({});

	// New-role dialog.
	const [newOpen, setNewOpen] = useState(false);
	const [newName, setNewName] = useState('');
	const [newDesc, setNewDesc] = useState('');

	const syncPerms = useCallback(
		(rid: string, collections: string[]) => {
			getRolePermissions(token, rid)
				.then((rows) => {
					const map: Record<string, RolePermission> = {};
					for (const slug of collections) {
						const found = rows.find((r) => r.collection_slug === slug);
						map[slug] = found ?? emptyPermission(rid, slug);
					}
					setPermBy(map);
					setPermBaseline(map);
				})
				.catch(() => {
					setPermBy({});
					setPermBaseline({});
				});
		},
		[token],
	);

	const load = useCallback(async () => {
		// A role write lands on the shared key; the active query refetches itself.
		await invalidateRoles(queryClient);
	}, [queryClient]);

	const reloadCurrent = useCallback(() => {
		if (roleId) syncPerms(roleId, library);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [roleId, library]);

	// Seed drafts whenever the selected role (or its backing perms) changes.
	useEffect(() => {
		if (!roleId) {
			setDraftDesc('');
			setDraftApps(null);
			setAppsAll(true);
			setPermBy({});
			setPermBaseline({});
			return;
		}
		const target = roles.find((r) => r.id === roleId);
		setDraftDesc(target?.description ?? '');
		const acc = target?.app_access ?? null; // null = every app (raw array if restricted)
		setDraftApps(acc);
		setAppsAll(acc === null);
		if (library.length) syncPerms(roleId, library);
	}, [roleId, roles, library, syncPerms]);

	// Surface a load failure (queries own the request; this only reports it).
	useEffect(() => {
		const err = rolesQ.error ?? collectionsQ.error;
		if (err) setMsg(err instanceof Error ? err.message : 'Failed to load roles');
	}, [rolesQ.error, collectionsQ.error]);

	// Default-select the first role once the registry arrives.
	useEffect(() => {
		if (!roleId && roles.length) setRoleId(roles[0].id);
	}, [roleId, roles]);

	const role = useMemo(() => roles.find((r) => r.id === roleId), [roles, roleId]);

	const toggleApp = (id: string) => {
		if (appsAll) return; // "every app" — no individual toggles
		setDraftApps((prev) => {
			const base = prev === null ? [] : [...prev];
			return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
		});
	};
	const setBoardMode = (nextAll: boolean) => {
		setAppsAll(nextAll);
		if (nextAll) setDraftApps(null);
		// null = every app
		else setDraftApps((prev) => prev ?? []);
	};

	const saveRole = async () => {
		if (!role) return;
		setBusy(true);
		setMsg(null);
		try {
			const apps = appsAll ? null : draftApps;
			await updateRole(token, role.id, { description: draftDesc.trim(), app_access: apps });
			// Gate 2 of app access — ticking an app also grants the per-collection reads
			// it needs, so the role can NEVER hold `app_access` without the reads that
			// make the app usable (see `lib/app-collections.ts`). `null` (every app) has
			// no per-app mapping and is skipped.
			const granted = await ensureAppReadGrants(role.id, appRequiredCollections(apps));
			await load();
			if (granted.length) reloadCurrent();
			setMsg(granted.length ? `Role saved. Read access added for: ${granted.join(', ')}.` : 'Role saved.');
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	const togglePerm = (slug: string, key: FlagKey) => {
		setPermBy((prev) => {
			const cur = prev[slug];
			if (!cur) return prev;
			return { ...prev, [slug]: { ...cur, [key]: !Boolean(cur[key]) } };
		});
	};

	/** Persist an existing per-row field whitelist / row filter as-is (wide open when unset). */
	const forwardFieldRestrictions = (raw?: string | null): string[] | '*' => {
		if (!raw || raw === '*') return '*';
		try {
			const arr = JSON.parse(raw) as unknown;
			return Array.isArray(arr) ? arr : '*';
		} catch {
			return '*';
		}
	};

	/** The full `POST /permissions` body for one collection draft. Omitted flags
	 *  default to false server-side, so every flag is sent explicitly. */
	const permPayload = (rid: string, slug: string, draft: RolePermission) => ({
		role_id: rid,
		collection_slug: slug,
		can_read: Boolean(draft.can_read),
		can_write: Boolean(draft.can_write),
		can_create: Boolean(draft.can_create),
		can_delete: Boolean(draft.can_delete),
		can_approve: Boolean(draft.can_approve),
		can_submit: Boolean(draft.can_submit),
		field_restrictions: forwardFieldRestrictions(draft.field_restrictions),
		row_filters: draft.row_filters ?? null,
	});

	/**
	 * Gate 2 of app access (see `lib/app-collections.ts`): grant `can_read` on every
	 * collection a selected app needs that the role cannot already read. Persists
	 * through the SAME `setPermission` the table uses, so a row's other flags are
	 * preserved. Returns the slugs actually written (for the status message).
	 */
	const ensureAppReadGrants = async (rid: string, slugs: string[]): Promise<string[]> => {
		const written: string[] = [];
		for (const slug of slugs) {
			const draft = permBy[slug];
			if (!draft || draft.can_read) continue; // unknown collection, or already readable
			await setPermission(token, permPayload(rid, slug, { ...draft, can_read: true }));
			written.push(slug);
		}
		return written;
	};

	// POST a single upsert with the FULL six-flag set (omitted flags default to false).
	// An all-off row that was never granted is skipped — nothing to persist.
	const savePerm = async (slug: string) => {
		const rid = role?.id;
		const draft = permBy[slug];
		if (!rid || !draft) return;
		if (!hasGrant(draft)) return; // untouched + deny → no row to write
		setBusy(true);
		setMsg(null);
		try {
			await setPermission(token, permPayload(rid, slug, draft));
			reloadCurrent();
			setMsg(savedMessage(slug, draft));
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	// A row only writes when a flag flips to grant — we never persist a pure all-deny
	// row for a collection that has no grant, and a full deny on a granted row keeps
	// the row (backend has no delete-route; deny = no access).
	function savedMessage(slug: string, draft: RolePermission) {
		if (FLAG_KEYS.some((k) => Boolean(draft[k]))) return `Access saved for ${slug}.`;
		return `Access removed for ${slug} (unchanged → deny). Existing row cleared of grants.`;
	}

	const submitCreate = async () => {
		if (!newName.trim()) return setMsg('Role name is required');
		setBusy(true);
		setMsg(null);
		try {
			const created = await createRole(token, { name: newName.trim(), description: newDesc.trim() || undefined, app_access: null });
			setNewOpen(false);
			setNewName('');
			setNewDesc('');
			await invalidateRoles(queryClient);
			setRoleId(created.id);
			if (library.length) syncPerms(created.id, library);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Create failed');
		} finally {
			setBusy(false);
		}
	};

	const allRows = useMemo(() => {
		const rows = library.map((slug) => permBy[slug]);
		return rows.filter((r): r is RolePermission => Boolean(r));
	}, [library, permBy]);

	const sorted = useMemo(() => {
		// Granted (has at least read or write) first, then the unset list — still alphabetical.
		const granted = allRows.filter(hasGrant);
		const unset = allRows.filter((r) => !hasGrant(r));
		const byName = (arr: RolePermission[]) => [...arr].sort((a, b) => a.collection_slug.localeCompare(b.collection_slug));
		return [...byName(granted), ...byName(unset)];
	}, [allRows]);

	const filtered = useMemo(() => {
		if (!permQuery.trim()) return sorted;
		const q = permQuery.toLowerCase();
		return sorted.filter((r) => r.collection_slug.includes(q));
	}, [sorted, permQuery]);

	// Governance summary + tri-state per flag column, over the rows ON SCREEN so the
	// master toggles and the tiles always agree with the grid.
	const stats = useMemo(() => matrixStats(allRows, permBaseline), [allRows, permBaseline]);
	const colStates = useMemo(
		() => Object.fromEntries(FLAG_KEYS.map((k) => [k, columnState(filtered, k)])) as Record<FlagKey, ReturnType<typeof columnState>>,
		[filtered],
	);

	/** Flip one flag across every row the operator has filtered to. */
	const toggleColumn = (flag: FlagKey) => {
		const value = columnToggleValue(colStates[flag]);
		const slugs = new Set(filtered.map((p) => p.collection_slug));
		setPermBy((prev) => {
			const next = { ...prev };
			for (const slug of slugs) if (next[slug]) next[slug] = { ...next[slug], [flag]: value };
			return next;
		});
	};
	const setFiltered = (patch: Partial<Record<FlagKey, boolean>>) => {
		const slugs = new Set(filtered.map((p) => p.collection_slug));
		setPermBy((prev) => {
			const next = { ...prev };
			for (const slug of slugs) if (next[slug]) next[slug] = { ...next[slug], ...patch };
			return next;
		});
	};

	const thStyle: React.CSSProperties = {
		height: 'auto',
		padding: '0.25rem 0.3rem',
		color: 'var(--mmbix-muted-foreground, #94a3b8)',
		fontWeight: 700,
		fontSize: '0.6rem',
		textTransform: 'uppercase',
		letterSpacing: '0.05em',
		whiteSpace: 'nowrap',
	};

	return (
		<div style={{ display: 'flex', gap: 12, padding: '0.75rem 0.9rem', alignItems: 'flex-start' }}>
			{/* ── Left: role rail ─────────────────────────────── */}
			<aside style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
					<span style={sectionTitle}>Roles</span>
					<span style={{ ...statValue, fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #94a3b8)' }}>{roles.length}</span>
				</div>
				<div style={{ marginTop: 2 }}>
					<Button
						size="sm"
						variant="outline"
						style={{ width: '100%', justifyContent: 'center' }}
						onClick={() => {
							setNewOpen(true);
							setNewName('');
							setNewDesc('');
							setMsg(null);
						}}
					>
						<Plus size={12} /> New role
					</Button>
				</div>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
					{roles.map((r) => (
						<RoleRailItem
							key={r.id}
							role={r}
							active={r.id === roleId}
							onSelect={() => {
								setRoleId(r.id);
								setMsg(null);
							}}
						/>
					))}
				</div>
			</aside>

			{/* ── Right: editor for the selected role ─────────── */}
			<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
				{!role ? (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: 6,
							alignItems: 'center',
							padding: '3rem 0',
							color: 'var(--mmbix-muted-foreground, #9ca3af)',
						}}
					>
						<ShieldCheck size={26} />
						<span style={{ fontSize: '0.74rem' }}>Select a role (or create one) to manage its access.</span>
					</div>
				) : (
					<>
						{/* ── Role profile — identity + governance summary ─────────── */}
						<div style={card}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
								<span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--mmbix-foreground, #0f172a)' }}>{role.name}</span>
								<span
									style={{
										...tinyPill,
										background: 'var(--mmbix-muted, #f1f5f9)',
										color: 'var(--mmbix-muted-foreground, #64748b)',
									}}
								>
									{role.is_system === 1 ? 'System role' : 'Custom role'}
								</span>
								{/* Sync state — the operator sees unsaved work without hunting for it. */}
								{stats.dirty > 0 ? (
									<span
										style={{
											...tinyPill,
											background: 'color-mix(in srgb, var(--mmbix-tone-warning-fg, #d97706) 14%, transparent)',
											color: 'var(--mmbix-tone-warning-fg, #d97706)',
										}}
									>
										<ShieldAlert size={10} /> {stats.dirty} unsaved
									</span>
								) : (
									<span
										style={{
											...tinyPill,
											background: 'color-mix(in srgb, var(--mmbix-tone-positive-fg, #059669) 14%, transparent)',
											color: 'var(--mmbix-tone-positive-fg, #059669)',
										}}
									>
										<Check size={10} /> In sync
									</span>
								)}
								<Button size="sm" style={{ marginLeft: 'auto' }} onClick={() => void saveRole()} disabled={busy}>
									<Save size={12} /> Save role
								</Button>
							</div>

							<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
								<span style={{ ...statLabel, flexShrink: 0 }}>Description</span>
								<Input
									value={draftDesc}
									onChange={(e) => setDraftDesc(e.target.value)}
									placeholder="Purpose / who should hold this role"
									style={{ flex: 1, minWidth: 0 }}
								/>
							</div>

							{/* Governance summary — the tiles that answer "how much access is this?". */}
							<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 6 }}>
								<Stat value={`${stats.granted} / ${stats.total}`} label="Collections granted" />
								<Stat value={stats.flags} label="Flag grants" />
								<Stat value={stats.rowRules} label="Row rules" />
								<Stat value={stats.fieldLocks} label="Field locks" />
								<Stat value={appsAll ? 'All' : (draftApps?.length ?? 0)} label="Apps open" />
							</div>
						</div>

						{/* ── Mini-app board ─────────── */}
						<section style={card}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
								<span style={sectionTitle}>Mini-app board</span>
								<span style={{ ...note, marginLeft: 4, flex: 1 }}>
									Which launcher apps this role opens (null = every app). Ticking an app also grants read on the collections it needs.
								</span>
							</div>
							<label
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 6,
									fontSize: '0.76rem',
									color: 'var(--mmbix-foreground, #374151)',
									cursor: 'pointer',
								}}
							>
								<Checkbox checked={appsAll} onCheckedChange={(v) => setBoardMode(Boolean(v))} />
								<span style={{ fontWeight: 600 }}>Every app (unrestricted board)</span>
							</label>
							{!appsAll && (
								<div
									style={{
										display: 'flex',
										flexWrap: 'wrap',
										gap: 3,
										border: '1px solid var(--mmbix-border, #e5e7eb)',
										borderRadius: 8,
										padding: '0.45rem 0.55rem',
									}}
								>
									{appCatalog.map((a) => {
										const on = draftApps?.includes(a.id) ?? false;
										return (
											<label
												key={a.id}
												style={{
													display: 'inline-flex',
													alignItems: 'center',
													gap: 4,
													padding: '0.15rem 0.4rem',
													borderRadius: 6,
													background: on ? 'color-mix(in srgb, var(--mmbix-primary, #2563eb) 8%, transparent)' : 'transparent',
													fontSize: '0.72rem',
													color: 'var(--mmbix-foreground, #374151)',
													cursor: 'pointer',
												}}
											>
												<Checkbox checked={on} onCheckedChange={() => toggleApp(a.id)} />
												<span>{a.label}</span>
											</label>
										);
									})}
								</div>
							)}
						</section>

						{/* ── Collection permission matrix ─────────── */}
						<section style={card}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
								<span style={sectionTitle}>Collection permissions</span>
								<span style={note}>
									{filtered.length === library.length ? `${library.length} collections` : `${filtered.length} of ${library.length} shown`}
								</span>
								{/* Bulk ops act on exactly the rows on screen. */}
								<div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
									<Button
										size="sm"
										variant="outline"
										title="Grant Read on every shown collection"
										onClick={() => setFiltered({ can_read: true })}
									>
										Read all
									</Button>
									<Button
										size="sm"
										variant="outline"
										title="Clear every flag on every shown collection"
										onClick={() =>
											setFiltered({
												can_read: false,
												can_write: false,
												can_create: false,
												can_delete: false,
												can_approve: false,
												can_submit: false,
											})
										}
									>
										Clear
									</Button>
								</div>
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<Search size={13} style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)' }} />
								<Input
									value={permQuery}
									onChange={(e) => setPermQuery(e.target.value)}
									placeholder="Filter by collection"
									style={{ flex: 1, minWidth: 0 }}
								/>
							</div>

							{filtered.length === 0 ? (
								<p style={note}>{library.length === 0 ? 'Loading collections…' : `No collection matches “${permQuery}”.`}</p>
							) : (
								<div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>
									<Table style={{ width: '100%', fontSize: '0.72rem' }}>
										<TableHeader style={{ position: 'sticky', top: 0, background: 'var(--mmbix-card, #fff)', zIndex: 1 }}>
											<TableRow>
												<TableHead style={{ ...thStyle, textAlign: 'left', padding: '0.25rem 0.4rem' }}>Collection</TableHead>
												{FLAG_KEYS.map((k) => {
													const state = colStates[k];
													const tone =
														state === 'all'
															? 'var(--mmbix-tone-info-fg, #1d4ed8)'
															: state === 'some'
																? 'var(--mmbix-tone-warning-fg, #d97706)'
																: 'var(--mmbix-muted-foreground, #94a3b8)';
													return (
														<TableHead key={k} style={{ ...thStyle, textAlign: 'center' }}>
															{/* Column master toggle — flips this flag across the rows on screen. */}
															<button
																type="button"
																onClick={() => toggleColumn(k)}
																title={`${state === 'all' ? 'Clear' : 'Set'} ${FLAG_LABEL[k]} on all ${filtered.length} shown`}
																style={{
																	display: 'inline-flex',
																	alignItems: 'center',
																	gap: 3,
																	border: 'none',
																	background: 'transparent',
																	padding: 0,
																	cursor: 'pointer',
																	color: tone,
																	fontWeight: 700,
																	fontSize: '0.6rem',
																	textTransform: 'uppercase',
																	letterSpacing: '0.05em',
																}}
															>
																{FLAG_LABEL[k]}
																{state === 'all' ? <Check size={11} /> : state === 'some' ? <Minus size={11} /> : null}
															</button>
														</TableHead>
													);
												})}
												<TableHead style={{ ...thStyle, textAlign: 'left' }}>Attributes &amp; RLS</TableHead>
												<TableHead style={{ ...thStyle, textAlign: 'right' }} />
											</TableRow>
										</TableHeader>
										<TableBody>
											{filtered.map((p) => {
												const hasAny = hasGrant(p);
												const dirty = isPermDirty(p, permBaseline[p.collection_slug]);
												const badges = governanceBadges(p);
												return (
													<TableRow key={p.collection_slug}>
														<TableCell
															style={{
																padding: '0.3rem 0.4rem',
																fontWeight: 600,
																fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
																fontSize: '0.68rem',
																color: hasAny ? 'var(--mmbix-tone-info-fg, #1d4ed8)' : 'var(--mmbix-muted-foreground, #9ca3af)',
																whiteSpace: 'nowrap',
															}}
														>
															{/* A dot marks an unsaved edit on this row. */}
															{dirty && (
																<span
																	title="Unsaved changes"
																	style={{
																		display: 'inline-block',
																		width: 6,
																		height: 6,
																		borderRadius: 999,
																		marginRight: 5,
																		background: 'var(--mmbix-tone-warning-fg, #d97706)',
																		verticalAlign: 'middle',
																	}}
																/>
															)}
															{p.collection_slug}
														</TableCell>
														{FLAG_KEYS.map((k) => (
															<TableCell key={k} style={{ textAlign: 'center', padding: '0.3rem 0.25rem' }}>
																<Checkbox checked={Boolean(p[k])} onCheckedChange={() => togglePerm(p.collection_slug, k)} />
															</TableCell>
														))}
														{/* Governance note — the row's field whitelist / row-level rule. */}
														<TableCell style={{ padding: '0.3rem 0.4rem' }}>
															{badges.length === 0 ? (
																<span style={{ fontSize: '0.62rem', color: 'var(--mmbix-muted-foreground, #cbd5e1)' }}>Unrestricted</span>
															) : (
																<div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
																	{badges.map((b) => (
																		<span
																			key={b}
																			style={{
																				...tinyPill,
																				background: 'color-mix(in srgb, var(--mmbix-tone-info-fg, #1d4ed8) 10%, transparent)',
																				color: 'var(--mmbix-tone-info-fg, #1d4ed8)',
																				textTransform: 'none',
																				letterSpacing: 0,
																			}}
																		>
																			{b}
																		</span>
																	))}
																</div>
															)}
														</TableCell>
														<TableCell style={{ textAlign: 'right', padding: '0.25rem 0.3rem', whiteSpace: 'nowrap' }}>
															<Button
																size="sm"
																variant="outline"
																disabled={busy || !dirty}
																onClick={() => void savePerm(p.collection_slug)}
																title={dirty ? 'Save this collection’s flags' : 'No changes to save'}
															>
																<Save size={12} /> Save
															</Button>
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
									</Table>
								</div>
							)}
						</section>
					</>
				)}

				{msg && (
					<span
						style={{
							fontSize: '0.72rem',
							color:
								msg.includes('failed') || msg.includes('required') || msg.includes('removed')
									? 'var(--mmbix-tone-warning-fg, #d97706)'
									: 'var(--mmbix-tone-positive-fg, #059669)',
						}}
					>
						{msg}
					</span>
				)}
			</div>

			{/* New-role dialog */}
			{newOpen && (
				<div
					style={{
						position: 'fixed',
						inset: 0,
						background: 'rgba(0,0,0,0.35)',
						zIndex: 120,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
					onClick={() => setNewOpen(false)}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							background: 'var(--mmbix-card, #fff)',
							borderRadius: 12,
							padding: '0.9rem',
							width: 340,
							display: 'flex',
							flexDirection: 'column',
							gap: 8,
							boxShadow: '0 18px 50px rgba(0,0,0,0.25)',
						}}
					>
						<span style={{ fontSize: '0.82rem', fontWeight: 700 }}>New role</span>
						<Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Role name — e.g. Storekeeper" />
						<Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)" />
						<p style={{ ...note, marginTop: -2 }}>
							New roles default to opening every app. Tune the board + collection access after creating.
						</p>
						<div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
							<Button variant="outline" size="sm" onClick={() => setNewOpen(false)}>
								Cancel
							</Button>
							<Button size="sm" onClick={() => void submitCreate()} disabled={busy || !newName.trim()}>
								<Plus size={12} /> Create
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
