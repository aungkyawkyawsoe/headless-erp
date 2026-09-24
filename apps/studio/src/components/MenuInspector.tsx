import { useEffect, useState } from 'react';
import {
	Alert,
	AlertDescription,
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Input,
} from '@mmbix/design-system';
import { Check, ChevronsRight, MousePointerClick, Pencil } from 'lucide-react';
import { updateMenu, createMenu } from '../lib/api';
import IconPicker from './IconPicker';
import MenuIcon from './MenuIcon';
import { PropCombobox, PropRow, PropSection, Segmented } from './formlayout/properties';
import { useRightPane } from './StudioLayout';
import { useStudioMeta } from '../lib/studioMeta';
import type { Node } from './MenuBuilder';

/**
 * MenuInspector — tabbed properties of the selected menu item (right pane),
 * built on the shared property primitives (PropRow / PropSection / Segmented).
 *  Props: identity (label, type, icon).  Access: roles.
 * Saves via the menus API and asks the tree to reload.
 */
export default function MenuInspector({
	token,
	moduleSlug,
	node,
	targetOptions,
	onSaved,
}: {
	token: string;
	moduleSlug: string;
	node: Node | null;
	targetOptions: string[];
	onSaved: () => void;
}) {
	const [label, setLabel] = useState('');
	const [labelMy, setLabelMy] = useState('');
	const [type, setType] = useState<'group' | 'link'>('link');
	const [target, setTarget] = useState('');
	const [icon, setIcon] = useState('');
	const [roles, setRoles] = useState('');
	const [template, setTemplate] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [iconOpen, setIconOpen] = useState(false);
	const [tab, setTab] = useState<'props' | 'events'>('props');
	const { toggle } = useRightPane() ?? { toggle: () => {} };
	const { templates } = useStudioMeta();
	// Snapshot of the saved node values — the save button stays disabled until the form is dirty.
	const [orig, setOrig] = useState({
		label: '',
		label_my: '',
		type: 'link' as 'link' | 'group',
		target: '',
		icon: '',
		roles: '',
		template: '',
	});

	useEffect(() => {
		setOrig({
			label: node?.label ?? '',
			label_my: node?.label_my ?? '',
			type: node?.type === 'group' ? 'group' : 'link',
			target: node?.target ?? '',
			icon: (node?.icon ?? '').replace(/^lucide:/, ''),
			roles: (node?.roles ?? []).join(', '),
			template: node?.template ?? '',
		});
		setLabel(node?.label ?? '');
		setLabelMy(node?.label_my ?? '');
		setType(node?.type === 'group' ? 'group' : 'link');
		setTarget(node?.target ?? '');
		setIcon((node?.icon ?? '').replace(/^lucide:/, ''));
		setRoles((node?.roles ?? []).join(', '));
		setTemplate(node?.template ?? '');
		setError(null);
		setTab('props');
	}, [node]);

	if (!node) {
		return (
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					flex: 1,
					minHeight: 0,
					alignItems: 'center',
					justifyContent: 'center',
					padding: '1rem',
					gap: 8,
					textAlign: 'center',
				}}
			>
				<MousePointerClick size={22} style={{ color: '#9ca3af' }} />
				<p style={{ margin: 0, fontSize: '0.78rem', color: '#9ca3af' }}>Select a menu item to edit its properties.</p>
			</div>
		);
	}
	const current = node;

	const isGroup = type === 'group';
	// Dirty when any field differs from the last saved node values.
	const dirty =
		label !== orig.label ||
		labelMy !== orig.label_my ||
		type !== orig.type ||
		target !== orig.target ||
		icon !== orig.icon ||
		roles !== orig.roles ||
		template !== orig.template;

	async function save() {
		if (!label.trim() || busy) return;
		setBusy(true);
		try {
			const parsedRoles = roles
				.split(',')
				.map((r) => r.trim())
				.filter(Boolean);
			// A synthetic item (derived from the module's collections — id prefixed
			// `collection:`) has no DB row yet. Save it as a real menu item instead
			// of trying to PUT to a non-existent id.
			if (current.id.startsWith('collection:')) {
				await createMenu(token, moduleSlug, {
					label: label.trim(),
					label_my: labelMy.trim() || undefined,
					type,
					target: isGroup ? undefined : target.trim() || undefined,
					icon: icon || undefined,
					roles: parsedRoles,
					template: template || null,
				});
			} else {
				await updateMenu(token, current.id, {
					label: label.trim(),
					label_my: labelMy.trim() || undefined,
					type,
					target: isGroup ? undefined : target.trim() || undefined,
					icon: icon || undefined,
					roles: parsedRoles,
					template: template || null,
				});
			}
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: '1rem', padding: '1rem', overflowY: 'auto' }}>
			{/* Header: Properties label + collapse + circular save button at the right top. */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Button variant="ghost" size="icon-xs" title="Collapse pane" onClick={toggle}>
					<ChevronsRight size={13} />
				</Button>
				<span
					style={{
						fontSize: '0.72rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
						flex: 1,
					}}
				>
					Properties
				</span>
				<Button
					title="Save changes"
					aria-label="Save changes"
					onClick={save}
					disabled={!dirty || !label.trim() || busy}
					style={{ width: 28, height: 28, borderRadius: '50%', padding: 0, flexShrink: 0 }}
				>
					<Check size={14} />
				</Button>
			</div>

			{error && (
				<Alert variant="destructive" style={{ padding: '0.5rem 0.75rem' }}>
					<AlertDescription style={{ fontSize: '0.75rem' }}>{error}</AlertDescription>
				</Alert>
			)}

			{/* Icon preview + type badge */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
				<span
					style={{
						width: 34,
						height: 34,
						borderRadius: 9,
						background: 'var(--mmbix-muted, #f3f4f6)',
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: isGroup ? '#f59e0b' : '#6b7280',
						flexShrink: 0,
					}}
				>
					<MenuIcon name={icon} type={type} size={17} />
				</span>
				<div style={{ minWidth: 0 }}>
					<div style={{ fontSize: '0.88rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{label || 'Untitled'}
					</div>
					<Badge variant="outline" style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase' }}>
						{isGroup ? 'Group' : 'Link'}
					</Badge>
				</div>
			</div>

			{/* Tabs — adapt to the menu item's concerns: identity (Props) vs behaviour (Events). */}
			<div style={{ display: 'flex', gap: 2, padding: '0.2rem', borderRadius: 8, background: 'var(--mmbix-muted, #f3f4f6)' }}>
				{(['props', 'events'] as const).map((t) => (
					<Button
						key={t}
						variant={tab === t ? 'default' : 'ghost'}
						size="xs"
						onClick={() => setTab(t)}
						style={{ flex: 1, textTransform: 'capitalize' }}
					>
						{t}
					</Button>
				))}
			</div>

			{tab === 'props' ? (
				<>
					<PropSection title="Identity" defaultOpen>
						<PropRow label="Label">
							<Input
								id="mi-label"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="Menu label"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow label="Label (Myanmar)" hint="Optional — shown when the app language is Myanmar.">
							<Input
								id="mi-label-my"
								value={labelMy}
								onChange={(e) => setLabelMy(e.target.value)}
								placeholder="Optional"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow label="Type" hint="Groups are navigation folders; links open a target.">
							<Segmented
								value={type}
								options={[
									{ value: 'link', label: 'Link' },
									{ value: 'group', label: 'Group' },
								]}
								onChange={(v) => setType(v === 'group' ? 'group' : 'link')}
							/>
						</PropRow>
					</PropSection>
					<PropSection title="Appearance">
						<PropRow label="Icon" hint="Shown next to the label in the app sidebar.">
							<button
								type="button"
								onClick={() => setIconOpen(true)}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									width: '100%',
									padding: '0.4rem 0.55rem',
									borderRadius: 8,
									border: '1px solid var(--mmbix-border, #e5e7eb)',
									background: 'var(--mmbix-card, #ffffff)',
									cursor: 'pointer',
									color: 'var(--mmbix-foreground, #374151)',
									fontSize: '0.78rem',
								}}
							>
								<span style={{ display: 'inline-flex', color: isGroup ? '#f59e0b' : '#6b7280', flexShrink: 0 }}>
									<MenuIcon name={icon} type={type} size={15} />
								</span>
								<span
									style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
								>
									{icon ? icon.replace(/^lucide:/, '') : isGroup ? 'folder-open' : 'link'}
								</span>
								<Pencil size={12} style={{ color: '#9ca3af', flexShrink: 0 }} />
							</button>
						</PropRow>
					</PropSection>
				</>
			) : (
				<>
					{!isGroup && (
						<PropSection title="Navigation" defaultOpen>
							<PropRow label="Navigate to" hint="The route this menu item opens in the app.">
								<Input
									id="mi-target"
									list="mi-target-options"
									value={target}
									onChange={(e) => setTarget(e.target.value)}
									placeholder="/sales/orders"
									style={{ height: 28, fontSize: '0.8rem' }}
								/>
								<datalist id="mi-target-options">
									{targetOptions.map((o) => (
										<option key={o} value={o} />
									))}
								</datalist>
							</PropRow>
							<PropRow label="View template" hint="Which views the builder exposes for this menu — saved per menu item.">
								<PropCombobox
									value={template}
									options={[{ value: '', label: 'Default — not set' }, ...templates.map((t) => ({ value: t.key, label: t.label }))]}
									onChange={(v) => setTemplate(v)}
									placeholder="Default — not set"
								/>
							</PropRow>
							{targetOptions.length > 0 && (
								<PropRow label="Available routes">
									<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
										{targetOptions.slice(0, 12).map((o) => (
											<Button
												key={o}
												variant="outline"
												size="xs"
												title={`Set target to ${o}`}
												onClick={() => setTarget(o)}
												style={{ fontSize: '0.6rem', height: 22, padding: '0 0.4rem' }}
											>
												{o}
											</Button>
										))}
									</div>
								</PropRow>
							)}
						</PropSection>
					)}
					<PropSection title="Access">
						<PropRow label="Visible to roles" hint="Comma-separated role names. Empty = visible to everyone.">
							<Input
								id="mi-roles"
								value={roles}
								onChange={(e) => setRoles(e.target.value)}
								placeholder="Administrator, Sales Manager"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
					</PropSection>
					{isGroup && (
						<p style={{ margin: 0, fontSize: '0.76rem', color: '#9ca3af' }}>
							Groups are navigation folders — they don't navigate anywhere.
						</p>
					)}
				</>
			)}

			{/* Icon picker dialog — opens on the compact icon field above. */}
			<Dialog open={iconOpen} onOpenChange={setIconOpen}>
				<DialogContent style={{ maxWidth: 480 }}>
					<DialogHeader>
						<DialogTitle>Choose icon</DialogTitle>
						<DialogDescription>Search and pick a lucide icon for this menu item.</DialogDescription>
					</DialogHeader>
					<IconPicker
						value={icon}
						onChange={(name) => {
							setIcon(name);
							setIconOpen(false);
						}}
					/>
					<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
						<Button variant="ghost" size="sm" onClick={() => setIconOpen(false)}>
							Cancel
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
