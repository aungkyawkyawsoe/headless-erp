import { useState } from 'react';
import {
	Button,
	Checkbox,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Separator,
	Textarea,
} from '@mmbix/design-system';
import { Plus, Trash2 } from 'lucide-react';
import type { ComponentEvent, ComponentProp, ComponentStyle, DesignComponent, StudioMeta } from '../../lib/studioMeta';
import { authedFetch } from '../../lib/api';

/* ── Component editor dialog ────────────────────────────────── */

const PROP_TYPES = ['text', 'number', 'select', 'color', 'icon', 'url', 'collection', 'toggle', 'expression', 'slot', 'code'];
const STYLE_TYPES = ['preset', 'color', 'slider', 'toggle', 'input'] as const;
const GROUP_OPTIONS = ['Layout', 'Content', 'Data', 'Feedback', 'Navigation'];

export function ComponentEditor({
	component,
	meta,
	onClose,
	onSaved,
}: {
	component: DesignComponent | null;
	meta: StudioMeta | null;
	onClose: () => void;
	onSaved: () => void;
}) {
	const existing =
		component ??
		({ name: '', label: '', group_name: 'Content', icon: 'box', defaults_json: '{}', capabilities_json: '{}' } as DesignComponent);
	const [name, setName] = useState(existing.name);
	const [label, setLabel] = useState(existing.label);
	const [group, setGroup] = useState(existing.group_name);
	const [icon, setIcon] = useState(existing.icon);
	const [defaults, setDefaults] = useState(existing.defaults_json || '{}');
	const [caps, setCaps] = useState(() => {
		try {
			return JSON.parse(existing.capabilities_json || '{}');
		} catch {
			return {};
		}
	});
	const [props, setProps] = useState<ComponentProp[]>(meta?.propsByComponent[existing.name] ?? []);
	const [styles, setStyles] = useState<ComponentStyle[]>(meta?.stylesByComponent[existing.name] ?? []);
	const [events, setEvents] = useState<ComponentEvent[]>(meta?.eventsByComponent[existing.name] ?? []);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const cap = (k: string) => !!caps[k];
	const setCap = (k: string, v: boolean) => setCaps((prev: Record<string, boolean>) => ({ ...prev, [k]: v }));

	const patchProp = (i: number, part: Partial<ComponentProp>) => setProps((prev) => prev.map((p, j) => (j === i ? { ...p, ...part } : p)));
	const addProp = () =>
		setProps((prev) => [
			...prev,
			{
				id: `new-${prev.length}`,
				component_id: existing.id,
				config_key: '',
				label: '',
				prop_type: 'text',
				options_json: null,
				placeholder: null,
				default_value: null,
				is_required: 0,
				is_readonly: 0,
				hint_text: null,
				sort_order: prev.length,
			},
		]);
	const patchStyle = (i: number, part: Partial<ComponentStyle>) =>
		setStyles((prev) => prev.map((s, j) => (j === i ? { ...s, ...part } : s)));
	const addStyle = () =>
		setStyles((prev) => [
			...prev,
			{
				component_id: existing.id,
				style_key: '',
				label: '',
				style_type: 'preset',
				preset_group: null,
				default_val: null,
				sort_order: prev.length,
			},
		]);
	const patchEvent = (i: number, part: Partial<ComponentEvent>) =>
		setEvents((prev) => prev.map((e, j) => (j === i ? { ...e, ...part } : e)));
	const addEvent = () =>
		setEvents((prev) => [...prev, { component_id: existing.id, event_name: '', event_type: 'action_list', description: null }]);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			const nameKey = name.trim();
			// Stable component id — the same key props FK to (core/… for seeded rows, custom/… for new).
			const componentId = component?.id ?? `custom/${nameKey}`;
			// 1. Upsert the component first — prop rows reference it via FK.
			const c = await authedFetch('/__studio/component', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: componentId,
					name: nameKey,
					label: label.trim() || nameKey,
					group_name: group,
					icon: icon.trim() || 'box',
					defaults_json: defaults,
					capabilities_json: JSON.stringify(caps),
				}),
			});
			if (!c.ok) throw new Error('Failed to save component');
			// 2. Replace all props — delete-all + re-insert keeps the DB in sync with the editor
			//    (removed rows get cleaned up; sort_order is rewritten from the list).
			const d = await authedFetch(`/__studio/component/prop?component_id=${encodeURIComponent(componentId)}`, { method: 'DELETE' });
			if (!d.ok) throw new Error('Failed to reset props');
			for (const [i, p] of props.entries()) {
				if (!p.config_key.trim()) continue;
				const r = await authedFetch('/__studio/component/prop', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						id: `${componentId}.${p.config_key.trim()}`,
						component_id: componentId,
						config_key: p.config_key.trim(),
						label: p.label || p.config_key,
						prop_type: p.prop_type,
						options_json: p.options_json,
						placeholder: p.placeholder,
						default_value: p.default_value,
						is_required: p.is_required,
						sort_order: i,
					}),
				});
				if (!r.ok) throw new Error(`Failed to save prop "${p.config_key}"`);
			}
			// 3. Replace per-component style definitions.
			const ds = await authedFetch(`/__studio/component/style?component_id=${encodeURIComponent(componentId)}`, { method: 'DELETE' });
			if (!ds.ok) throw new Error('Failed to reset styles');
			for (const [i, st] of styles.entries()) {
				if (!st.style_key.trim()) continue;
				const rs = await authedFetch('/__studio/component/style', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						component_id: componentId,
						style_key: st.style_key.trim(),
						label: st.label || st.style_key,
						style_type: st.style_type,
						preset_group: st.preset_group,
						default_val: st.default_val,
						sort_order: i,
					}),
				});
				if (!rs.ok) throw new Error(`Failed to save style "${st.style_key}"`);
			}
			// 4. Replace per-component event definitions.
			const de = await authedFetch(`/__studio/component/event?component_id=${encodeURIComponent(componentId)}`, { method: 'DELETE' });
			if (!de.ok) throw new Error('Failed to reset events');
			for (const ev of events) {
				if (!ev.event_name.trim()) continue;
				const re = await authedFetch('/__studio/component/event', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						component_id: componentId,
						event_name: ev.event_name.trim(),
						event_type: ev.event_type || 'action_list',
						description: ev.description,
					}),
				});
				if (!re.ok) throw new Error(`Failed to save event "${ev.event_name}"`);
			}
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent style={{ maxWidth: 640 }}>
				<DialogHeader>
					<DialogTitle>{component ? `Edit ${component.label}` : 'New component'}</DialogTitle>
					<DialogDescription>Component catalog row — drives the palette, defaults and the Props inspector.</DialogDescription>
				</DialogHeader>

				<div
					style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0', maxHeight: '60vh', overflowY: 'auto' }}
				>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Name (block type)</Label>
							<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="heading" disabled={!!component} />
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Label</Label>
							<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Heading" />
						</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Palette group</Label>
							<Combobox
								value={group}
								onValueChange={(v) => {
									if (v) setGroup(String(v));
								}}
								onInputValueChange={() => {}}
								itemToStringLabel={(v) => String(v)}
							>
								<ComboboxInput showTrigger placeholder="Group…" style={{ width: '100%' }} />
								<ComboboxContent align="start" sideOffset={4} style={{ width: 240 }}>
									<ComboboxList>
										{GROUP_OPTIONS.map((o) => (
											<ComboboxItem key={o} value={o}>
												{o}
											</ComboboxItem>
										))}
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Icon (lucide name)</Label>
							<Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="heading-1" />
						</div>
					</div>

					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>Default config (JSON)</Label>
						<Textarea
							value={defaults}
							onChange={(e) => setDefaults(e.target.value)}
							rows={3}
							placeholder='{"content":"Heading","level":2}'
							style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
						/>
					</div>

					<div>
						<Label>Capabilities</Label>
						<div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
							{['style', 'events', 'condition', 'hidden'].map((k) => (
								<label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer' }}>
									<Checkbox checked={cap(k)} onCheckedChange={(v) => setCap(k, !!v)} />
									{String(k)}
								</label>
							))}
						</div>
					</div>

					<Separator />

					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<Label style={{ flex: 1 }}>Props ({props.length})</Label>
						<Button variant="ghost" size="icon-xs" title="Add prop" onClick={addProp}>
							<Plus size={13} />
						</Button>
					</div>
					{props.map((p, i) => (
						<div
							key={i}
							style={{
								display: 'flex',
								flexDirection: 'column',
								gap: 6,
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 8,
								padding: '0.4rem 0.5rem',
							}}
						>
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<Input
									value={p.config_key}
									placeholder="key"
									onChange={(e) => patchProp(i, { config_key: e.target.value })}
									style={{ width: 110 }}
								/>
								<Input value={p.label} placeholder="Label" onChange={(e) => patchProp(i, { label: e.target.value })} style={{ flex: 1 }} />
								<Combobox
									value={p.prop_type}
									onValueChange={(v) => {
										if (v) patchProp(i, { prop_type: String(v) });
									}}
									onInputValueChange={() => {}}
									itemToStringLabel={(v) => String(v)}
								>
									<ComboboxInput showTrigger style={{ width: 110 }} />
									<ComboboxContent align="start" sideOffset={4} style={{ width: 160 }}>
										<ComboboxList>
											{PROP_TYPES.map((t) => (
												<ComboboxItem key={t} value={t}>
													{t}
												</ComboboxItem>
											))}
										</ComboboxList>
									</ComboboxContent>
								</Combobox>
								<Button
									variant="ghost"
									size="icon-xs"
									style={{ color: '#dc2626', flexShrink: 0 }}
									onClick={() => setProps((prev) => prev.filter((_, j) => j !== i))}
								>
									<Trash2 size={13} />
								</Button>
							</div>
							{p.prop_type === 'select' && (
								<Textarea
									rows={2}
									value={p.options_json ?? ''}
									placeholder='[{"value":"1","label":"One"}]'
									onChange={(e) => patchProp(i, { options_json: e.target.value || null })}
									style={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
								/>
							)}
						</div>
					))}

					<Separator />

					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<Label style={{ flex: 1 }}>Styles ({styles.length}) — optional per-component overrides</Label>
						<Button variant="ghost" size="icon-xs" title="Add style" onClick={addStyle}>
							<Plus size={13} />
						</Button>
					</div>
					{styles.map((st, i) => (
						<div
							key={i}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 8,
								padding: '0.4rem 0.5rem',
							}}
						>
							<Input
								value={st.style_key}
								placeholder="key"
								onChange={(e) => patchStyle(i, { style_key: e.target.value })}
								style={{ width: 100 }}
							/>
							<Input value={st.label} placeholder="Label" onChange={(e) => patchStyle(i, { label: e.target.value })} style={{ flex: 1 }} />
							<Combobox
								value={st.style_type}
								onValueChange={(v) => {
									if (v) patchStyle(i, { style_type: String(v) as ComponentStyle['style_type'] });
								}}
								onInputValueChange={() => {}}
								itemToStringLabel={(v) => String(v)}
							>
								<ComboboxInput showTrigger style={{ width: 96 }} />
								<ComboboxContent align="start" sideOffset={4} style={{ width: 140 }}>
									<ComboboxList>
										{STYLE_TYPES.map((t) => (
											<ComboboxItem key={t} value={t}>
												{t}
											</ComboboxItem>
										))}
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
							<Input
								value={st.preset_group ?? ''}
								placeholder="group"
								title="Preset group (size/width/align/radius) for preset type"
								onChange={(e) => patchStyle(i, { preset_group: e.target.value || null })}
								style={{ width: 84 }}
							/>
							<Button
								variant="ghost"
								size="icon-xs"
								style={{ color: '#dc2626', flexShrink: 0 }}
								onClick={() => setStyles((prev) => prev.filter((_, j) => j !== i))}
							>
								<Trash2 size={13} />
							</Button>
						</div>
					))}

					<Separator />

					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<Label style={{ flex: 1 }}>Events ({events.length}) — event names the inspector exposes</Label>
						<Button variant="ghost" size="icon-xs" title="Add event" onClick={addEvent}>
							<Plus size={13} />
						</Button>
					</div>
					{events.map((ev, i) => (
						<div
							key={i}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 8,
								padding: '0.4rem 0.5rem',
							}}
						>
							<Input
								value={ev.event_name}
								placeholder="onClick"
								onChange={(e) => patchEvent(i, { event_name: e.target.value })}
								style={{ width: 120, fontFamily: 'monospace', fontSize: '0.75rem' }}
							/>
							<Input
								value={ev.event_type}
								placeholder="action_list"
								onChange={(e) => patchEvent(i, { event_type: e.target.value })}
								style={{ width: 110 }}
							/>
							<Input
								value={ev.description ?? ''}
								placeholder="Description"
								onChange={(e) => patchEvent(i, { description: e.target.value || null })}
								style={{ flex: 1 }}
							/>
							<Button
								variant="ghost"
								size="icon-xs"
								style={{ color: '#dc2626', flexShrink: 0 }}
								onClick={() => setEvents((prev) => prev.filter((_, j) => j !== i))}
							>
								<Trash2 size={13} />
							</Button>
						</div>
					))}
				</div>

				{error && <p style={{ fontSize: '0.75rem', color: '#dc2626', margin: 0 }}>{error}</p>}

				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={!name.trim() || busy} onClick={() => void submit()}>
						{busy ? 'Saving…' : 'Save component'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
