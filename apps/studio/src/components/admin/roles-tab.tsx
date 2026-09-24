import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Checkbox, Input } from '@mmbix/design-system';
import { Plus, Save, Search, ShieldCheck } from 'lucide-react';
import { createRole, updateRole, getRolePermissions, setPermission, type RolePermission } from '../../lib/api';
import { appRequiredCollections } from '../../lib/app-collections';
import { collectionsQuery, modulesQuery, rolesQuery } from '../../lib/queries';
import { invalidateRoles } from '../../lib/query-client';

/**
 * The launcher/app boards a role may open. These are the module slugs from the
 * DB module registry (`_modules`, served by `GET /api/modules`) — `_roles.app_access`
 * stores exactly those ids, and a checkbox here writes that id array
 * (null = every module). Deriving the catalog from the registry means a module
 * added in the Studio appears here with no code change and no drift.
 */

/** CRUD/special flags on a `_role_permissions` row (record access per collection). */
const FLAG_KEYS = ['can_read', 'can_write', 'can_create', 'can_delete', 'can_approve', 'can_submit'] as const;
type FlagKey = (typeof FLAG_KEYS)[number];
const FLAG_LABEL: Record<FlagKey, string> = {
	can_read: 'read',
	can_write: 'write',
	can_create: 'create',
	can_delete: 'delete',
	can_approve: 'approve',
	can_submit: 'submit',
};

const EMPTY_PERMS = { can_read: false, can_write: false, can_create: false, can_delete: false, can_approve: false, can_submit: false };

const sectionTitle = {
	fontSize: '0.66rem',
	fontWeight: 700,
	textTransform: 'uppercase' as const,
	letterSpacing: '0.05em',
	color: '#64748b',
};
const note = { fontSize: '0.7rem', color: '#9ca3af', margin: 0 };

