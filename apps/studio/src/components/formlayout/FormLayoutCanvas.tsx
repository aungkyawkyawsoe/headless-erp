import { useEffect } from 'react';
import { Alert, AlertDescription, Button } from '@mmbix/design-system';
import { Columns2, Plus, X } from 'lucide-react';
import { useFormLayout } from './context';
import { CanvasGroup, CanvasTab } from './pieces';
import type { FormGroup } from './types';

const SHORTCUTS: Array<[string, string]> = [
	['Ctrl/Cmd + S', 'Save the form layout'],
	['W / A / S / D', 'Move selected field (up / left / down / right)'],
	['← ↑ ↓ →', 'Move focus to the adjacent field'],
	['↑ / ↓ (on group name)', 'Reorder the group up / down'],
	['1 – 6', 'Selected field spans 1–6 columns'],
	['Shift + 1–6', 'Double span (2 / 4 / 6 / 8 / 10 / 12)'],
	['Alt + Shift + 1–6', 'Single span (1 / 2 / 3 / 4 / 5 / 6)'],
	['Delete', 'Remove field from layout'],
	['Ctrl/Cmd + D', 'Duplicate field'],
	['Ctrl/Cmd + Z', 'Undo'],
	['Ctrl/Cmd + Shift + Z / Ctrl/Cmd + Y', 'Redo'],
	['?', 'Toggle this help'],
];

/**
 * FormLayoutCanvas — the center pane: tab strip + groups + field chips (edit-only).
 * Fills the available width of its container. Renders nothing when no
 * FormLayoutProvider is mounted (callers show their own hint).
 */
export function FormLayoutCanvas() {
	const ctx = useFormLayout();
	// Hooks must stay unconditional — derive the help-overlay state from the
	// possibly-missing context; when ctx is null helpOpen is false so the effect
	// below never attaches a listener (same as the original early return).
	const helpOpen = ctx?.helpOpen ?? false;
	const setHelpOpen = ctx?.setHelpOpen;

	useEffect(() => {
		if (!helpOpen || !setHelpOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setHelpOpen(false);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [helpOpen, setHelpOpen]);

	if (!ctx) return null;
	const {
		loading,
		schema,
		error,
		tabs,
		activeTabId,
		setActiveTabId,
		activeTab,
		activeGroupId,
		dropOver,
		setActiveGroupId,
		setInspectorKind,
		renameTab,
		removeTab,
		addTab,
		addGroup,
		fields,
		selected,
		setSelected,
		removeFieldFromLayout,
		moveField,
		duplicateField,
		swapFields,
		setFieldSpan,
		moveGroup,
		removeGroup,
		promoteGroup,
		moveGroupUnder,
		addExistingField,
	} = ctx;

	// All groups across every tab (flattened with their tab label) — the field
	// "Move to group" menu can reach groups in other tabs too.
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

	if (loading)
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
					color: 'var(--mmbix-muted-foreground, #6b7280)',
				}}
			>
				Loading form…
			</div>
		);
	if (!schema) return <div style={{ padding: '2rem', color: '#9ca3af' }}>{error ?? 'Collection not found'}</div>;

	return (
		<div
			data-form-layout="true"
			style={{ padding: '1.25rem', width: '100%', boxSizing: 'border-box', position: 'relative' }}
			onClick={(e) => {
				// Canvas background click → inspect the form itself (nothing selected).
				const t = e.target as HTMLElement;
				if (t.closest('[data-field-id]') || t.closest('[data-group-id]') || t.closest('[data-tab-id]') || t.closest('button')) return;
				setSelected(null);
				setActiveGroupId(null);
				setInspectorKind('form');
			}}
		>
			{error && (
				<Alert variant="destructive" style={{ marginBottom: '1rem' }}>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: '0.75rem' }}>
				<span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#9ca3af' }}>WASD move · 1–4 field span · ? for shortcuts</span>
			</div>

			<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
				{/* Tab bar — categorize fields into multiple tabs; drag a field chip onto a tab to move it. */}
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						flexWrap: 'wrap',
						borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
						paddingBottom: 10,
					}}
				>
					{tabs.map((t) => (
						<CanvasTab
							key={t.id}
							tab={t}
							active={t.id === activeTabId}
							onSelect={() => {
								setActiveTabId(t.id);
								setInspectorKind('tab');
							}}
							onRename={(label) => renameTab(t.id, label)}
							onRemove={tabs.length > 1 ? () => removeTab(t.id) : undefined}
						/>
					))}
					<Button variant="ghost" size="xs" onClick={addTab}>
						<Plus size={13} /> Tab
					</Button>
				</div>
				{activeTab ? (
					<>
						{activeTab.groups.map((g) => (
							<CanvasGroup
								key={g.id}
								group={g}
								fields={fields}
								selected={selected}
								isActive={g.id === activeGroupId}
								activeGroupId={activeGroupId}
								dropOver={dropOver}
								onSelect={(gid, name) => {
									setSelected(name);
									setActiveGroupId(gid);
									setInspectorKind('field');
								}}
								onSelectGroup={(gid) => {
									setActiveGroupId(gid);
									setInspectorKind('group');
								}}
								onRemove={removeFieldFromLayout}
								onMove={moveField}
								onDuplicate={duplicateField}
								onSwap={swapFields}
								onFieldSpan={setFieldSpan}
								onMoveGroup={moveGroup}
								onAddSubGroup={(gid) => addGroup(activeTab.id, gid)}
								onRemoveGroup={removeGroup}
								onPromoteGroup={promoteGroup}
								onMoveGroupUnder={moveGroupUnder}
								onMoveField={addExistingField}
								groupOptions={allGroups}
								tabLabel={activeTab.label}
							/>
						))}
						<div>
							<Button variant="outline" size="xs" onClick={() => addGroup(activeTab.id)}>
								<Columns2 size={12} /> Add Group
							</Button>
						</div>
					</>
				) : (
					<p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>Add a tab to organize fields.</p>
				)}
			</div>

			{/* Shortcut help overlay */}
			{helpOpen && (
				<div
					style={{
						position: 'fixed',
						inset: 0,
						zIndex: 60,
						background: 'rgba(17,24,39,0.35)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
					onClick={() => setHelpOpen?.(false)}
				>
					<div
						onClick={(e) => e.stopPropagation()}
						style={{
							background: 'var(--mmbix-card, #ffffff)',
							borderRadius: 12,
							padding: '1.25rem 1.5rem',
							width: 420,
							maxWidth: '90vw',
							boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
							<strong style={{ fontSize: '0.95rem' }}>Form Layout Shortcuts</strong>
							<Button variant="ghost" size="icon-xs" onClick={() => setHelpOpen?.(false)} title="Close">
								<X size={14} />
							</Button>
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
							{SHORTCUTS.map(([k, d]) => (
								<div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.8rem' }}>
									<kbd
										style={{
											minWidth: 150,
											background: 'var(--mmbix-muted, #f3f4f6)',
											border: '1px solid var(--mmbix-border, #e5e7eb)',
											borderRadius: 5,
											padding: '0.2rem 0.45rem',
											fontWeight: 600,
											textAlign: 'center',
											fontSize: '0.72rem',
										}}
									>
										{k}
									</kbd>
									<span style={{ color: 'var(--mmbix-foreground, #374151)' }}>{d}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
