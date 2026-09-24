import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppShell, Badge, Button, StatusBar, type Module, type NavMainItem } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import {
	BookOpen,
	Blocks,
	Activity,
	Box,
	Component,
	Database,
	KeyRound,
	Layers,
	LayoutGrid,
	LayoutTemplate,
	Package,
	Paintbrush,
	Palette,
	RefreshCw,
	Save,
	Settings,
	ShieldCheck,
	Trash2,
	Users,
	Zap,
} from 'lucide-react';
import { dsIcon, useStudioMeta, useStudioMetaRefresh, type DesignComponent } from '../lib/studioMeta';
import { appColor, smartIconFor } from '@mmbix/ui-views';
import { authedFetch } from '../lib/api';
import { modulesQuery } from '../lib/queries';
import { useMe } from '../lib/use-me';
import { isIdpManagedModule } from '../lib/idp';
import { TemplatesTab } from '../components/admin/templates-tab';
import { StylesTab } from '../components/admin/styles-tab';
import { EventsTab } from '../components/admin/events-tab';
import { DsExportsTab } from '../components/admin/ds-exports-tab';
import { ViewModesTab } from '../components/admin/view-modes-tab';
import { StudioConfigTab } from '../components/admin/studio-config-tab';
import { ComponentEditor } from '../components/admin/component-editor';
import { TokensTab } from '../components/admin/tokens-tab';
import { ApiKeysTab } from '../components/admin/api-keys-tab';
import { AddonsTab } from '../components/admin/addons-tab';
import { OperationsTab } from '../components/admin/operations-tab';
import { RolesTab } from '../components/admin/roles-tab';
import { UsersTab } from '../components/admin/users-tab';

/** Admin tabs — label per tab (drives the shell breadcrumb trail). */
const TAB_LABELS: Record<TabId, string> = {
	components: 'Components',
	templates: 'Templates',
	styles: 'Styles',
	events: 'Events',
	viewmodes: 'View Modes',
	config: 'Config',
	dsexports: 'DS Exports',
	addons: 'Add-ons',
	operations: 'Operations',
	tokens: 'Design Tokens',
	apikeys: 'API Keys',
	roles: 'Roles & Access',
	users: 'Users',
};

type TabId =
	| 'components'
	| 'templates'
	| 'styles'
	| 'events'
	| 'viewmodes'
	| 'config'
	| 'dsexports'
	| 'addons'
	| 'operations'
	| 'tokens'
	| 'apikeys'
	| 'roles'
	| 'users';

/** The settings-page module grid: the REAL app modules (HRM/WMS/…) fetched from
 *  the API plus the Settings tile — nothing hardcoded. */
const SETTINGS_MODULE: Module = { name: 'Settings', icon: Settings, iconBackground: '#64748b' };
/** IDP + API Docs as top-level destinations in the Studio shell's module switcher. */
const IDP_MODULE: Module = { name: 'IDP', icon: Layers, iconBackground: '#8b5cf6' };
const API_DOCS_MODULE: Module = { name: 'API Docs', icon: BookOpen, iconBackground: '#0ea5e9' };

/** Sidebar nav for the settings page — the admin tabs, one per nav item.
 *  Clicking one switches the active tab (they are not app routes). `adminOnly`
 *  tabs are hidden unless the session is the administrator (RBAC-aware UI). */
const ADMIN_NAV: Array<NavMainItem & { tab: TabId; adminOnly?: boolean }> = [
	{ tab: 'components', title: TAB_LABELS.components, url: '#', icon: Component },
	{ tab: 'templates', title: TAB_LABELS.templates, url: '#', icon: LayoutTemplate },
	{ tab: 'styles', title: TAB_LABELS.styles, url: '#', icon: Palette },
	{ tab: 'events', title: TAB_LABELS.events, url: '#', icon: Zap, adminOnly: true },
	{ tab: 'viewmodes', title: TAB_LABELS.viewmodes, url: '#', icon: LayoutGrid },
	{ tab: 'config', title: TAB_LABELS.config, url: '#', icon: Database, adminOnly: true },
	{ tab: 'dsexports', title: TAB_LABELS.dsexports, url: '#', icon: Package, adminOnly: true },
	{ tab: 'addons', title: TAB_LABELS.addons, url: '#', icon: Blocks, adminOnly: true },
	{ tab: 'operations', title: TAB_LABELS.operations, url: '#', icon: Activity, adminOnly: true },
	{ tab: 'tokens', title: TAB_LABELS.tokens, url: '#', icon: Paintbrush },
	{ tab: 'apikeys', title: TAB_LABELS.apikeys, url: '#', icon: KeyRound, adminOnly: true },
	{ tab: 'roles', title: TAB_LABELS.roles, url: '#', icon: ShieldCheck, adminOnly: true },
	{ tab: 'users', title: TAB_LABELS.users, url: '#', icon: Users, adminOnly: true },
];

