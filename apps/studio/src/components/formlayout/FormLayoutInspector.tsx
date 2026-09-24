import { useMemo, useState } from 'react';
import { Badge, Button, Input } from '@mmbix/design-system';
import { Check, ChevronRight, ChevronsRight, CircleHelp, Info, Plus, Redo2, Search, Trash2, Undo2, X } from 'lucide-react';
import { SideSection, useRightPane } from '../StudioLayout';
import { useFormLayout } from './context';
import { useFieldTypes } from '../../lib/use-field-types';
import { FieldInspector } from './FieldInspector';
import { FieldTypeIcon } from './FieldTypeIcon';
import { ConditionBuilder, GroupIconPicker, PropCombobox, PropRow, Segmented } from './properties';
import type { FormGroup } from './types';

/**
 * FormLayoutInspector — the right pane: context-aware properties for whatever
 * is selected (form → tab → group → field), plus save/undo/help controls.
 * Renders nothing when no FormLayoutProvider is mounted.
 */
export function FormLayoutInspector() {
	const ctx = useFormLayout();
	const fieldTypes = useFieldTypes(ctx?.token ?? '');

	// Hooks must stay unconditional — when the provider is absent the pane renders
	// nothing, so these just see empty inputs until ctx resolves (same result).
	const { collapsed, toggle } = useRightPane() ?? { collapsed: false, toggle: () => {} };
	const ctxTabs = ctx?.tabs;
	const ctxFields = ctx?.fields;

	/* ── Field search / jump — find any field across tabs & groups and select it ── */
	const fieldIndex = useMemo(() => {
		const out: Array<{ name: string; label: string; type: string; gid: string; tabId: string; tabLabel: string; groupTitle: string }> = [];
		for (const t of ctxTabs ?? []) {
			const walk = (gs: FormGroup[], parentTitle: string) => {
				for (const g of gs) {
					for (const n of g.fieldNames) {
						const f = (ctxFields ?? []).find((x) => x.name === n);
						if (f)
							out.push({
								name: n,
								label: f.label || n,
								type: f.type,
								gid: g.id,
								tabId: t.id,
								tabLabel: t.label,
								groupTitle: g.title || parentTitle,
							});
					}
					if (g.groups?.length) walk(g.groups, g.title || parentTitle);
				}
			};
			walk(t.groups, '');
		}
		return out;
	}, [ctxTabs, ctxFields]);
	const [query, setQuery] = useState('');

	if (!ctx) return null;
	const {
		selectedField,
		fields,
		updateField,
		removeField,
		duplicateField,
		canUndo,
		canRedo,
		undo,
		redo,
		setHelpOpen,
		setInspectorKind,
		inspectorKind,
		activeTab,
		tabs,
		renameTab,
		removeTab,
		activeGroup,
		patchGroup,
		markDirty,
		addGroup,
		addExistingField,
		schema,
		defaultTabId,
		setDefaultTabId,
		activeGroupId,
		setSelected,
		setActiveTabId,
		setActiveGroupId,
	} = ctx;

	// All groups across every tab (flattened with their tab label) — the field
	// "Move to group" list can reach groups in other tabs too.
	const allGroups: Array<{ id: string; title: string; tab: string }> = [];
	if (tabs) {
		for (const t of tabs) {
			const walk = (gs: FormGroup[]) => {
				for (const g of gs) {
					allGroups.push({ id: g.id, title: g.title, tab: t.label });
					if (g.groups?.length) walk(g.groups);
				}
			};
			walk(t.groups);
		}
	}

	const q = query.trim().toLowerCase();
	const matches = q
		? fieldIndex.filter((r) => r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.type.includes(q)).slice(0, 8)
		: [];
	const jumpToField = (r: (typeof fieldIndex)[number]) => {
		setActiveTabId(r.tabId);
		setActiveGroupId(r.gid);
		setSelected(r.name);
		setInspectorKind('field');
		setQuery('');
	};

	return (
		<>
			{/* Pane chrome — breadcrumb trail + undo/redo/help + save state */}
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
					background: 'var(--mmbix-background, #fff)',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 0.75rem 0' }}>
					<Button variant="ghost" size="icon-xs" title={collapsed ? 'Expand pane' : 'Collapse pane'} onClick={toggle}>
						<ChevronsRight size={13} />
					</Button>
					<strong style={{ fontSize: '0.85rem' }}>Properties</strong>
					<span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
						<Button variant="ghost" size="icon-xs" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
							<Undo2 size={13} />
						</Button>
						<Button variant="ghost" size="icon-xs" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" disabled={!canRedo} onClick={redo}>
							<Redo2 size={13} />
						</Button>
						<Button variant="ghost" size="icon-xs" title="Shortcuts (?)" onClick={() => setHelpOpen(true)}>
							<CircleHelp size={13} />
						</Button>
					</span>
				</div>
				{/* Breadcrumb trail — what the pane is inspecting */}
				<div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '0.3rem 0.75rem 0.55rem', flexWrap: 'wrap' }}>
					<Crumb text={schema?.name ?? 'Collection'} />
					{inspectorKind !== 'form' && activeTab && (
						<>
							<ChevronRight size={10} style={{ color: '#cbd5e1' }} />
							<Crumb text={activeTab.label} active={inspectorKind === 'tab'} />
						</>
					)}
					{inspectorKind === 'group' && activeGroup && (
						<>
							<ChevronRight size={10} style={{ color: '#cbd5e1' }} />
							<Crumb text={activeGroup.title || 'Untitled group'} active />
						</>
					)}
					{inspectorKind === 'field' && selectedField && (
						<>
							<ChevronRight size={10} style={{ color: '#cbd5e1' }} />
							<Crumb text={activeGroup?.title || 'Group'} />
							<ChevronRight size={10} style={{ color: '#cbd5e1' }} />
							<Crumb text={selectedField.label || selectedField.name} active />
						</>
					)}
				</div>
				{/* Field search / jump — type to find any field across tabs & groups. */}
				<div style={{ position: 'relative', padding: '0 0.75rem 0.6rem' }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 6,
							border: '1px solid var(--mmbix-border, #e5e7eb)',
							borderRadius: 7,
							padding: '0.25rem 0.5rem',
							background: 'var(--mmbix-card, #ffffff)',
						}}
					>
						<Search size={12} style={{ color: '#9ca3af', flexShrink: 0 }} />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && matches.length > 0) jumpToField(matches[0]);
								if (e.key === 'Escape') setQuery('');
							}}
							placeholder="Jump to a field…"
							style={{
								border: 'none',
								outline: 'none',
								flex: 1,
								minWidth: 0,
								fontSize: '0.75rem',
								background: 'transparent',
								color: 'var(--mmbix-foreground, #111827)',
							}}
						/>
						{query && (
							<button
								type="button"
								onClick={() => setQuery('')}
								title="Clear"
								style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', color: '#9ca3af' }}
							>
								<X size={11} />
							</button>
						)}
					</div>
					{q && (
						<div
							style={{
								position: 'absolute',
								top: '100%',
								left: '0.75rem',
								right: '0.75rem',
								zIndex: 30,
								background: 'var(--mmbix-card, #ffffff)',
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 8,
								boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
								padding: '0.3rem',
								marginTop: 2,
							}}
						>
							{matches.length === 0 ? (
								<p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '0.3rem 0.5rem' }}>No fields match “{query}”.</p>
							) : (
								matches.map((r) => (
									<button
										key={r.name}
										type="button"
										onClick={() => jumpToField(r)}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 7,
											width: '100%',
											padding: '0.35rem 0.5rem',
											borderRadius: 6,
											border: 'none',
											background: 'none',
											cursor: 'pointer',
											textAlign: 'left',
											fontSize: '0.76rem',
											color: 'var(--mmbix-foreground, #374151)',
										}}
									>
										<FieldTypeIcon type={r.type} size={13} />
										<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
											{r.label}
										</span>
										<span style={{ fontSize: '0.62rem', color: '#9ca3af', flexShrink: 0 }}>
											{r.tabLabel} · {r.groupTitle || 'Group'}
										</span>
									</button>
								))
							)}
						</div>
					)}
				</div>
			</div>

			{inspectorKind === 'form' && <FormSection />}
			{inspectorKind === 'tab' && activeTab && (
				<SideSection title="Tab properties" action={tabs.length > 1 ? <Badge variant="outline">{tabs.length} tabs</Badge> : undefined}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
						<PropRow label="Tab name" hint="Appears in the form's tab bar at runtime.">
							<Input
								value={activeTab.label}
								onChange={(e) => renameTab(activeTab.id, e.target.value)}
								placeholder="Tab name"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow label="Default tab" hint="Which tab opens first when the form loads.">
							<PropCombobox
								value={defaultTabId ?? tabs[0]?.id ?? ''}
								options={tabs.map((t) => ({ value: t.id, label: t.label }))}
								onChange={(v) => {
									setDefaultTabId(v || tabs[0]?.id || '');
									markDirty();
								}}
							/>
						</PropRow>
						{tabs.length > 1 && (
							<Button variant="destructive" size="sm" onClick={() => removeTab(activeTab.id)}>
								<Trash2 size={13} /> Delete tab
							</Button>
						)}
					</div>
				</SideSection>
			)}
			{inspectorKind === 'group' && activeGroup && (
				<SideSection
					title="Group properties"
					action={
						<Badge variant="outline">
							{activeGroup.fieldNames.length} fields{activeGroup.groups?.length ? ` · ${activeGroup.groups.length} sub` : ''}
						</Badge>
					}
				>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
						<PropRow label="Group name">
							<Input
								value={activeGroup.title}
								onChange={(e) => {
									patchGroup(activeGroup.id, (g) => ({ ...g, title: e.target.value }));
									markDirty();
								}}
								placeholder="Group name"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow label="Group icon" hint="Any lucide icon — pick one or none (shown next to the group title).">
							<GroupIconPicker
								value={activeGroup.icon}
								onChange={(icon) => {
									patchGroup(activeGroup.id, (g) => ({ ...g, icon }));
									markDirty();
								}}
							/>
						</PropRow>
						<PropRow label="Grid columns" hint="How many columns fields are laid out in (1 = full width rows; 6 = fine 6-grid).">
							<Segmented
								value={activeGroup.columns}
								options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n, title: `${n} column${n > 1 ? 's' : ''}` }))}
								onChange={(columns) => {
									patchGroup(activeGroup.id, (g) => ({ ...g, columns: columns }));
									markDirty();
								}}
							/>
						</PropRow>
						{activeTab && (
							<Button variant="outline" size="sm" onClick={() => addGroup(activeTab.id, activeGroup.id)}>
								<Plus size={13} /> Add sub-group
							</Button>
						)}
						<ConditionBuilder
							title="Show group when"
							condition={activeGroup.visible_when}
							fields={fields}
							exclude=""
							onChange={(c) => {
								patchGroup(activeGroup.id, (g) => ({ ...g, visible_when: c }));
								markDirty();
							}}
						/>
					</div>
				</SideSection>
			)}
			{inspectorKind === 'field' && selectedField && (
				<FieldInspector
					field={selectedField}
					fields={fields}
					update={(patch) => updateField(selectedField.name, patch)}
					remove={() => removeField(selectedField.name)}
					onDuplicate={duplicateField}
					groupOptions={allGroups}
					onMoveToGroup={addExistingField}
					currentGroupId={activeGroupId ?? undefined}
					fieldTypes={fieldTypes}
					token={ctx.token}
				/>
			)}
		</>
	);
}

