import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
	Badge,
	Button,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Input,
} from '@mmbix/design-system';
import { ChevronDown, Copy, CornerDownRight, MoreVertical, MoveUp, Plus, Trash2 } from 'lucide-react';
import { GroupIcon, fieldSpanOf, isTextareaField } from '@mmbix/ui-views';
import type { FieldDefinition } from '../../lib/api';
import type { FormGroup, FormTab } from './types';
import { FieldTypeIcon } from './FieldTypeIcon';
import { spanShortcut } from './serialize';

/** Find the field visually adjacent to `selected` in the given direction (based on bounding boxes).
 *  Handles full-width fields and non-square grids naturally. */
function directionalNeighbor(
	groupFields: FieldDefinition[],
	selected: string,
	dir: 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp',
): string | null {
	const cur = document.querySelector(`[data-field-id="${selected}"]`);
	if (!cur) return null;
	const rect = cur.getBoundingClientRect();
	let best: { name: string; d: number } | null = null;
	for (const f of groupFields) {
		if (f.name === selected) continue;
		const el = document.querySelector(`[data-field-id="${f.name}"]`) as HTMLElement | null;
		if (!el) continue;
		const r = el.getBoundingClientRect();
		let ok = false;
		let d = 0;
		if (dir === 'ArrowRight') {
			// To the right AND vertically overlapping (same row).
			ok = r.left >= rect.right - 2 && r.top < rect.bottom && r.bottom > rect.top;
			d = Math.hypot(r.left - rect.right, (r.top + r.bottom) / 2 - (rect.top + rect.bottom) / 2);
		} else if (dir === 'ArrowLeft') {
			// To the left AND vertically overlapping (same row).
			ok = r.right <= rect.left + 2 && r.top < rect.bottom && r.bottom > rect.top;
			d = Math.hypot(rect.left - r.right, (r.top + r.bottom) / 2 - (rect.top + rect.bottom) / 2);
		} else if (dir === 'ArrowDown') {
			// Below AND horizontally overlapping (same column).
			ok = r.top >= rect.bottom - 2 && r.left < rect.right && r.right > rect.left;
			d = Math.hypot(r.top - rect.bottom, (r.left + r.right) / 2 - (rect.left + rect.right) / 2);
		} else {
			// Above AND horizontally overlapping (same column).
			ok = r.bottom <= rect.top + 2 && r.left < rect.right && r.right > rect.left;
			d = Math.hypot(rect.top - r.bottom, (r.left + r.right) / 2 - (rect.left + rect.right) / 2);
		}
		if (ok && (!best || d < best.d)) best = { name: f.name, d };
	}
	return best?.name ?? null;
}

/** Canvas group — a droppable section with a column grid (fields span half or full width).
 *  Groups may nest: `group.groups` render as indented sub-groups below this group's fields. */