/** Tabs that require the administrator role (mirrors the API's requireAdmin). */
const ADMIN_ONLY_TABS = new Set<TabId>(['events', 'config', 'dsexports', 'addons', 'operations', 'apikeys', 'roles', 'users']);

/** Studio Admin — manage the local metadata DB (design components, props, templates). */
export default function StudioAdminPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const navigate = useNavigate();
	const providerMeta = useStudioMeta();
	const refreshMeta = useStudioMetaRefresh();
	// ONE source of studio metadata for the whole app (`StudioMetaProvider`), which
	// already fetched it and gates rendering until it is ready. The admin page used
	// to fetch `/__studio/meta` a second time into local state on every mount and
	// after every write — pure duplication of the provider's read.
	const meta = providerMeta;
	const [tab, setTab] = useState<TabId>('components');
	// RBAC-aware UI: the admin-only tabs are hidden (and never rendered) unless the
	// session is the administrator — the API 403s them anyway, so the UI must not
	// offer them (least privilege). Until `/auth/me` settles they stay hidden.
	const { resolved: meResolved, canAdminister } = useMe(token);
	const navMain = useMemo(
		() => ADMIN_NAV.filter((n) => !n.adminOnly || canAdminister).map(({ tab: _t, adminOnly: _a, ...rest }) => rest as NavMainItem),
		[canAdminister],
	);
	// A non-admin can never sit on an admin-only tab (e.g. a deep link, or a role
	// changed mid-session) — fall back to the first tab.
	useEffect(() => {
		if (meResolved && !canAdminister && ADMIN_ONLY_TABS.has(tab)) setTab('components');
	}, [meResolved, canAdminister, tab]);
	const [editing, setEditing] = useState<DesignComponent | null>(null);
	const [newOpen, setNewOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	// Real apps (HRM/WMS…) go in the module switcher alongside the Settings tile.
	// Settings is always in the list, so the AppShell never sees an empty module
	// array (its sidebar reads modules[0].name) — no render gate needed. The read is
	// the shared `qk.modules()` entry (same cache the launcher grid + workbench use).
	const modules = useQuery(modulesQuery(token)).data ?? [];

	async function api(path: string, init?: RequestInit) {
		setBusy(true);
		try {
			// Studio metadata lives on the /__studio surface: the dev Vite plugin in
			// local dev, the Studio worker's D1-backed router in production. The
			// rewrite keeps admin tabs pointing at ONE surface in both environments.
			const r = await authedFetch(path.replace(/^\/api\/studio/, '/__studio'), init);
			await r.json();
		} finally {
			setBusy(false);
			refreshMeta(); // keep every reader (this page + the builder palette) in sync
		}
	}

	// Columns for the components catalog — drives the DataTable (design system).
	const componentColumns: ColumnDef<DesignComponent>[] = [
		{
			id: 'label',
			accessorKey: 'label',
			header: 'Component',
			filter: { id: 'label', label: 'Component', type: 'text' },
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<span
						style={{
							width: 28,
							height: 28,
							borderRadius: 8,
							background: 'var(--mmbix-muted, #f3f4f6)',
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							color: '#6b7280',
							flexShrink: 0,
						}}
					>
						{dsIcon(row.original.icon)}
					</span>
					<div style={{ minWidth: 0 }}>
						<div style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.original.label}</div>
						<div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
							<Badge variant="outline" style={{ fontSize: '0.58rem', fontWeight: 600 }}>
								{row.original.group_name}
							</Badge>
							{row.original.is_system === 1 && (
								<Badge variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600, color: '#9ca3af' }}>
									core
								</Badge>
							)}
						</div>
					</div>
				</div>
			),
		},
		{ id: 'name', accessorKey: 'name', header: 'Key', filter: { id: 'name', label: 'Key', type: 'text' } },
		{
			id: 'actions',
			header: '',
			enableSorting: false,
			enableHiding: false,
			align: 'right',
			width: '96px',
			cell: ({ row }) => (
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
					<Button
						variant="ghost"
						size="icon-xs"
						title="Edit"
						onClick={() => {
							setEditing(row.original);
							setNewOpen(true);
						}}
					>
						<Save size={13} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title="Delete"
						style={{ color: '#dc2626' }}
						disabled={row.original.is_system === 1}
						onClick={() => {
							if (confirm(`Delete component "${row.original.name}"?`))
								void api(`/api/studio/component?name=${encodeURIComponent(row.original.name)}`, { method: 'DELETE' });
						}}
					>
						<Trash2 size={13} />
					</Button>
				</div>
			),
		},
	];

	// The admin content — just the active tab's table; navigation (title + tab
	// buttons) lives in the AppShell sidebar/breadcrumbs.
	const content = (
		<>
			{tab === 'components' && (
				<DataTable
					columns={componentColumns}
					data={meta.components}
					rowKey="name"
					density="compact"
					defaultPageSize={25}
					onCreate={() => {
						setEditing(null);
						setNewOpen(true);
					}}
					labels={{ create: 'New component' }}
				/>
			)}

			{tab === 'templates' && <TemplatesTab meta={meta} api={api} />}

			{tab === 'styles' && <StylesTab meta={meta} api={api} />}

			{tab === 'events' && canAdminister && <EventsTab meta={meta} api={api} />}

			{tab === 'viewmodes' && <ViewModesTab meta={meta} api={api} />}

			{tab === 'config' && canAdminister && <StudioConfigTab meta={meta} api={api} />}

			{tab === 'dsexports' && canAdminister && <DsExportsTab meta={meta} api={api} />}

			{tab === 'addons' && canAdminister && <AddonsTab token={token} />}

			{tab === 'operations' && canAdminister && <OperationsTab token={token} />}

			{tab === 'tokens' && <TokensTab token={token} modules={modules} refresh={refreshMeta} />}

			{tab === 'apikeys' && canAdminister && <ApiKeysTab token={token} />}

			{tab === 'roles' && canAdminister && <RolesTab token={token} />}

			{/* Accounts are session identities, so the tab needs the signed-in email to
			    mark (and protect) the operator's OWN row. */}
			{tab === 'users' && canAdminister && <UsersTab token={token} currentEmail={user.email} />}

			{/* Component editor dialog */}
			{newOpen && (
				<ComponentEditor
					component={editing}
					meta={meta}
					onClose={() => setNewOpen(false)}
					onSaved={() => {
						refreshMeta();
						setNewOpen(false);
					}}
				/>
			)}
		</>
	);

	// The AppShell sidebar is settings-only (no app modules) — the data is
	// static, so the shell always renders safely.
	return (
		<AppShell
			breadcrumbs={[{ href: '#/studio', label: 'Studio Admin' }, { label: TAB_LABELS[tab] }]}
			data={{
				user: { name: user.full_name || user.email || 'Studio', email: user.email ?? '', avatar: '' },
				// Real app modules (HRM/WMS/…) + Settings + IDP + API Docs, all from the API.
				// IDP-managed business modules (HR/Vehicle/Store) live under the catalog,
				// so they're excluded from this app-level switcher.
				modules: [
					...modules
						.filter((m) => !isIdpManagedModule(m.slug))
						.map((m) => ({
							name: m.name,
							icon: smartIconFor(m.icon, Box),
							iconBackground: m.bg_color ?? appColor(m.slug),
							iconColor: m.icon_color ?? undefined,
						})),
					SETTINGS_MODULE,
					IDP_MODULE,
					API_DOCS_MODULE,
				],
				// The sidebar nav is the settings page's own (the admin tabs) — app
				// module menus stay off the settings page.
				navByModule: { Settings: { navMain, projects: [] }, default: { navMain, projects: [] } },
			}}
			disableNavItemPages
			// Sidebar nav items ARE the admin tabs — clicking one switches the tab.
			onNavigate={(event) => {
				if (event.type === 'nav-main-item') {
					const t = (Object.keys(TAB_LABELS) as TabId[]).find((k) => TAB_LABELS[k] === event.item.title);
					if (t) setTab(t);
				}
				return [{ href: '#/studio', label: 'Studio Admin' }, { label: TAB_LABELS[tab] }];
			}}
			headerChildren={
				<div className="ml-auto mr-4 flex items-center gap-1.5">
					{/* Sync DS / Reset run node against the LOCAL studio.db (dev-only — the
					 * production worker seeds ds_exports at deploy time and has no /reset). */}
					{import.meta.env.DEV && (
						<>
							<Button
								variant="outline"
								size="sm"
								title="Re-scan the design system into ds_exports"
								disabled={busy}
								onClick={() => void api('/api/studio/sync-ds', { method: 'POST' })}
							>
								<RefreshCw size={13} /> Sync DS
							</Button>
							<Button
								variant="outline"
								size="sm"
								title="Rebuild studio.db from schema + seed"
								disabled={busy}
								onClick={() => void api('/api/studio/reset', { method: 'POST' })}
							>
								<Database size={13} /> Reset
							</Button>
						</>
					)}
				</div>
			}
			statusBar={<StatusBar />}
			sidebarProps={{
				activeModule: SETTINGS_MODULE,
				// Picking a module in the switcher: IDP → the portal; API Docs → the
				// standalone docs page; a real app → its workbench; Settings stays.
				onActiveModuleChange: (mod) => {
					if (mod.name === IDP_MODULE.name) {
						navigate('/idp');
						return;
					}
					if (mod.name === API_DOCS_MODULE.name) {
						navigate('/api-docs');
						return;
					}
					const m = modules.find((x) => x.name === mod.name);
					if (m) navigate(`/apps/${m.slug}`);
				},
			}}
		>
			{content}
		</AppShell>
	);
}
