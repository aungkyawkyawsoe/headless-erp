/**
 * App builder — extracted layout/action pieces.
 *
 * Pulled out of the (large) `AppDetailPage` so the builder's chrome (layout
 * wrapper, left/right panes, save action, menu-tree adapter) lives on its own.
 * Behaviour is unchanged.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '@mmbix/design-system';
import { Menu, Palette } from 'lucide-react';
import type { MenuNode as ApiMenuNode } from '../../lib/api';
import { ComponentCatalog } from '../ComponentCatalog';
import { type Node as MenuNode } from '../MenuBuilder';
import { BuilderMenu, PageProperties, useDataCollection, useFormLayoutActive } from '../PageBuilder';
import { useBuilder } from '../PageBuilderContext';
import { FormLayoutProvider, FormLayoutInspector, useFormLayout } from '../formlayout';

/** Wraps the builder's StudioLayout in the form-layout engine while Layout mode edits a focused collection's form. */
export function BuilderFormLayout({ token, children }: { token: string; children: ReactNode }) {
	const active = useFormLayoutActive();
	const collection = useDataCollection();
	const { fetchSchema } = useBuilder();
	if (!active || !collection) return <>{children}</>;
	return (
		<FormLayoutProvider key={collection} token={token} collection={collection} onSaved={() => void fetchSchema(collection)}>
			{children}
		</FormLayoutProvider>
	);
}

/** Builder left column — tabs: Menu (binds collections in the canvas) or Component (catalog). */
export function BuilderLeftPane({ tree }: { tree: MenuNode[] }) {
	const [tab, setTab] = useState<'menu' | 'component'>('menu');
	const tabBtn = (active: boolean) =>
		({
			display: 'inline-flex',
			alignItems: 'center',
			gap: 5,
			padding: '0.28rem 0.6rem',
			borderRadius: 7,
			border: 'none',
			cursor: 'pointer',
			fontSize: '0.72rem',
			fontWeight: 600,
			color: active ? '#fff' : '#64748b',
			background: active ? 'var(--mmbix-primary, #2563eb)' : 'transparent',
		}) as const;
	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div style={{ display: 'flex', gap: 2, padding: '0.45rem 0.5rem', borderBottom: '1px solid var(--mmbix-border, #e5e7eb)' }}>
				<button type="button" style={tabBtn(tab === 'menu')} onClick={() => setTab('menu')}>
					<Menu size={12} /> Menu
				</button>
				<button type="button" style={tabBtn(tab === 'component')} onClick={() => setTab('component')}>
					<Palette size={12} /> Component
				</button>
			</div>
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{tab === 'menu' ? <BuilderMenu tree={tree} /> : <ComponentCatalog />}</div>
		</div>
	);
}

/** Builder right column: designer → page properties; layout+form → field inspector. */
export function BuilderRightPane() {
	const active = useFormLayoutActive();
	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			{active ? <FormLayoutInspector /> : <PageProperties />}
		</div>
	);
}

/** App-bar save — visible in the studio header while editing a page draft.
 *  Form-layout edits (form view) and page edits (table/designer view) both enable it. */
export function BuilderSaveButton() {
	const { save: savePage, saving: pageSaving, dirty: pageDirty } = useBuilder();
	const fl = useFormLayout();
	const dirty = fl ? fl.dirty || pageDirty : pageDirty;
	const saving = fl ? fl.saving : pageSaving;
	const onSave = async () => {
		if (fl?.dirty) await fl.save();
		if (pageDirty) await savePage();
	};
	return (
		<Button onClick={() => void onSave()} disabled={saving || !dirty} size="sm" style={{ marginLeft: 'auto' }}>
			{saving ? 'Saving…' : 'Save'}
		</Button>
	);
}

/** Backend menu rows → the editable tree the MenuBuilder renders. */
export function toMenuTree(nodes: ApiMenuNode[], parentId: string | null): MenuNode[] {
	return nodes.map((n) => ({
		id: n.id,
		label: n.label,
		label_my: n.label_my,
		type: n.type,
		target: n.target,
		icon: n.icon,
		roles: n.roles,
		template: n.template,
		parentId,
		children: toMenuTree(n.children ?? [], n.id),
	}));
}