/** A collection already has a `_role_permissions` grant row for this role. */
function isGranted(p: RolePermission) {
	return Boolean(p.id) || FLAG_KEYS.some((k) => Boolean(p[k]));
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
						map[slug] = found
							? found
							: { id: '', role_id: rid, collection_slug: slug, ...EMPTY_PERMS, field_restrictions: null, row_filters: null };
					}
					setPermBy(map);
				})
				.catch(() => setPermBy({}));
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

	// Persist an existing per-row field whitelist / row filter as-is (wide open when unset).
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
		if (!isGranted(draft) && !FLAG_KEYS.some((k) => Boolean(draft[k]))) return; // untouched + deny → no row to write
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
		const granted = allRows.filter((r) => isGranted(r) || FLAG_KEYS.some((k) => Boolean(r[k])));
		const unset = allRows.filter((r) => !isGranted(r) && !FLAG_KEYS.some((k) => Boolean(r[k])));
		const byName = (arr: RolePermission[]) => [...arr].sort((a, b) => a.collection_slug.localeCompare(b.collection_slug));
		return [...byName(granted), ...byName(unset)];
	}, [allRows]);

	const filtered = useMemo(() => {
		if (!permQuery.trim()) return sorted;
		const q = permQuery.toLowerCase();
		return sorted.filter((r) => r.collection_slug.includes(q));
	}, [sorted, permQuery]);

	const btnPrimary: React.CSSProperties = {
		boxSizing: 'border-box',
		borderRadius: 6,
		border: '1px solid var(--mmbix-border, #e5e7eb)',
		padding: '0.35rem 0.6rem',
		fontSize: '0.72rem',
		fontWeight: 600,
		background: 'var(--mmbix-card, #fff)',
		color: 'var(--mmbix-foreground, #374151)',
		cursor: 'pointer',
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
	};

	return (
		<div style={{ display: 'flex', gap: 12, padding: '0.75rem 0.9rem', alignItems: 'flex-start' }}>
			{/* ── Left: role list ─────────────────────────────── */}
			<aside style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
					<span style={sectionTitle}>Roles</span>
					<span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{roles.length}</span>
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
					{roles.map((r) => {
						const active = r.id === roleId;
						return (
							<button
								key={r.id}
								type="button"
								onClick={() => {
									setRoleId(r.id);
									setMsg(null);
								}}
								title={r.name}
								style={{
									...btnPrimary,
									justifyContent: 'space-between',
									border: active ? '1px solid #2563eb' : '1px solid var(--mmbix-border, #e5e7eb)',
									background: active ? 'rgba(37,99,235,0.08)' : 'var(--mmbix-card, #fff)',
									color: active ? '#1d4ed8' : 'var(--mmbix-foreground, #374151)',
								}}
							>
								<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
								{r.is_system === 1 && <Badge variant="outline">system</Badge>}
							</button>
						);
					})}
				</div>
			</aside>

			{/* ── Right: editor for the selected role ─────────── */}
			<div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
				{!role ? (
					<div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', padding: '3rem 0', color: '#9ca3af' }}>
						<ShieldCheck size={26} />
						<span style={{ fontSize: '0.74rem' }}>Select a role (or create one) to manage its access.</span>
					</div>
				) : (
					<>
						{/* Header row: name + description */}
						<div
							style={{
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 10,
								background: 'var(--mmbix-card, #fff)',
								padding: '0.7rem 0.8rem',
								display: 'flex',
								flexDirection: 'column',
								gap: 8,
							}}
						>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
								<span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--mmbix-foreground, #0f172a)' }}>{role.name}</span>
								{role.is_system === 1 && <Badge variant="outline">system role</Badge>}
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<span style={{ fontSize: '0.7rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>Description</span>
								<Input
									value={draftDesc}
									onChange={(e) => setDraftDesc(e.target.value)}
									placeholder="Purpose / who should hold this role"
									style={{ flex: 1, minWidth: 0 }}
								/>
							</div>
						</div>

						{/* App board */}
						<section
							style={{
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 10,
								background: 'var(--mmbix-card, #fff)',
								padding: '0.7rem 0.8rem',
								display: 'flex',
								flexDirection: 'column',
								gap: 8,
							}}
						>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<span style={sectionTitle}>Mini-app board</span>
								<span style={{ ...note, marginLeft: 4, flex: 1 }}>
									Which launcher apps this role opens (null = every app). Ticking an app also grants read on the collections it needs.
								</span>
								<Button size="sm" onClick={() => void saveRole()} disabled={busy}>
									<Save size={12} /> Save role
								</Button>
							</div>
							<label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: '#374151', cursor: 'pointer' }}>
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
													background: on ? 'rgba(37,99,235,0.08)' : 'transparent',
													fontSize: '0.72rem',
													color: '#374151',
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

						{/* Collection permissions — one row per collection (granted + unset) */}
						<section
							style={{
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 10,
								background: 'var(--mmbix-card, #fff)',
								padding: '0.7rem 0.8rem',
								display: 'flex',
								flexDirection: 'column',
								gap: 8,
							}}
						>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
								<span style={sectionTitle}>Collection permissions</span>
								<span style={{ ...note, marginLeft: 4, flex: 1 }}>Every collection shown; check flags and Save to grant access.</span>
							</div>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<Search size={13} style={{ color: '#9ca3af' }} />
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
								<div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
									<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
										<thead style={{ position: 'sticky', top: 0, background: 'var(--mmbix-card, #fff)', zIndex: 1 }}>
											<tr>
												<th style={{ textAlign: 'left', padding: '0.2rem 0.4rem', color: '#9ca3af', fontWeight: 600 }}>Collection</th>
												{FLAG_KEYS.map((k) => (
													<th key={k} style={{ textAlign: 'center', padding: '0.2rem 0.3rem', color: '#9ca3af', fontWeight: 600 }}>
														{FLAG_LABEL[k]}
													</th>
												))}
												<th style={{ textAlign: 'right', padding: '0.2rem 0.3rem' }} />
											</tr>
										</thead>
										<tbody>
											{filtered.map((p) => {
												const hasGrant = FLAG_KEYS.some((k) => Boolean(p[k]));
												return (
													<tr key={p.collection_slug} style={{ borderTop: '1px solid var(--mmbix-border, #e5e7eb)' }}>
														<td
															style={{
																padding: '0.3rem 0.4rem',
																fontWeight: 600,
																fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
																fontSize: '0.68rem',
																color: hasGrant ? '#1d4ed8' : '#9ca3af',
															}}
														>
															{p.collection_slug}
														</td>
														{FLAG_KEYS.map((k) => (
															<td key={k} style={{ textAlign: 'center', padding: '0.3rem 0.25rem' }}>
																<Checkbox checked={Boolean(p[k])} onCheckedChange={() => togglePerm(p.collection_slug, k)} />
															</td>
														))}
														<td style={{ textAlign: 'right', padding: '0.25rem 0.3rem', whiteSpace: 'nowrap' }}>
															<Button
																size="sm"
																variant="outline"
																disabled={busy}
																onClick={() => void savePerm(p.collection_slug)}
																title="Save full flag set for this collection"
															>
																<Save size={12} /> Save
															</Button>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							)}
						</section>
					</>
				)}

				{msg && (
					<span
						style={{
							fontSize: '0.72rem',
							color: msg.includes('failed') || msg.includes('required') || msg.includes('removed') ? '#d97706' : '#059669',
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
