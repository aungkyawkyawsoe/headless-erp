/**
 * The app workbench's top bar — back-to-catalog, the identity chip, the
 * collection/menu/builder section switcher, the table/schema view toggle, the
 * builder save action and Manage. Extracted out of the AppDetailPage so the app
 * chrome has one reason to change; behaviour unchanged.
 */
import { Avatar, AvatarFallback, Button } from '@mmbix/design-system';
import { Braces, ChevronLeft, Settings, Table2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { appColor } from '@mmbix/ui-views';
import { isIdpManagedModule } from '../../lib/idp';
import { popBack } from '../../lib/view-state';
import type { ModuleDetail } from '../../lib/api';
import AppIcon from '../AppIcon';
import { BuilderSaveButton } from './builder-parts';

/** Valid Studio sections — the AppDetailPage left/center/right panes. */
export type AppSection = 'collection' | 'menu' | 'builder';

export function AppWorkbenchHeader({
	mod,
	section,
	hasSelectedModel,
	view,
	onSectionChange,
	onViewChange,
	onManage,
}: {
	mod: ModuleDetail;
	section: AppSection;
	hasSelectedModel: boolean;
	view: 'table' | 'schema';
	onSectionChange: (section: AppSection) => void;
	onViewChange: (view: 'table' | 'schema') => void;
	onManage: () => void;
}) {
	const navigate = useNavigate();
	const bg = mod.bg_color ?? appColor(mod.slug);
	const fg = mod.icon_color ?? '#ffffff';
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem' }}>
			{/* Top-left back control — clicking the module identity (or the chevron)
			 * leaves the workbench for the Apps ModuleGrid (or the IDP catalog for
			 * IDP-managed modules). popBack pops the entry we were pushed from when
			 * one exists (grid/catalog), else replaces to the destination — it never
			 * stacks a second copy of the destination under this screen. */}
			<Button
				variant="ghost"
				style={{ padding: '0.25rem 0.5rem', marginLeft: '-0.5rem', height: 'auto' }}
				title={isIdpManagedModule(mod.slug) ? 'Back to IDP catalog' : 'Back to apps'}
				aria-label={isIdpManagedModule(mod.slug) ? 'Back to IDP catalog' : 'Back to apps'}
				onClick={() => popBack(navigate, isIdpManagedModule(mod.slug) ? '/idp/catalog' : '/')}
			>
				<ChevronLeft size={16} style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }} />
				<Avatar size="default" variant="square">
					<AvatarFallback style={{ background: bg, color: fg, fontWeight: 700 }}>
						<AppIcon name={mod.icon} size={18} />
					</AvatarFallback>
				</Avatar>
				<span style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{mod.name}</span>
			</Button>
			{/* App section switcher — same segmented style as the form builder view selector */}
			<div
				style={{
					display: 'flex',
					gap: 2,
					marginLeft: '1rem',
					padding: '0.2rem',
					borderRadius: 8,
					background: 'var(--mmbix-muted, #f3f4f6)',
					flexWrap: 'wrap',
				}}
			>
				{(['collection', 'menu', 'builder'] as const).map((v) => (
					<Button
						key={v}
						variant={section === v ? 'default' : 'ghost'}
						size="sm"
						onClick={() => onSectionChange(v)}
						style={{ textTransform: 'capitalize' }}
					>
						{v}
					</Button>
				))}
			</div>
			{/* Right-aligned controls — view toggle, builder save, and manage app stay
			 * grouped flush against the right edge (single margin-left:auto). */}
			<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
				{/* Table / Schema view toggle — icon-only, appears when a collection is focused */}
				{section === 'collection' && hasSelectedModel && (
					<div
						style={{
							display: 'flex',
							gap: 2,
							padding: '0.2rem',
							borderRadius: 8,
							background: 'var(--mmbix-muted, #f3f4f6)',
						}}
					>
						<Button
							variant={view === 'table' ? 'default' : 'ghost'}
							size="sm"
							title="Table view"
							onClick={() => onViewChange('table')}
							style={{ width: 28, padding: 0 }}
						>
							<Table2 size={14} />
						</Button>
						<Button
							variant={view === 'schema' ? 'default' : 'ghost'}
							size="sm"
							title="Schema view"
							onClick={() => onViewChange('schema')}
							style={{ width: 28, padding: 0 }}
						>
							<Braces size={14} />
						</Button>
					</div>
				)}
				{/* Builder save — page drafts persist from the app bar */}
				{section === 'builder' && <BuilderSaveButton />}
				{/* Manage app — rename / icon / colours for THIS module (same dialog the
				 * Apps grid uses, preloaded with the current module). */}
				<Button variant="ghost" size="sm" title="Manage app" onClick={onManage} style={{ gap: 6 }}>
					<Settings size={14} /> Manage
				</Button>
			</div>
		</div>
	);
}
