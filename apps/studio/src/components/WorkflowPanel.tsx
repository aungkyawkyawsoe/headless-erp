import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Checkbox, NativeSelect, NativeSelectOption } from '@mmbix/design-system';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { api, type EntitySchema, type FieldDefinition } from '../lib/api';
import { collectionQuery, rolesQuery } from '../lib/queries';

/** One approval level (step) in a collection's approval workflow. */
interface ApprovalLevel {
	id: string;
	label: string;
	role_name: string;
	amount_field?: string | null;
	threshold?: number | null;
}

/** Collection-level approval workflow — stored in schema_json.workflow. */
interface ApprovalWorkflow {
	enabled: boolean;
	name: string;
	levels: ApprovalLevel[];
}

/**
 * WorkflowPanel — multi-level approval workflow designer for a collection.
 * Lives in the App workbench (collection section), next to Permissions.
 *
 * The definition is stored in schema_json.workflow; the API engine enforces it
 * on submit/approve/reject. A level can be gated on an amount field: it only
 * applies when the field's value exceeds the threshold (skip below).
 */
export default function WorkflowPanel({
	token,
	slug,
	fields,
	onSaved,
	schema,
}: {
	token: string;
	slug: string;
	fields: FieldDefinition[];
	onSaved?: () => void;
	/** The focused collection's schema, when the parent already holds it. Passing it
	 *  avoids a redundant `GET /api/collections/:slug` merely to read the workflow. */
	schema?: EntitySchema | null;
}) {
	const [enabled, setEnabled] = useState(false);
	const [name, setName] = useState('');
	const [levels, setLevels] = useState<ApprovalLevel[]>([]);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	// Roles are one session-level read shared by every picker (see `rolesQuery`).
	const rolesQ = useQuery(rolesQuery(token));
	const roles = rolesQ.data ?? [];

	// The workflow lives on the focused schema; without a passed schema, read the SAME
	// cached schema entry instead of a second network round-trip.
	const schemaQ = useQuery({ ...collectionQuery(token, slug), enabled: token.length > 0 && !!slug && !schema });
	const workflow = ((schema ?? schemaQ.data)?.schema_json as unknown as { workflow?: ApprovalWorkflow } | undefined)?.workflow;

	// Seed the editor from server truth; a change to the stored workflow re-seeds it.
	useEffect(() => {
		if (workflow && workflow.enabled) {
			setEnabled(true);
			setName(workflow.name ?? '');
			setLevels(Array.isArray(workflow.levels) ? workflow.levels : []);
		} else {
			setEnabled(false);
			setName('');
			setLevels([]);
		}
	}, [workflow]);

	const addLevel = () => {
		const id = crypto.randomUUID();
		setLevels((ls) => [
			...ls,
			{ id, label: `Approval ${ls.length + 1}`, role_name: roles[0]?.name ?? '', amount_field: null, threshold: null },
		]);
	};

	const patchLevel = (id: string, patch: Partial<ApprovalLevel>) => {
		setLevels((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	};

	const removeLevel = (id: string) => setLevels((ls) => ls.filter((l) => l.id !== id));

	const moveLevel = (idx: number, dir: -1 | 1) => {
		setLevels((ls) => {
			const next = [...ls];
			const target = idx + dir;
			if (target < 0 || target >= next.length) return ls;
			[next[idx], next[target]] = [next[target], next[idx]];
			return next;
		});
	};

	const save = async () => {
		setBusy(true);
		setMsg(null);
		try {
			const workflow: ApprovalWorkflow | null = enabled
				? {
						enabled: true,
						name: name.trim() || 'Approval workflow',
						levels: levels
							.filter((l) => l.role_name)
							.map((l) => ({
								id: l.id,
								label: l.label.trim() || l.role_name,
								role_name: l.role_name,
								amount_field: l.amount_field || null,
								threshold: l.threshold ?? null,
							})),
					}
				: null;
			await api(token, `/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ workflow }) });
			setMsg('Saved — the engine enforces it on submit/approve/reject.');
			onSaved?.();
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	const input: React.CSSProperties = {
		width: '100%',
		boxSizing: 'border-box',
		padding: '0.28rem 0.5rem',
		fontSize: '0.74rem',
		borderRadius: 6,
		border: '1px solid var(--mmbix-border, #e5e7eb)',
		background: 'var(--mmbix-card, #fff)',
		color: 'var(--mmbix-foreground, #374151)',
		outline: 'none',
	};
	const mini: React.CSSProperties = { ...input, width: 88, flexShrink: 0 };
	const iconBtn: React.CSSProperties = {
		border: 'none',
		background: 'none',
		cursor: 'pointer',
		padding: 3,
		display: 'inline-flex',
		color: '#9ca3af',
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
				<Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
				Enable approval workflow
			</label>

			{!enabled ? (
				<p style={{ fontSize: '0.74rem', color: '#9ca3af', margin: 0 }}>
					When enabled, submitting a document opens approval levels instead of directly marking it submitted. Approvals are role-gated and
					every decision is recorded in the audit trail.
				</p>
			) : (
				<>
					<input
						placeholder="Workflow name (e.g. Purchase approval)"
						value={name}
						onChange={(e) => setName(e.target.value)}
						style={input}
					/>

					<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
						{levels.length === 0 && (
							<p style={{ fontSize: '0.74rem', color: '#9ca3af', margin: 0 }}>No approval levels yet — add the first one below.</p>
						)}
						{levels.map((l, i) => (
							<div
								key={l.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 6,
									padding: '0.5rem',
									borderRadius: 8,
									border: '1px solid var(--mmbix-border, #e5e7eb)',
									background: 'var(--mmbix-card, #fff)',
								}}
							>
								<Badge variant="outline" style={{ width: 22, justifyContent: 'center', flexShrink: 0 }}>
									{i + 1}
								</Badge>
								<input
									value={l.label}
									onChange={(e) => patchLevel(l.id, { label: e.target.value })}
									placeholder="Level label"
									style={{ ...input, flex: 1 }}
								/>
								<NativeSelect
									value={l.role_name}
									onChange={(e) => patchLevel(l.id, { role_name: e.target.value })}
									style={{ fontSize: '0.72rem', maxWidth: 140 }}
									title="Approving role"
								>
									<NativeSelectOption value="">Role…</NativeSelectOption>
									{roles.map((r) => (
										<NativeSelectOption key={r.id} value={r.name}>
											{r.name}
										</NativeSelectOption>
									))}
								</NativeSelect>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
									<span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Apply when</span>
									<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
										<NativeSelect
											value={l.amount_field ?? ''}
											onChange={(e) => patchLevel(l.id, { amount_field: e.target.value || null })}
											style={{ fontSize: '0.7rem', maxWidth: 110 }}
											title="Amount field"
										>
											<NativeSelectOption value="">always</NativeSelectOption>
											{fields.map((f) => (
												<NativeSelectOption key={f.name} value={f.name}>
													{f.name}
												</NativeSelectOption>
											))}
										</NativeSelect>
										{l.amount_field ? (
											<>
												<span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{'>'}</span>
												<input
													type="number"
													value={l.threshold ?? ''}
													onChange={(e) => patchLevel(l.id, { threshold: e.target.value === '' ? null : Number(e.target.value) })}
													placeholder="0"
													style={mini}
												/>
											</>
										) : null}
									</div>
								</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
									<button
										type="button"
										onClick={() => moveLevel(i, -1)}
										disabled={i === 0}
										style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1 }}
										title="Move up"
									>
										<ArrowUp size={13} />
									</button>
									<button
										type="button"
										onClick={() => moveLevel(i, 1)}
										disabled={i === levels.length - 1}
										style={{ ...iconBtn, opacity: i === levels.length - 1 ? 0.3 : 1 }}
										title="Move down"
									>
										<ArrowDown size={13} />
									</button>
								</div>
								<button type="button" onClick={() => removeLevel(l.id)} style={iconBtn} title="Remove level">
									<X size={14} />
								</button>
							</div>
						))}
					</div>

					<Button size="sm" variant="outline" onClick={addLevel} style={{ alignSelf: 'flex-start' }}>
						<Plus size={13} /> Add level
					</Button>
				</>
			)}

			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Button size="sm" onClick={() => void save()} disabled={busy}>
					{busy ? 'Saving…' : 'Save workflow'}
				</Button>
				{msg && (
					<span style={{ fontSize: '0.72rem', color: msg.startsWith('Saved') ? 'var(--mmbix-primary, #0f766e)' : '#dc2626' }}>{msg}</span>
				)}
			</div>
		</div>
	);
}
