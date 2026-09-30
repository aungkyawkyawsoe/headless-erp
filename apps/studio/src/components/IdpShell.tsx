import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppShell, StatusBar, type Module, type NavMainItem } from '@mmbix/design-system';
import { appColor, smartIconFor } from '@mmbix/ui-views';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, BookOpen, Box, Database, GitBranch, Home, Layers, LayoutGrid, Rocket, Server, ShieldCheck, Users } from 'lucide-react';
import { modulesQuery } from '../lib/queries';
import { isIdpManagedModule } from '../lib/idp';

/** The sections of the developer portal. Mirrors the sidebar nav. */
export type IdpNavKey = 'home' | 'catalog' | 'collections' | 'roles' | 'users' | 'create' | 'environments' | 'deployments' | 'usage';

export interface IdpBreadcrumb {
	label: string;
	href?: string;
}

interface IdpShellProps {
	token: string;
	user: { email: string; full_name: string };
	breadcrumbs: IdpBreadcrumb[];
	children: React.ReactNode;
	/** The section currently being viewed — highlights the matching nav item. */
	activeNav: IdpNavKey;
}

/** The IDP's own module tile: lets the switcher stay on the portal and still
 *  jump into any real app workbench. */
const PORTAL_MODULE: Module = { name: 'IDP', icon: Layers, iconBackground: '#8b5cf6' };

/** API Docs as a top-level module — same level as IDP in the module switcher.
 *  It opens the standalone /api-docs page (not wrapped in the IDP nav drawer). */
const API_DOCS_MODULE: Module = { name: 'API Docs', icon: BookOpen, iconBackground: '#0ea5e9' };

const IDP_NAV: Array<{ key: IdpNavKey; title: string; url: string; icon: LucideIcon }> = [
	{ key: 'home', title: 'Home', url: '/idp', icon: Home },
	{ key: 'catalog', title: 'Catalog', url: '/idp/catalog', icon: LayoutGrid },
	{ key: 'collections', title: 'Collections', url: '/idp/collections', icon: Database },
	{ key: 'roles', title: 'Roles & Access', url: '/idp/access', icon: ShieldCheck },
	{ key: 'users', title: 'Users', url: '/idp/users', icon: Users },
	{ key: 'create', title: 'Create', url: '/idp/create', icon: Rocket },
	{ key: 'environments', title: 'Environments', url: '/idp/environments', icon: Server },
	{ key: 'deployments', title: 'Deployments', url: '/idp/deployments', icon: GitBranch },
	{ key: 'usage', title: 'Usage', url: '/idp/usage', icon: BarChart3 },
];

/** Small number + label stat used by the overview and usage pages. */
export function IdpStat({ label, value, color }: { label: string; value: number; color?: string }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
			<span style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1, color: color ?? 'inherit' }}>{value}</span>
			<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{label}</span>
		</div>
	);
}

/** Backstage-style shell for the whole developer portal: resizable sidebar with
 *  module switcher + portal nav, header breadcrumbs, and a status bar. */
export default function IdpShell({ token, user, breadcrumbs, children, activeNav }: IdpShellProps) {
	const navigate = useNavigate();
	// The shell re-renders on EVERY portal route, so its module list must come from
	// the shared `qk.modules()` cache — one fetch for the whole session instead of a
	// fresh `GET /api/modules` (twice, under StrictMode) on every navigation.
	const modules = useQuery(modulesQuery(token)).data ?? [];

	const navMain: NavMainItem[] = IDP_NAV.map((n) => ({ title: n.title, url: '#', icon: n.icon, isActive: n.key === activeNav }));
	const navByModule = {
		[PORTAL_MODULE.name]: { navMain, projects: [] },
		default: { navMain, projects: [] },
	};

	return (
		<>
			<AppShell
				breadcrumbs={breadcrumbs}
				data={{
					user: { name: user.full_name || user.email || 'Developer', email: user.email ?? '', avatar: '' },
					// Real app modules (HRM/WMS/…) from the API + the IDP tile + API Docs.
					// IDP-managed business modules (HR/Vehicle/Store) live under the catalog,
					// so they're excluded from this app-level switcher.
					modules: [
						PORTAL_MODULE,
						API_DOCS_MODULE,
						...modules
							.filter((m) => !isIdpManagedModule(m.slug))
							.map((m) => ({
								name: m.name,
								icon: smartIconFor(m.icon, Box),
								iconBackground: m.bg_color ?? appColor(m.slug),
								iconColor: m.icon_color ?? undefined,
							})),
					],
					// The developer-portal nav is the same for every module (including the portal).
					navByModule,
				}}
				disableNavItemPages
				onNavigate={(event) => {
					if (event.type !== 'nav-projects') {
						const def = IDP_NAV.find((n) => n.title === event.item.title);
						if (def) navigate(def.url);
						return [{ href: '#/idp', label: 'IDP' }, { label: def?.title ?? event.item.title }];
					}
					return [{ href: '#/idp', label: 'IDP' }, { label: event.project.name }];
				}}
				statusBar={<StatusBar />}
				sidebarProps={{
					activeModule: PORTAL_MODULE,
					// Picking a module in the switcher: API Docs → the standalone docs page;
					// a real app → its workbench; the IDP tile keeps the portal.
					onActiveModuleChange: (mod) => {
						if (mod.name === API_DOCS_MODULE.name) {
							navigate('/api-docs');
							return;
						}
						const m = modules.find((x) => x.name === mod.name);
						if (m) navigate(`/apps/${m.slug}`);
					},
				}}
			>
				{children}
			</AppShell>
		</>
	);
}