/* ── Form-level properties (nothing selected — canvas background) ── */
function FormSection() {
	const ctx = useFormLayout();
	if (!ctx) return null;
	const { schema, tabs, defaultTabId, setDefaultTabId, activeTabId, setActiveTabId, setInspectorKind, markDirty } = ctx;
	const totalFields = tabs.reduce((n, t) => n + countFields(t.groups), 0);
	const totalGroups = tabs.reduce((n, t) => n + countGroups(t.groups), 0);

	return (
		<>
			<SideSection title="Form" action={<Badge variant="outline">{schema?.slug ?? ''}</Badge>}>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
					<PropRow label="Form name">
						<Input
							value={schema?.name ?? ''}
							readOnly
							style={{ height: 28, fontSize: '0.8rem', background: 'var(--mmbix-muted, #f3f4f6)' }}
						/>
					</PropRow>
					<PropRow label="Default tab" hint="Which tab opens first when the form renders (edit + new).">
						<PropCombobox
							value={defaultTabId ?? tabs[0]?.id ?? ''}
							options={tabs.map((t) => ({ value: t.id, label: t.label }))}
							onChange={(v) => {
								setDefaultTabId(v || tabs[0]?.id || '');
								markDirty();
							}}
						/>
					</PropRow>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
						<Stat label="Fields" value={totalFields} />
						<Stat label="Groups" value={totalGroups} />
						<Stat label="Tabs" value={tabs.length} />
						<Stat label="Layout" value={tabs.length > 1 ? `${tabs.length} tabs` : 'single'} />
					</div>
				</div>
			</SideSection>
			{tabs.length > 1 && (
				<SideSection title="Tab order" action={tabs.length > 1 ? <Badge variant="outline">{tabs.length}</Badge> : undefined}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
						{tabs.map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => {
									setActiveTabId(t.id);
									setInspectorKind('tab');
								}}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 6,
									padding: '0.35rem 0.5rem',
									borderRadius: 6,
									border: `1px solid ${t.id === activeTabId ? 'var(--mmbix-primary, #2563eb)' : 'transparent'}`,
									background: t.id === activeTabId ? 'var(--mmbix-muted, #f0fdfa)' : 'none',
									cursor: 'pointer',
									fontSize: '0.78rem',
									textAlign: 'left',
									color: 'var(--mmbix-foreground, #374151)',
								}}
							>
								{t.id === defaultTabId && <Check size={11} style={{ color: 'var(--mmbix-primary, #2563eb)' }} />}
								<span style={{ flex: 1 }}>{t.label}</span>
								<span style={{ fontSize: '0.62rem', color: '#9ca3af' }}>{countFields(t.groups)} fields</span>
							</button>
						))}
					</div>
				</SideSection>
			)}
			<SideSection title="Getting started">
				<div style={{ display: 'flex', gap: 8, fontSize: '0.76rem', color: '#6b7280', lineHeight: 1.5 }}>
					<Info size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--mmbix-primary, #2563eb)' }} />
					<div>
						Click a tab, group or field chip on the canvas to edit its properties. Add fields from the left palette, or press{' '}
						<kbd style={kbdStyle}>?</kbd> for shortcuts.
					</div>
				</div>
			</SideSection>
		</>
	);
}

