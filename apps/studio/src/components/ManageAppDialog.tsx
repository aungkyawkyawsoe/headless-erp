import { useEffect, useState } from 'react';
import {
	Badge,
	Button,
	ColorPicker,
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
	Popover,
	PopoverContent,
	PopoverTrigger,
	RadioGroup,
	RadioGroupItem,
} from '@mmbix/design-system';
import { Plus, Pencil } from 'lucide-react';
import { createModule, updateModule, type ModuleInfo } from '../lib/api';
import AppIcon from './AppIcon';
import IconPicker from './IconPicker';
import { appColor } from '@mmbix/ui-views';

type Mode = 'new' | 'existing';

/** Auto-generate a slug from a human-readable name, e.g. "Sales CRM" → "sales-crm". */
function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Stack a label above its control with consistent spacing. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 0 }}>
			<Label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{label}</Label>
			{children}
		</div>
	);
}

/** One vertical swatch control in the preview rail. */
function Swatch({ title, color, icon, children }: { title: string; color?: string; icon?: React.ReactNode; children: React.ReactNode }) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						type="button"
						title={title}
						style={{
							width: 30,
							height: 30,
							borderRadius: 8,
							cursor: 'pointer',
							background: color ?? 'var(--mmbix-muted, #e5e7eb)',
							color: 'var(--mmbix-foreground, #374151)',
							border: '2px solid #fff',
							boxShadow: '0 0 0 1px var(--mmbix-border, #d1d5db)',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							padding: 0,
						}}
					>
						{icon}
					</button>
				}
			/>
			<PopoverContent>{children}</PopoverContent>
		</Popover>
	);
}

interface ManageAppDialogProps {
	token: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	modules: ModuleInfo[];
	/** Preselect a mode when the dialog opens. */
	initialMode?: Mode;
	/** Preselect an existing app (loads its values into the form). */
	initialSlug?: string;
	/** Called after a successful create/update so the parent refreshes. */
	onSaved: () => void;
}

