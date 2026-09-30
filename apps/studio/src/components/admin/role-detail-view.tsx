import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input, Textarea, ToggleGroup, ToggleGroupItem } from '@mmbix/design-system';
import { DataTable } from '@mmbix/design-system/datatable';
import { Check, ChevronRight, Database, LayoutGrid, Minus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { createRole, updateRole, deleteRole, getRolePermissions, setPermission, type RolePermission, type RoleRecord } from '../../lib/api';
import { appRequiredCollections } from '../../lib/app-collections';
import { collectionsQuery, modulesQuery, usersQuery } from '../../lib/queries';
import { invalidateRoles } from '../../lib/query-client';
import { qk } from '../../lib/query-keys';
import {
	FLAG_KEYS,
	FLAG_LABEL,
	columnState,
	columnToggleValue,
	dirtyCount,
	emptyPermission,
	governanceBadges,
	hasGrant,
	isPermDirty,
	sameBoard,
	triState,
	type ColumnState,
	type FlagKey,
} from '../../lib/role-matrix';

/**
 * One role, two forms — the split mirrors Directus, where a ROLE is the identity
 * (name, icon, the users who hold it) and its POLICIES are the permissions.
 *
 *   • mode="role"   — the role profile: identity fields + the users in the role.
 *                     Rendered by the IDP User Roles page and Studio Admin.
 *   • mode="policy" — the permission configuration for the same role: the
 *                     collection flag matrix + the app board. Rendered by the
 *                     IDP Access Policies page.
 *
 * The two modes never render the same fields; what makes them one component is
 * that they edit ONE `_roles` row (this engine holds a role's grants on the role
 * itself), so the invalidation and the write paths cannot drift apart.
 */
export type RoleDetailMode = 'role' | 'policy';

const sectionTitle: React.CSSProperties = {
	fontSize: '0.62rem',
	fontWeight: 700,
	textTransform: 'uppercase',
	letterSpacing: '0.07em',
	color: 'var(--mmbix-muted-foreground, #64748b)',
};
const note: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', margin: 0 };
/** The Users-in-Role table's ONE grid — the header row and every body row share
 *  it, so Name and Email hold their columns; email gets the wider half. */
const usersGrid: React.CSSProperties = {
	display: 'grid',
	gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)',
	columnGap: 16,
	alignItems: 'center',
};
const tableSurface: React.CSSProperties = {
	borderRadius: 10,
	overflow: 'hidden',
	background: 'var(--mmbix-card, #fff)',
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
const mono: React.CSSProperties = {
	fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
	fontSize: '0.68rem',
};

function unsavedMark(n: number) {
	if (n <= 0) return null;
	return (
		<span style={{ ...note, color: 'var(--mmbix-tone-warning-fg, #d97706)' }} title="Unsaved changes">
			{n} unsaved
		</span>
	);
}

function saveSummary(rows: number, board: boolean, granted: string[], failed: string[]): string {
	const wrote: string[] = [];
	if (rows) wrote.push(rows === 1 ? '1 collection row' : `${rows} collection rows`);
	if (board) wrote.push('the app board');
	const saved = wrote.length ? `Saved ${wrote.join(' + ')}.` : 'Nothing to save.';
	const grants = granted.length ? ` Read access added for: ${granted.join(', ')}.` : '';
	const errors = failed.length ? ` ${failed.length} failed: ${failed.join(', ')}.` : '';
	return `${saved}${grants}${errors}`;
}

function stateTone(state: ColumnState): string {
	if (state === 'all') return 'var(--mmbix-tone-info-fg, #1d4ed8)';
	if (state === 'some') return 'var(--mmbix-tone-warning-fg, #d97706)';
	return 'var(--mmbix-muted-foreground, #94a3b8)';
}

function ColumnToggle({
	label,
	state,
	title,
	style,
	onClick,
}: {
	label: string;
	state: ColumnState;
	title: string;
	style?: React.CSSProperties;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 3,
				border: 'none',
				background: 'transparent',
				padding: 0,
				cursor: 'pointer',
				color: stateTone(state),
				fontWeight: 700,
				fontSize: '0.6rem',
				textTransform: 'uppercase',
				letterSpacing: '0.05em',
				...style,
			}}
		>
			{label}
			{state === 'all' ? <Check size={11} /> : state === 'some' ? <Minus size={11} /> : null}
		</button>
	);
}