export function CanvasGroup({
	group,
	fields,
	selected,
	isActive,
	activeGroupId,
	onSelect,
	onSelectGroup,
	onRemove,
	onMove,
	onDuplicate,
	onSwap,
	onFieldSpan,
	onMoveGroup,
	onAddSubGroup,
	onRemoveGroup,
	onPromoteGroup,
	onMoveGroupUnder,
	onMoveField,
	groupOptions,
	tabLabel,
	dropOver,
	depth = 0,
}: {
	group: FormGroup;
	fields: FieldDefinition[];
	selected: string | null;
	isActive?: boolean;
	activeGroupId?: string | null;
	onSelect: (gid: string, name: string) => void;
	onSelectGroup?: (gid: string) => void;
	onRemove: (name: string) => void;
	onMove: (name: string, dir: -1 | 1) => void;
	onDuplicate: (name: string) => void;
	onSwap?: (name: string, other: string) => void;
	onFieldSpan?: (name: string, span: number) => void;
	onMoveGroup?: (gid: string, dir: -1 | 1) => void;
	onAddSubGroup?: (gid: string) => void;
	onRemoveGroup?: (gid: string) => void;
	onPromoteGroup?: (gid: string) => void;
	onMoveGroupUnder?: (gid: string, targetGid: string) => void;
	onMoveField?: (name: string, gid: string) => void;
	groupOptions?: Array<{ id: string; title: string; tab: string }>;
	tabLabel?: string;
	dropOver?: { name: string; before: boolean } | null;
	depth?: number;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `group-${group.id}`, data: { kind: 'group', gid: group.id } });
	const [open, setOpen] = useState(true);
	const groupFields = group.fieldNames.map((n) => fields.find((f) => f.name === n)).filter(Boolean) as FieldDefinition[];
	const nested = group.groups ?? [];
	const activeHere = isActive ?? group.id === activeGroupId;
	// Candidate parents for "Move into group" — everything in the tab except this group and its own subtree.
	const subtreeIds = new Set<string>([group.id]);
	const collectSub = (gs: FormGroup[]) => {
		for (const g of gs) {
			subtreeIds.add(g.id);
			if (g.groups?.length) collectSub(g.groups);
		}
	};
	collectSub(nested);
	const moveTargets = (groupOptions ?? []).filter((o) => o.tab === tabLabel && !subtreeIds.has(o.id));

	return (
		<div
			ref={setNodeRef}
			data-group-id={group.id}
			style={{
				border: `1px dashed ${isOver ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-border, #e5e7eb)'}`,
				borderRadius: 10,
				padding: '0.75rem',
				background: isOver ? 'var(--mmbix-muted, #f0fdfa)' : 'transparent',
				transition: 'border-color 0.15s, background 0.15s',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem' }}>
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					title={open ? 'Collapse group' : 'Expand group'}
					style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
				>
					<ChevronDown
						size={13}
						style={{
							transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
							transition: 'transform 0.15s',
							color: 'var(--mmbix-muted-foreground, #9ca3af)',
						}}
					/>
				</button>
				<button
					type="button"
					onClick={() => onSelectGroup?.(group.id)}
					onKeyDown={(e) => {
						// ↑ / ↓ reorder this group within its parent (tab groups or nested sub-groups).
						if (e.key === 'ArrowUp') {
							e.preventDefault();
							onMoveGroup?.(group.id, -1);
						} else if (e.key === 'ArrowDown') {
							e.preventDefault();
							onMoveGroup?.(group.id, 1);
						}
					}}
					title="Edit group properties — ↑/↓ reorders the group"
					tabIndex={activeHere ? 0 : -1}
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 5,
						border: 'none',
						background: 'none',
						cursor: 'pointer',
						padding: 0,
						textAlign: 'left',
						outline: 'none',
						borderRadius: 4,
					}}
				>
					<GroupIcon name={group.icon} size={13} />
					<strong style={{ fontSize: '0.8rem', color: activeHere ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-foreground, #111827)' }}>
						{group.title}
					</strong>
				</button>
				{onAddSubGroup && (
					<DropdownMenu>
						<DropdownMenuTrigger
							title="Group actions"
							onClick={(e) => e.stopPropagation()}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: 24,
								height: 24,
								borderRadius: 5,
								border: 'none',
								background: 'transparent',
								color: '#9ca3af',
								cursor: 'pointer',
								marginLeft: 'auto',
								flexShrink: 0,
							}}
						>
							<MoreVertical size={13} />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" sideOffset={4} style={{ minWidth: 190 }}>
							<DropdownMenuItem
								onClick={(e) => {
									e.stopPropagation();
									onAddSubGroup(group.id);
								}}
							>
								<Plus size={13} /> Add sub-group
							</DropdownMenuItem>
							{moveTargets.length > 0 && onMoveGroupUnder && (
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<CornerDownRight size={13} /> Move into group
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent sideOffset={4}>
										{moveTargets.map((opt) => (
											<DropdownMenuItem key={opt.id} onClick={() => onMoveGroupUnder(group.id, opt.id)}>
												{opt.title || 'Untitled'}
											</DropdownMenuItem>
										))}
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							)}
							{depth > 0 && onPromoteGroup && (
								<DropdownMenuItem onClick={() => onPromoteGroup(group.id)}>
									<MoveUp size={13} /> Make top-level
								</DropdownMenuItem>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => onRemoveGroup?.(group.id)} style={{ color: '#dc2626' }}>
								<Trash2 size={13} /> Delete group
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
			{!open ? null : (
				<>
					{groupFields.length > 0 ? (
						<div
							onKeyDown={(e) => {
								// Events bubble up from nested groups — each group owns its own subtree.
								const origin = (e.target as HTMLElement | null)?.closest?.('[data-group-id]') as HTMLElement | null;
								if (origin && origin.dataset.groupId !== group.id) return;
								if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
								if (!selected) return;
								const key = e.key.toLowerCase();
								// WASD: MOVE the selected field (swap with the visually adjacent field in that direction).
								if (!e.ctrlKey && !e.metaKey && (key === 'w' || key === 's' || key === 'a' || key === 'd')) {
									e.preventDefault();
									const dir = key === 'w' ? 'ArrowUp' : key === 's' ? 'ArrowDown' : key === 'a' ? 'ArrowLeft' : 'ArrowRight';
									const neighbor = directionalNeighbor(groupFields, selected, dir);
									if (neighbor) {
										onSwap?.(selected, neighbor);
										// Keep focus on the moved field so repeated presses keep working.
										requestAnimationFrame(() => (document.querySelector(`[data-field-id="${selected}"]`) as HTMLElement | null)?.focus());
									}
									return;
								}
								// 1 – 6: set the SELECTED field's grid span (1–6 columns) inside its group.
								if (['1', '2', '3', '4', '5', '6'].includes(key)) {
									e.preventDefault();
									onFieldSpan?.(selected, Math.max(1, Math.min(Math.max(1, group.columns || 2), Number(key))));
									return;
								}
								// Delete / Backspace: remove the selected field from the layout.
								if (e.key === 'Delete' || e.key === 'Backspace') {
									e.preventDefault();
									onRemove(selected);
									return;
								}
								// Ctrl/Cmd+D: duplicate the selected field.
								if ((e.ctrlKey || e.metaKey) && key === 'd') {
									e.preventDefault();
									onDuplicate(selected);
									return;
								}
								// Arrows: move FOCUS to the visually adjacent field (selection follows).
								if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
								const next = directionalNeighbor(groupFields, selected, e.key as 'ArrowRight' | 'ArrowLeft' | 'ArrowDown' | 'ArrowUp');
								if (next) {
									e.preventDefault();
									onSelect(group.id, next);
									requestAnimationFrame(() => (document.querySelector(`[data-field-id="${next}"]`) as HTMLElement | null)?.focus());
								}
							}}
							style={{ display: 'grid', gridTemplateColumns: `repeat(${group.columns}, 1fr)`, gap: 8 }}
						>
							{groupFields.map((f) => (
								<FieldChip
									key={f.name}
									field={f}
									selected={selected === f.name}
									span={fieldSpanOf(group, f.name, isTextareaField(f.type))}
									columns={group.columns}
									groupId={group.id}
									groupOptions={groupOptions}
									dropBefore={dropOver?.name === f.name ? dropOver.before : null}
									onSelect={() => onSelect(group.id, f.name)}
									onFieldSpan={onFieldSpan}
									onMoveField={onMoveField}
									onDuplicate={onDuplicate}
									onRemove={onRemove}
								/>
							))}
						</div>
					) : nested.length === 0 ? (
						<p style={{ margin: 0, fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center', padding: '1rem 0' }}>Drop fields here</p>
					) : null}
					{nested.length > 0 && (
						<div
							style={{
								marginTop: 10,
								display: 'flex',
								flexDirection: 'column',
								gap: 8,
								paddingLeft: depth * 14,
								borderLeft: depth > 0 ? '2px solid var(--mmbix-border, #e5e7eb)' : 'none',
							}}
						>
							{nested.map((sg) => (
								<CanvasGroup
									key={sg.id}
									group={sg}
									fields={fields}
									selected={selected}
									activeGroupId={activeGroupId}
									depth={depth + 1}
									dropOver={dropOver}
									onSelect={onSelect}
									onSelectGroup={onSelectGroup}
									onRemove={onRemove}
									onMove={onMove}
									onDuplicate={onDuplicate}
									onSwap={onSwap}
									onFieldSpan={onFieldSpan}
									onMoveGroup={onMoveGroup}
									onAddSubGroup={onAddSubGroup}
									onRemoveGroup={onRemoveGroup}
									onPromoteGroup={onPromoteGroup}
									onMoveGroupUnder={onMoveGroupUnder}
									onMoveField={onMoveField}
									groupOptions={groupOptions}
								/>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}

/** Canvas tab — droppable: drag a field chip onto a tab to move it there.
 *  Roving tab stop: only the active tab is in the Tab order; arrows move it (handled by the tab strip). */
export function CanvasTab({
	tab,
	active,
	onSelect,
	onRename,
	onRemove,
}: {
	tab: FormTab;
	active: boolean;
	onSelect: () => void;
	onRename: (label: string) => void;
	onRemove?: () => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `tab-${tab.id}`, data: { kind: 'tab', tid: tab.id } });
	return (
		<div
			ref={setNodeRef}
			data-tab-id={tab.id}
			onClick={onSelect}
			title="Click to open — drag a field chip onto a tab to move it"
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 4,
				padding: '0.25rem 0.5rem',
				borderRadius: '8px 8px 0 0',
				border: '1px solid transparent',
				borderBottom: 'none',
				background: isOver ? 'var(--mmbix-muted, #f0fdfa)' : 'transparent',
				cursor: 'pointer',
				transition: 'border-color 0.12s, background 0.12s',
			}}
		>
			{active ? (
				<Input
					value={tab.label}
					onChange={(e) => onRename(e.target.value)}
					onClick={(e) => e.stopPropagation()}
					style={{ width: 92, height: 26, fontSize: '0.75rem', padding: '0 6px' }}
				/>
			) : (
				<span
					style={{
						fontSize: '0.78rem',
						fontWeight: 600,
						color: active ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-foreground, #374151)',
					}}
				>
					{tab.label}
				</span>
			)}
			{active && onRemove && (
				<Button
					variant="ghost"
					size="icon-xs"
					onClick={(e) => {
						e.stopPropagation();
						onRemove();
					}}
					title="Delete tab"
				>
					<Trash2 size={11} style={{ color: '#dc2626' }} />
				</Button>
			)}
		</div>
	);
}

/** Field chip on the canvas — selectable, droppable (target for drag-moves).
 *  Roving tab stop: the selected chip is the tab stop. Actions are keyboard-only
 *  (WASD move, 1–4 span, Delete remove, Ctrl+D duplicate, arrows move focus);
 *  the kebab menu offers Move to group / Duplicate / Remove field. */
export function FieldChip({
	field,
	selected,
	span,
	columns,
	groupId,
	groupOptions,
	dropBefore,
	onSelect,
	onFieldSpan,
	onMoveField,
	onDuplicate,
	onRemove,
}: {
	field: FieldDefinition;
	selected: boolean;
	span?: number;
	columns?: number;
	groupId?: string;
	groupOptions?: Array<{ id: string; title: string; tab: string }>;
	dropBefore?: boolean | null;
	onSelect: () => void;
	onFieldSpan?: (name: string, span: number) => void;
	onMoveField?: (name: string, gid: string) => void;
	onDuplicate?: (name: string) => void;
	onRemove?: (name: string) => void;
}) {
	const { setNodeRef, isOver } = useDroppable({ id: `field-${field.name}`, data: { kind: 'field', name: field.name } });
	const cols = Math.max(1, columns || 2);
	const full = (span ?? 1) >= cols;
	const isDropTarget = dropBefore !== null && dropBefore !== undefined;
	const moveTargets = (groupOptions ?? []).filter((g) => g.id !== groupId);
	// Required fields keep a darker label; optional ones a medium gray — both regular weight.
	const requiredStyle = field.required
		? { color: 'var(--mmbix-foreground, #111827)', fontWeight: 500 }
		: { color: '#6b7280', fontWeight: 500 };
	const cell = { gridColumn: full ? '1 / -1' : `span ${Math.min(Math.max(1, span ?? 1), cols)}`, minWidth: 0 };
	return (
		<div style={cell}>
			<ContextMenu>
				<ContextMenuTrigger>
					<div
						ref={setNodeRef}
						data-field-id={field.name}
						tabIndex={selected ? 0 : -1}
						onClick={onSelect}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onSelect();
								return;
							}
							// Width shortcuts — handled HERE on the focused chip (before any wrapper
							// can swallow the key), clamped to the group's column count:
							// plain 1–6 → span N, Shift+1–6 → 2N, Alt+Shift+1–6 → N.
							const spanN = spanShortcut(e);
							if (spanN !== null) {
								e.preventDefault();
								onFieldSpan?.(field.name, Math.max(1, Math.min(Math.max(1, columns || 2), spanN)));
							}
						}}
						style={{
							outline: 'none',
							border: `1px solid ${selected || isDropTarget ? 'var(--mmbix-primary, #2563eb)' : isOver ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-border, #e5e7eb)'}`,
							borderRadius: 8,
							padding: '0.5rem 0.6rem',
							background: selected || isDropTarget ? 'var(--mmbix-muted, #f0fdfa)' : 'var(--mmbix-card, #ffffff)',
							boxShadow: isDropTarget
								? `inset 0 ${dropBefore ? 2 : -2}px 0 var(--mmbix-primary, #2563eb)`
								: selected
									? '0 0 0 2px rgba(15, 118, 110, 0.15)'
									: 'none',
							cursor: 'pointer',
							transition: 'border-color 0.12s, box-shadow 0.12s',
						}}
					>
						<div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
							<FieldTypeIcon type={field.type} size={14} />
							<span style={{ fontSize: '0.82rem', ...requiredStyle }}>
								{field.label || field.name}
								{field.required ? ' *' : ''}
							</span>
							<Badge variant="outline" style={{ marginLeft: 'auto' }}>
								{field.type}
							</Badge>
							{onMoveField && (
								<DropdownMenu>
									<DropdownMenuTrigger
										title="Field actions"
										onClick={(e) => e.stopPropagation()}
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											justifyContent: 'center',
											width: 20,
											height: 20,
											borderRadius: 4,
											border: 'none',
											background: 'transparent',
											color: '#9ca3af',
											cursor: 'pointer',
											flexShrink: 0,
											padding: 0,
										}}
									>
										<MoreVertical size={12} />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={4} style={{ minWidth: 180 }}>
										{moveTargets.length > 0 && (
											<DropdownMenuSub>
												<DropdownMenuSubTrigger>
													<CornerDownRight size={13} /> Move to group
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent sideOffset={4}>
													{moveTargets.map((g) => (
														<DropdownMenuItem key={g.id} onClick={() => onMoveField(field.name, g.id)}>
															<span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
																<span>{g.title || 'Untitled'}</span>
																<span style={{ fontSize: '0.62rem', color: '#9ca3af', marginLeft: 'auto' }}>{g.tab}</span>
															</span>
														</DropdownMenuItem>
													))}
												</DropdownMenuSubContent>
											</DropdownMenuSub>
										)}
										<DropdownMenuItem onClick={() => onDuplicate?.(field.name)}>
											<Copy size={13} /> Duplicate
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem onClick={() => onRemove?.(field.name)} style={{ color: '#dc2626' }}>
											<Trash2 size={13} /> Remove field
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</div>
						{field.help && <span style={{ fontSize: '0.65rem', color: '#9ca3af', display: 'block', marginTop: 2 }}>{field.help}</span>}
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent sideOffset={4} style={{ minWidth: 190 }}>
					{onDuplicate && (
						<ContextMenuItem onClick={() => onDuplicate(field.name)}>
							<Copy size={13} /> Duplicate
						</ContextMenuItem>
					)}
					{onRemove && (
						<>
							<ContextMenuSeparator />
							<ContextMenuItem onClick={() => onRemove(field.name)} variant="destructive">
								<Trash2 size={13} /> Remove from layout
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
		</div>
	);
}