/** Create a new app or edit an existing one (rename / icon / colors). */
export default function ManageAppDialog({
	token,
	open,
	onOpenChange,
	modules,
	initialMode = 'new',
	initialSlug,
	onSaved,
}: ManageAppDialogProps) {
	const [mode, setMode] = useState<Mode>(initialMode);
	const [editSlug, setEditSlug] = useState('');
	const [name, setName] = useState('');
	const [description, setDescription] = useState('');
	const [icon, setIcon] = useState('box');
	const [iconColor, setIconColor] = useState('#ffffff');
	const [bgColor, setBgColor] = useState('#3b82f6');
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	// When opened with a preset app, load it into the form (existing mode).
	useEffect(() => {
		if (!open) return;
		setMode(initialMode);
		setEditSlug('');
		setName('');
		setDescription('');
		setIcon('box');
		setIconColor('#ffffff');
		setBgColor('#3b82f6');
		setError(null);
		if (initialMode === 'existing' && initialSlug) {
			pickExisting(initialSlug);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, initialMode, initialSlug]);

	function pickExisting(nextSlug: string) {
		setEditSlug(nextSlug);
		const m = modules.find((x) => x.slug === nextSlug);
		if (m) {
			setName(m.name);
			setDescription(m.description ?? '');
			setIcon((m.icon ?? 'lucide:box').replace(/^lucide:/, ''));
			setIconColor(m.icon_color ?? '#ffffff');
			setBgColor(m.bg_color ?? appColor(m.slug));
		}
	}

	async function save(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(null);
		try {
			const colors = { icon_color: iconColor, bg_color: bgColor };
			if (mode === 'new') {
				const autoSlug = slugify(name.trim());
				if (!name.trim() || !autoSlug) throw new Error('Name is required');
				await createModule(token, name.trim(), autoSlug, {
					description: description.trim() || undefined,
					icon: `lucide:${icon}`,
					...colors,
				});
			} else {
				if (!editSlug) throw new Error('Choose an app to edit');
				await updateModule(token, editSlug, {
					name: name.trim(),
					description: description.trim() || undefined,
					icon: `lucide:${icon}`,
					...colors,
				});
			}
			onOpenChange(false);
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent style={{ maxWidth: 760, width: 'calc(100vw - 3rem)' }}>
				<DialogHeader>
					<DialogTitle>Manage App</DialogTitle>
					<DialogDescription>Create a new app or edit an existing one — rename it or restyle its icon.</DialogDescription>
				</DialogHeader>
				<form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
					<RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} style={{ display: 'flex', gap: '1.5rem' }}>
						<label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
							<RadioGroupItem value="new" /> <Plus size={13} style={{ color: '#9ca3af' }} /> New app
						</label>
						<label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
							<RadioGroupItem value="existing" /> <Pencil size={13} style={{ color: '#9ca3af' }} /> Existing app
						</label>
					</RadioGroup>

					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
						{/* Left column: fields */}
						<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
							<Field label="Name">
								<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="HR Management" required />
							</Field>

							{mode === 'existing' ? (
								<Field label="App">
									<Combobox
										value={editSlug || null}
										items={modules.map((m) => m.slug)}
										onValueChange={(v) => {
											if (v) pickExisting(String(v));
										}}
										onInputValueChange={() => {}}
										itemToStringLabel={(v) => {
											const m = modules.find((x) => x.slug === String(v));
											return m ? `${m.name} (${m.slug})` : String(v);
										}}
									>
										<ComboboxInput showTrigger placeholder="Search apps…" style={{ width: '100%' }} />
										<ComboboxContent align="start" sideOffset={4} style={{ width: 300 }}>
											<ComboboxList>
												{(item: string) => {
													const m = modules.find((x) => x.slug === item);
													return (
														<ComboboxItem key={item} value={item}>
															{m ? `${m.name} (${m.slug})` : item}
														</ComboboxItem>
													);
												}}
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								</Field>
							) : (
								<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>
									Slug is generated automatically from the name.
								</p>
							)}

							<Field label="Description">
								<Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
							</Field>

							{mode === 'existing' && editSlug && (
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 6,
										fontSize: '0.75rem',
										color: 'var(--mmbix-muted-foreground, #6b7280)',
									}}
								>
									Editing <Badge variant="outline">{editSlug}</Badge> — the slug stays fixed.
								</div>
							)}
						</div>

						{/* Right column: preview + swatch rail, side by side */}
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: '1.5rem',
								padding: '1rem',
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 12,
								background: 'var(--mmbix-muted, #f9fafb)',
							}}
						>
							<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
								<div
									style={{
										width: 88,
										height: 88,
										borderRadius: 18,
										background: bgColor,
										color: iconColor,
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										boxShadow: `0 4px 12px ${bgColor}55`,
										transition: 'background 0.15s, color 0.15s',
									}}
								>
									<AppIcon name={icon} size={44} />
								</div>
								<span
									style={{
										fontSize: '0.78rem',
										fontWeight: 600,
										maxWidth: 110,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
								>
									{name || 'App name'}
								</span>
							</div>
							<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
								<Swatch title="Icon colour" color={iconColor}>
									<ColorPicker value={iconColor} onChange={setIconColor} />
								</Swatch>
								<Swatch title="Background colour" color={bgColor}>
									<ColorPicker value={bgColor} onChange={setBgColor} />
								</Swatch>
								<Swatch
									title="Choose icon"
									icon={
										<span style={{ color: '#6b7280', display: 'inline-flex' }}>
											<AppIcon name={icon} size={16} />
										</span>
									}
								>
									<IconPicker value={icon} onChange={setIcon} />
								</Swatch>
								<span style={{ fontSize: '0.68rem', color: '#9ca3af', textAlign: 'center' }}>Icon · BG · Picker</span>
							</div>
						</div>
					</div>

					{error && <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: 0 }}>{error}</p>}

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving || (mode === 'existing' && !editSlug)}>
							{saving ? 'Saving…' : mode === 'new' ? 'Create' : 'Save changes'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