export function RoleDetailView({
	token,
	role,
	mode = 'role',
	onBack,
	onDelete,
	onCreated,
	onOpenPermissions,
}: {
	token: string;
	role: RoleRecord;
	mode?: RoleDetailMode;
	onBack: () => void;
	onDelete: (id: string) => void;
	/** A freshly created role's id — the host re-points its selection at it. */
	onCreated?: (id: string) => void;
	/** Given by the portal's User Roles page: opens this role's Access Policies form. */
	onOpenPermissions?: () => void;
}) {
	const queryClient = useQueryClient();
	const isPolicy = mode === 'policy';
	const isNew = !role.id;

	const [name, setName] = useState(role.name);
	const [description, setDescription] = useState(role.description ?? '');

	const collectionsQ = useQuery(collectionsQuery(token));
	const modulesQ = useQuery(modulesQuery(token));
	const library = useMemo(() => (collectionsQ.data ?? []).map((c) => c.slug).sort(), [collectionsQ.data]);
	const appCatalog = useMemo(() => (modulesQ.data ?? []).map((m) => ({ id: m.slug, label: m.name })), [modulesQ.data]);

	// The users in the role — derived from the ONE users read every surface shares
	// (the old per-role count query re-fetched the whole list once per role).
	const usersQ = useQuery(usersQuery(token));
	const members = useMemo(() => (usersQ.data ?? []).filter((u) => u.role_id === role.id), [usersQ.data, role.id]);

	const [msg, setMsg] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const [draftApps, setDraftApps] = useState<string[] | null>(null);
	const [appsAll, setAppsAll] = useState(true);
	const [view, setView] = useState<'collections' | 'apps'>('collections');
	const [permQuery, setPermQuery] = useState('');
	const [appQuery, setAppQuery] = useState('');

	const [permBy, setPermBy] = useState<Record<string, RolePermission>>({});
	const [permBaseline, setPermBaseline] = useState<Record<string, RolePermission>>({});

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

	useEffect(() => {
		if (!role.id) {
			setDraftApps(null);
			setAppsAll(true);
			setPermBy({});
			setPermBaseline({});
			return;
		}
		const acc = role.app_access ?? null;
		setDraftApps(acc);
		setAppsAll(acc === null);
		// The profile mode never renders the matrix, so it never reads it either.
		if (isPolicy && library.length) syncPerms(role.id, library);
	}, [role.id, role.app_access, library, syncPerms, isPolicy]);

	const dirtyRows = useMemo(() => dirtyCount(Object.values(permBy), permBaseline), [permBy, permBaseline]);
	const boardDirty = useMemo(() => !sameBoard(appsAll ? null : draftApps, role.app_access ?? null), [appsAll, draftApps, role.app_access]);
	const pendingCount = dirtyRows + (boardDirty ? 1 : 0);

	// The profile mode's dirty rule: a new role needs a name; an existing one
	// differs from the persisted name or description. Compared TRIMMED, the way
	// the save sends them — a whitespace-only edit is not a change, so the Save
	// never wakes for a patch that would carry nothing.
	const identityDirty = isNew ? name.trim().length > 0 : name.trim() !== role.name || description.trim() !== (role.description ?? '');
	const canSave = isPolicy ? pendingCount > 0 : identityDirty;

	const allRows = useMemo(() => {
		const rows = library.map((slug) => permBy[slug]);
		return rows.filter((r): r is RolePermission => Boolean(r));
	}, [library, permBy]);

	const sorted = useMemo(() => {
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

	const colStates = useMemo(
		() => Object.fromEntries(FLAG_KEYS.map((k) => [k, columnState(filtered, k)])) as Record<FlagKey, ColumnState>,
		[filtered],
	);

	const togglePerm = (slug: string, key: FlagKey) => {
		setPermBy((prev) => {
			const cur = prev[slug];
			if (!cur) return prev;
			return { ...prev, [slug]: { ...cur, [key]: !Boolean(cur[key]) } };
		});
	};

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

	const forwardFieldRestrictions = (raw?: string | null): string[] | '*' => {
		if (!raw || raw === '*') return '*';
		try {
			const arr = JSON.parse(raw) as unknown;
			return Array.isArray(arr) ? arr : '*';
		} catch {
			return '*';
		}
	};

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

	const ensureAppReadGrants = async (rid: string, slugs: string[]): Promise<string[]> => {
		const written: string[] = [];
		for (const slug of slugs) {
			const draft = permBy[slug];
			if (!draft || draft.can_read) continue;
			await setPermission(token, permPayload(rid, slug, { ...draft, can_read: true }));
			written.push(slug);
		}
		return written;
	};

	/**
	 * A role write changes the `hrm_employees.role` select server-side — drop
	 * the directory schema so the employee form's Role options reflect the
	 * registry on its next render.
	 */
	const refreshDirectoryRoleOptions = async () => {
		await queryClient.invalidateQueries({ queryKey: qk.collections() });
		await queryClient.invalidateQueries({ queryKey: qk.collection('hrm_employees') });
	};

	/** Delete the role — refused server-side while accounts/employees still
	 *  reference it, so the operator gets the server's own reason. */
	const removeRole = async () => {
		if (!window.confirm(`Delete role “${role.name}”? Accounts and employees must be reassigned first.`)) return;
		setBusy(true);
		setMsg(null);
		try {
			await deleteRole(token, role.id);
			await invalidateRoles(queryClient);
			await refreshDirectoryRoleOptions();
			onDelete(role.id);
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Delete failed');
		} finally {
			setBusy(false);
		}
	};

	const saveAll = async () => {
		setBusy(true);
		setMsg(null);
		const failed: string[] = [];
		let rows = 0;
		try {
			if (isNew) {
				const created = await createRole(token, {
					name: name.trim(),
					description: description.trim() || undefined,
					app_access: null,
				});
				await invalidateRoles(queryClient);
				await refreshDirectoryRoleOptions();
				setMsg('Role created.');
				onCreated?.(created.id);
				return;
			}

			if (!isPolicy) {
				const nextName = name.trim();
				if (!nextName) {
					setMsg('Role name is required');
					return;
				}
				const renamed = nextName !== role.name;
				const nextDescription = description.trim();
				const descriptionChanged = nextDescription !== (role.description ?? '');
				// Only the fields that actually changed travel — an identical re-send
				// would touch `updated_at`, which every cached authz lookup keys off.
				await updateRole(token, role.id, {
					...(renamed ? { name: nextName } : {}),
					...(descriptionChanged ? { description: nextDescription } : {}),
				});
				await invalidateRoles(queryClient);
				if (renamed) await refreshDirectoryRoleOptions();
				setMsg(renamed ? `Role renamed to “${nextName}”.` : 'Saved the role profile.');
				return;
			}

			for (const draft of allRows.filter((p) => isPermDirty(p, permBaseline[p.collection_slug]))) {
				try {
					await setPermission(token, permPayload(role.id, draft.collection_slug, draft));
					rows++;
				} catch {
					failed.push(draft.collection_slug);
				}
			}

			let granted: string[] = [];
			if (boardDirty) {
				const apps = appsAll ? null : draftApps;
				await updateRole(token, role.id, { app_access: apps });
				granted = await ensureAppReadGrants(role.id, appRequiredCollections(apps));
			}

			await invalidateRoles(queryClient);
			setMsg(saveSummary(rows, boardDirty, granted, failed));
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	const appRows = useMemo(() => {
		const q = appQuery.trim().toLowerCase();
		if (!q) return appCatalog;
		return appCatalog.filter((a) => a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
	}, [appCatalog, appQuery]);

	const openColState = useMemo(
		() => triState(appRows.map((a) => appsAll || (draftApps?.includes(a.id) ?? false))),
		[appRows, appsAll, draftApps],
	);

	const toggleAppRow = (id: string) => {
		const base = draftApps ?? appCatalog.map((a) => a.id);
		setAppsAll(false);
		setDraftApps(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
	};

	const toggleOpenColumn = () => {
		const on = columnToggleValue(openColState);
		if (on && !appQuery.trim()) {
			setAppsAll(true);
			setDraftApps(null);
			return;
		}
		const set = new Set(draftApps ?? appCatalog.map((a) => a.id));
		for (const a of appRows) {
			if (on) set.add(a.id);
			else set.delete(a.id);
		}
		setAppsAll(false);
		setDraftApps([...set]);
	};

	const collectionColumns: any[] = [
		{
			id: 'collection_slug',
			header: 'Collection',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }: any) => {
				const p = row.original;
				const dirty = isPermDirty(p, permBaseline[p.collection_slug]);
				return (
					<span
						style={{
							...mono,
							display: 'inline-flex',
							alignItems: 'center',
							gap: 5,
							fontWeight: 600,
							whiteSpace: 'nowrap',
							color: hasGrant(p) ? 'var(--mmbix-tone-info-fg, #1d4ed8)' : 'var(--mmbix-muted-foreground, #9ca3af)',
						}}
					>
						{dirty && (
							<span
								title="Unsaved changes"
								style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--mmbix-tone-warning-fg, #d97706)' }}
							/>
						)}
						{p.collection_slug}
					</span>
				);
			},
		},
		...FLAG_KEYS.map((k): any => ({
			id: k,
			header: () => (
				<ColumnToggle
					label={FLAG_LABEL[k]}
					state={colStates[k]}
					title={`${colStates[k] === 'all' ? 'Clear' : 'Set'} ${FLAG_LABEL[k]} on all ${filtered.length} shown`}
					onClick={() => toggleColumn(k)}
				/>
			),
			enableSorting: false,
			enableHeaderMenu: false,
			align: 'center',
			cell: ({ row }: any) => (
				<Checkbox checked={Boolean(row.original[k])} onCheckedChange={() => togglePerm(row.original.collection_slug, k)} />
			),
		})),
		{
			id: 'governance',
			header: 'Attributes & RLS',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }: any) => {
				const badges = governanceBadges(row.original);
				return badges.length === 0 ? (
					<span style={{ fontSize: '0.62rem', color: 'var(--mmbix-muted-foreground, #cbd5e1)' }}>Unrestricted</span>
				) : (
					<div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
						{badges.map((b: string) => (
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
				);
			},
		},
	];

	const appColumns: any[] = [
		{
			id: 'app',
			header: 'App',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row }: any) => (
				<span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontWeight: 600, whiteSpace: 'nowrap' }}>
					{row.original.label}
					<span style={{ ...mono, fontWeight: 400, color: 'var(--mmbix-muted-foreground, #94a3b8)' }}>{row.original.id}</span>
				</span>
			),
		},
		{
			id: 'open',
			header: () => (
				<ColumnToggle
					label="Open"
					state={openColState}
					title={`${openColState === 'all' ? 'Close' : 'Open'} ${appRows.length} shown`}
					onClick={toggleOpenColumn}
				/>
			),
			enableSorting: false,
			enableHeaderMenu: false,
			align: 'center',
			cell: ({ row }: any) => (
				<Checkbox
					checked={appsAll || (draftApps?.includes(row.original.id) ?? false)}
					onCheckedChange={() => toggleAppRow(row.original.id)}
				/>
			),
		},
	];

	const viewSwitch = (
		<ToggleGroup
			value={[view]}
			onValueChange={(vals) => {
				const v = vals?.[0];
				if (v === 'collections' || v === 'apps') setView(v);
			}}
			aria-label="Permission view"
		>
			<ToggleGroupItem value="collections" size="sm" className="px-2" aria-label="Collections" title="Per-collection flags">
				<Database size={14} />
			</ToggleGroupItem>
			<ToggleGroupItem value="apps" size="sm" className="px-2" aria-label="Apps" title="Which apps this role opens">
				<LayoutGrid size={14} />
			</ToggleGroupItem>
		</ToggleGroup>
	);

	// The form's action row — Directus's circular controls at the header's right
	// edge: the destructive action (icon-only), the ONE Save (a circular check,
	// dimmed until something is pending) and the ✕ that leaves the form.
	const actionRow = (
		<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
			{!isNew && !role.is_system && (
				<Button
					variant="secondary"
					size="icon"
					className="rounded-full"
					title="Delete role"
					aria-label="Delete role"
					style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}
					onClick={() => void removeRole()}
				>
					<Trash2 />
				</Button>
			)}
			<Button
				variant="default"
				size="icon"
				className="rounded-full"
				disabled={busy || !canSave}
				title={
					!canSave
						? 'No changes to save'
						: isPolicy
							? `Save ${pendingCount === 1 ? '1 pending change' : `${pendingCount} pending changes`}`
							: 'Save the role profile'
				}
				aria-label="Save"
				onClick={() => void saveAll()}
			>
				<Check />
			</Button>
			<Button variant="secondary" size="icon" className="rounded-full" title="Close" aria-label="Close" onClick={onBack}>
				<X />
			</Button>
		</div>
	);

	const collectionsEmpty =
		library.length === 0 ? 'Loading collections…' : permQuery ? `No collection matches "${permQuery}".` : 'Loading access…';
	const appsEmpty = modulesQ.isPending
		? 'Loading apps…'
		: appCatalog.length === 0
			? `This deployment has no apps.`
			: `No app matches "${appQuery}".`;

	return (
		<div style={{ padding: '1.25rem', maxWidth: 960, margin: '0 auto' }}>
			{/* Header — Directus's form chrome, in place of the shell's crumb row the
			    host drops while an edit form is open: the record names itself on the
			    left, the circular actions sit at the right edge. The two modes name
			    themselves differently because they ARE different forms — the role
			    profile reads "<name> Role" (Directus titles a role page that way),
			    the policy form reads the bare policy name + whom it binds. */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: '1.5rem' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
					{isPolicy && <ShieldCheck size={18} style={{ color: 'var(--mmbix-muted-foreground, #64748b)', flexShrink: 0 }} />}
					<div style={{ minWidth: 0 }}>
						<h1
							style={{
								fontSize: '1rem',
								fontWeight: 700,
								margin: 0,
								display: 'flex',
								alignItems: 'center',
								gap: 8,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
							}}
						>
							{isPolicy ? role.name : isNew ? 'New role' : `${role.name} Role`}
							{isPolicy && role.is_system === true && (
								<span
									style={{
										...tinyPill,
										background: 'var(--mmbix-muted, #f3f4f6)',
										color: 'var(--mmbix-muted-foreground, #64748b)',
									}}
								>
									System
								</span>
							)}
						</h1>
						{isPolicy && (
							<p style={{ ...note, margin: 0 }}>{members.length === 1 ? 'Applies to 1 user.' : `Applies to ${members.length} users.`}</p>
						)}
					</div>
				</div>
				{actionRow}
			</div>

			{isPolicy ? (
				<>
					<div style={{ marginBottom: '1rem' }}>
						<h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Permissions</h3>
						<div style={tableSurface}>
							{view === 'collections' ? (
								<DataTable
									columns={collectionColumns}
									data={filtered}
									rowKey="collection_slug"
									manualFiltering
									globalFilter={permQuery}
									onGlobalFilterChange={setPermQuery}
									density="compact"
									stickyHeader
									showFilters={false}
									showPagination={false}
									labels={{ searchPlaceholder: 'Filter by collection', searchLabel: 'Filter collections', empty: collectionsEmpty }}
									toolbarActions={
										<>
											{viewSwitch}
											{unsavedMark(pendingCount)}
											<div style={{ display: 'flex', gap: 4 }}>
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
										</>
									}
								/>
							) : (
								<DataTable
									columns={appColumns}
									data={appRows}
									rowKey="id"
									manualFiltering
									globalFilter={appQuery}
									onGlobalFilterChange={setAppQuery}
									density="compact"
									stickyHeader
									showFilters={false}
									showPagination={false}
									labels={{ searchPlaceholder: 'Filter by app', searchLabel: 'Filter apps', empty: appsEmpty }}
									toolbarActions={
										<>
											{viewSwitch}
											{unsavedMark(pendingCount)}
										</>
									}
								/>
							)}
						</div>
					</div>
				</>
			) : (
				<>
					{/* Identity — the engine's role record: a name and a description. A
					    rename cascades onto the directory server-side; only a SYSTEM
					    role's name is frozen (the server is the final judge — the
					    configured Telegram default and the engine immutables also
					    refuse, and their reasons come back from the API). Directus
					    also shows Role Icon and Parent Role, but `_roles` stores
					    neither, so no control is rendered for them (a dead picker
					    would be a lie — add the columns server-side first). The two
					    fields share the users editor's TWO-column grid, so the
					    Directus-chrome editors read as ONE form language. */}
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.25rem 1.5rem', marginBottom: '2rem' }}>
						<div style={{ minWidth: 0 }}>
							<label style={{ ...sectionTitle, marginBottom: 6, display: 'block' }}>
								Role Name <span style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>*</span>
							</label>
							<Input
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="e.g. Storekeeper"
								disabled={!isNew && role.is_system}
								title={!isNew && role.is_system ? 'System roles cannot be renamed' : undefined}
							/>
							{!isNew && role.is_system && <p style={{ ...note, marginTop: 4 }}>System roles cannot be renamed.</p>}
						</div>

						<div style={{ minWidth: 0 }}>
							<label style={{ ...sectionTitle, marginBottom: 6, display: 'block' }}>Description</label>
							<Textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="A description of this role..."
								rows={3}
							/>
						</div>
					</div>

					{!isNew && (
						<>
							{/* The role page's answer to Directus's Policies list: one row per
							    thing this role can be granted, linking to the editor that owns it. */}
							{onOpenPermissions && (
								<div style={{ marginBottom: '2rem' }}>
									<h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
										<Database size={16} /> Permissions
									</h3>
									<div style={tableSurface}>
										<button
											type="button"
											onClick={onOpenPermissions}
											style={{
												width: '100%',
												display: 'flex',
												alignItems: 'center',
												gap: 8,
												border: 'none',
												background: 'transparent',
												padding: '10px 12px',
												cursor: 'pointer',
												fontSize: '0.78rem',
												color: 'var(--mmbix-foreground, #0f172a)',
												textAlign: 'left',
											}}
										>
											Collection flags &amp; app access
											<ChevronRight size={14} style={{ marginLeft: 'auto', color: 'var(--mmbix-muted-foreground, #94a3b8)' }} />
										</button>
									</div>
								</div>
							)}

							{/* Who holds this role — a two-column table: unnamed columns left
							    every value a ragged edge, so the header names them and every
							    row shares its grid. */}
							<div style={{ marginBottom: '1.5rem' }}>
								<h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 6 }}>
									<Users size={16} /> Users in Role
								</h3>
								<div style={tableSurface}>
									<div style={{ ...usersGrid, padding: '10px 12px 8px' }}>
										<span style={sectionTitle}>Name</span>
										<span style={sectionTitle}>Email</span>
									</div>
									{usersQ.isLoading ? (
										<div style={{ padding: '4px 12px 12px', fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
											Loading...
										</div>
									) : members.length === 0 ? (
										<div style={{ padding: '4px 12px 12px', fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
											No users have this role.
										</div>
									) : (
										<>
											{members.slice(0, 10).map((u) => (
												<div
													key={u.id}
													style={{
														...usersGrid,
														padding: '9px 12px',
														borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
														fontSize: '0.78rem',
													}}
												>
													<span
														style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}
													>
														{u.full_name || u.email}
													</span>
													<span
														style={{
															minWidth: 0,
															overflow: 'hidden',
															textOverflow: 'ellipsis',
															whiteSpace: 'nowrap',
															color: 'var(--mmbix-muted-foreground, #9ca3af)',
														}}
													>
														{u.email}
													</span>
												</div>
											))}
											{members.length > 10 && (
												<div
													style={{
														padding: '8px 12px',
														borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
														fontSize: '0.7rem',
														color: 'var(--mmbix-muted-foreground, #9ca3af)',
														textAlign: 'center',
													}}
												>
													+{members.length - 10} more users
												</div>
											)}
										</>
									)}
								</div>
							</div>
						</>
					)}
				</>
			)}

			{msg && (
				<span
					style={{
						fontSize: '0.72rem',
						color:
							msg.includes('failed') || msg.includes('required')
								? 'var(--mmbix-tone-warning-fg, #d97706)'
								: 'var(--mmbix-tone-positive-fg, #059669)',
					}}
				>
					{msg}
				</span>
			)}
		</div>
	);
}
