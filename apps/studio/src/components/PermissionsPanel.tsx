import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Checkbox, NativeSelect, NativeSelectOption } from '@mmbix/design-system';
import { Plus, X } from 'lucide-react';
import { SideSection } from './StudioLayout';
import { getRolePermissions, setPermission, type FieldDefinition } from '../lib/api';
import { rolesQuery } from '../lib/queries';

/**
 * PermissionsPanel — role-based field visibility for a collection.
 * Lives in the App workbench (collection section) — formerly part of the
 * standalone Form Builder page.
 */
export default function PermissionsPanel({ token, slug, fields }: { token: string; slug: string; fields: FieldDefinition[] }) {
	const [roleId, setRoleId] = useState('');
	const [allowed, setAllowed] = useState<Set<string> | null>(null); // null = all visible ('*')
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	// Row-level RBAC — { conditions, combiner }; $CURRENT_USER / $CURRENT_USER.field
	// in a condition value resolve to the caller at request time.
	const [rowFilter, setRowFilter] = useState<{ conditions: Array<{ field: string; op: string; value: string }>; combiner: 'and' | 'or' }>({
		conditions: [],
		combiner: 'and',
	});

	const ROW_OPS = ['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'is_empty', 'is_not_empty'];
	const rowFilterJson = (): string | null => (rowFilter.conditions.length > 0 ? JSON.stringify(rowFilter) : null);

	// One session-level roles read, shared with the workflow + admin pickers.
	const rolesQ = useQuery(rolesQuery(token));
	const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);

	useEffect(() => {
		if (roles.length === 0) return;
		const editor = roles.find((r) => r.name.toLowerCase() === 'editor');
		setRoleId((cur) => cur || editor?.id || roles[0]?.id || '');
	}, [roles]);

	useEffect(() => {
		if (!roleId || !slug) {
			setAllowed(null);
			return;
		}
		let cancelled = false;
		getRolePermissions(token, roleId)
			.then((all) => {
				if (cancelled) return;
				const mine = all.find((p) => p.collection_slug === slug);
				const raw = mine?.field_restrictions;
				if (!raw || raw === '*') setAllowed(null);
				else {
					try {
						const arr = JSON.parse(raw) as string[];
						setAllowed(Array.isArray(arr) ? new Set(arr) : null);
					} catch {
						setAllowed(null);
					}
				}
				// Row filters for this role + collection.
				const rf = mine?.row_filters;
				if (rf) {
					try {
						setRowFilter(JSON.parse(rf));
					} catch {
						setRowFilter({ conditions: [], combiner: 'and' });
					}
				} else {
					setRowFilter({ conditions: [], combiner: 'and' });
				}
			})
			.catch(() => {
				if (!cancelled) setAllowed(null);
			});
		setDirty(false);
		return () => {
			cancelled = true;
		};
	}, [token, roleId, slug]);

	const allVisible = allowed === null;
	const toggle = (name: string) => {
		setAllowed((prev) => {
			const base = prev === null ? new Set(fields.map((f) => f.name)) : new Set(prev);
			if (base.has(name)) base.delete(name);
			else base.add(name);
			return base;
		});
		setDirty(true);
		setMsg(null);
	};
	const toggleAll = () => {
		setAllowed((prev) => (prev === null ? new Set() : null));
		setDirty(true);
		setMsg(null);
	};

	const save = async () => {
		if (!roleId) return;
		setBusy(true);
		setMsg(null);
		try {
			const list = allowed === null ? ('*' as const) : fields.map((f) => f.name).filter((n) => allowed.has(n));
			await setPermission(token, { role_id: roleId, collection_slug: slug, field_restrictions: list, row_filters: rowFilterJson() });
			setDirty(false);
			setMsg(allowed === null ? 'All fields visible to this role.' : 'Field visibility saved.');
		} catch (err) {
			setMsg(err instanceof Error ? err.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	return (
		<SideSection
			title="Field Permissions"
			action={roles.length ? <Badge variant="outline">{roles.find((r) => r.id === roleId)?.name ?? '—'}</Badge> : undefined}
		>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
				{roles.length === 0 ? (
					<p style={{ margin: 0, fontSize: '0.78rem', color: '#9ca3af' }}>No roles found — create one via the API.</p>
				) : (
					<>
						<NativeSelect value={roleId} onChange={(e) => setRoleId(e.target.value)}>
							{roles.map((r) => (
								<NativeSelectOption key={r.id} value={r.id}>
									{r.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<label
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								fontSize: '0.78rem',
								color: 'var(--mmbix-foreground, #374151)',
								cursor: 'pointer',
							}}
						>
							<Checkbox checked={allVisible} onCheckedChange={() => toggleAll()} />
							<span style={{ fontWeight: 600 }}>{allVisible ? 'All fields visible' : 'Restricted fields below'}</span>
						</label>
						{!allVisible && (
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 3,
									maxHeight: 200,
									overflowY: 'auto',
									border: '1px solid var(--mmbix-border, #e5e7eb)',
									borderRadius: 8,
									padding: '0.45rem 0.55rem',
								}}
							>
								{fields.map((f) => (
									<label
										key={f.name}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 6,
											fontSize: '0.75rem',
											color: 'var(--mmbix-foreground, #374151)',
											cursor: 'pointer',
										}}
									>
										<Checkbox checked={allowed?.has(f.name) ?? false} onCheckedChange={() => toggle(f.name)} />
										<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label || f.name}</span>
									</label>
								))}
							</div>
						)}
						<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
							<Button size="sm" onClick={() => void save()} disabled={!dirty || busy} style={{ flex: 1 }}>
								{busy ? 'Saving…' : 'Save permissions'}
							</Button>
						</div>
						{msg && <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{msg}</span>}

						{/* Row-level filters — RBAC: a record is visible/writable only when it matches. */}
						<div
							style={{
								borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
								paddingTop: '0.55rem',
								display: 'flex',
								flexDirection: 'column',
								gap: 5,
							}}
						>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--mmbix-foreground, #374151)' }}>Row filters</span>
								<NativeSelect
									value={rowFilter.combiner}
									onChange={(e) => {
										setRowFilter((p) => ({ ...p, combiner: e.target.value === 'or' ? 'or' : 'and' }));
										setDirty(true);
										setMsg(null);
									}}
									style={{ height: 26, fontSize: '0.7rem' }}
								>
									<NativeSelectOption value="and">All match (AND)</NativeSelectOption>
									<NativeSelectOption value="or">Any match (OR)</NativeSelectOption>
								</NativeSelect>
							</div>
							{rowFilter.conditions.length === 0 && (
								<p style={{ margin: 0, fontSize: '0.7rem', color: '#9ca3af' }}>No filter — this role sees every record.</p>
							)}
							{rowFilter.conditions.map((cond, i) => (
								<div key={i} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
									<select
										value={cond.field}
										onChange={(e) => {
											setRowFilter((p) => ({
												...p,
												conditions: p.conditions.map((c, j) => (j === i ? { ...c, field: e.target.value } : c)),
											}));
											setDirty(true);
											setMsg(null);
										}}
										style={{
											flex: 1.2,
											minWidth: 0,
											height: 26,
											fontSize: '0.7rem',
											borderRadius: 6,
											border: '1px solid var(--mmbix-border, #e5e7eb)',
											padding: '0 0.3rem',
											background: 'var(--mmbix-card, #fff)',
										}}
									>
										{fields.map((f) => (
											<option key={f.name} value={f.name}>
												{f.label || f.name}
											</option>
										))}
									</select>
									<select
										value={cond.op}
										onChange={(e) => {
											setRowFilter((p) => ({ ...p, conditions: p.conditions.map((c, j) => (j === i ? { ...c, op: e.target.value } : c)) }));
											setDirty(true);
											setMsg(null);
										}}
										style={{
											width: 92,
											height: 26,
											fontSize: '0.7rem',
											borderRadius: 6,
											border: '1px solid var(--mmbix-border, #e5e7eb)',
											padding: '0 0.3rem',
											background: 'var(--mmbix-card, #fff)',
										}}
									>
										{ROW_OPS.map((o) => (
											<option key={o} value={o}>
												{o}
											</option>
										))}
									</select>
									<input
										value={cond.value}
										onChange={(e) => {
											setRowFilter((p) => ({
												...p,
												conditions: p.conditions.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)),
											}));
											setDirty(true);
											setMsg(null);
										}}
										placeholder="value or $CURRENT_USER"
										style={{
											flex: 1.4,
											minWidth: 0,
											height: 26,
											fontSize: '0.7rem',
											borderRadius: 6,
											border: '1px solid var(--mmbix-border, #e5e7eb)',
											padding: '0 0.35rem',
											background: 'var(--mmbix-card, #fff)',
											outline: 'none',
										}}
									/>
									<button
										type="button"
										onClick={() => {
											setRowFilter((p) => ({ ...p, conditions: p.conditions.filter((_, j) => j !== i) }));
											setDirty(true);
											setMsg(null);
										}}
										style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', padding: 2, display: 'inline-flex' }}
									>
										<X size={13} />
									</button>
								</div>
							))}
							<button
								type="button"
								onClick={() => {
									setRowFilter((p) => ({
										...p,
										conditions: [...p.conditions, { field: fields[0]?.name ?? 'id', op: 'eq', value: '$CURRENT_USER' }],
									}));
									setDirty(true);
									setMsg(null);
								}}
								style={{
									alignSelf: 'flex-start',
									display: 'inline-flex',
									alignItems: 'center',
									gap: 4,
									padding: '0.2rem 0.5rem',
									borderRadius: 6,
									border: '1px solid var(--mmbix-border, #e5e7eb)',
									background: 'transparent',
									fontSize: '0.7rem',
									color: '#64748b',
									cursor: 'pointer',
								}}
							>
								<Plus size={12} /> Add condition
							</button>
							<p style={{ margin: 0, fontSize: '0.66rem', color: '#9ca3af' }}>
								A record is visible/writable only when it matches. Use{' '}
								<code style={{ background: 'var(--mmbix-muted, #f3f4f6)', padding: '0 3px', borderRadius: 4 }}>$CURRENT_USER</code> for the
								logged-in user (or{' '}
								<code style={{ background: 'var(--mmbix-muted, #f3f4f6)', padding: '0 3px', borderRadius: 4 }}>$CURRENT_USER.field</code>).
							</p>
						</div>
					</>
				)}
				<p style={{ margin: '0.25rem 0 0', fontSize: '0.68rem', color: '#9ca3af' }}>
					Fields hidden here are stripped from reads for this role and never shown in the app forms.
				</p>
			</div>
		</SideSection>
	);
}