function Stat({ label, value }: { label: string; value: number | string }) {
	return (
		<div
			style={{
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				borderRadius: 8,
				padding: '0.45rem 0.6rem',
				background: 'var(--mmbix-card, #ffffff)',
				display: 'flex',
				flexDirection: 'column',
				gap: 2,
			}}
		>
			<span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af' }}>
				{label}
			</span>
			<span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--mmbix-foreground, #111827)' }}>{value}</span>
		</div>
	);
}

/** Breadcrumb crumb — muted by default, teal when it's the inspected node. */
function Crumb({ text, active }: { text: string; active?: boolean }) {
	return (
		<span
			style={{
				fontSize: '0.7rem',
				fontWeight: active ? 700 : 500,
				color: active ? 'var(--mmbix-primary, #2563eb)' : '#6b7280',
				maxWidth: 130,
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			}}
		>
			{text}
		</span>
	);
}

const kbdStyle = {
	background: 'var(--mmbix-muted, #f3f4f6)',
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	borderRadius: 4,
	padding: '0 0.3rem',
	fontSize: '0.7rem',
	fontWeight: 600,
};

function countFields(gs: FormGroup[]): number {
	return gs.reduce((n, g) => n + g.fieldNames.length + (g.groups?.length ? countFields(g.groups) : 0), 0);
}
function countGroups(gs: FormGroup[]): number {
	return gs.reduce((n, g) => n + 1 + (g.groups?.length ? countGroups(g.groups) : 0), 0);
}
