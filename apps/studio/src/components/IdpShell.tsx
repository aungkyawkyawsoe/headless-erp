import { useLocation } from 'react-router-dom';
import { AppShell, StatusBar, type Module } from '@mmbix/design-system';
import { Layers, LogOut } from 'lucide-react';
import { activeSectionForPath } from '../lib/idp-nav';
import { useTranslation } from '../lib/i18n';
import { useLogout } from '../lib/session-actions';
import { CollectionsPanel } from './collections/CollectionsPanel';
import IdpRail from './idp/IdpRail';
import LinksPanel from './idp/LinksPanel';
import ViewsPanel from './idp/ViewsPanel';

export interface IdpBreadcrumb {
	label: string;
	href?: string;
}

interface IdpShellProps {
	token: string;
	user: { email: string; full_name: string };
	breadcrumbs?: IdpBreadcrumb[];
	children: React.ReactNode;
	/** Extra controls for the header row (e.g. a Table/Schema view toggle). */
	headerChildren?: React.ReactNode;
	/**
	 * Whether the active page gets the shell's header row (breadcrumbs +
	 * `headerChildren`). Defaults to `true`; `false` is for a section whose page
	 * IS the whole destination and fills the canvas itself.
	 */
	showHeader?: boolean;
	/** Whether the empty status bar is docked below the page. Defaults to `true`. */
	showStatusBar?: boolean;
}

/** Small number + label stat used by the overview and usage pages. */
export function IdpStat({ label, value, color }: { label: string; value: number; color?: string }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
			<span style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1, color: color ?? 'inherit' }}>{value}</span>
			<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{label}</span>
		</div>
	);
}

/** The portal's sidebar identity (its `activeModule`). The module switcher that
 *  used to open from it is OFF — see `showModuleSwitcher` below. */
const PORTAL_MODULE: Module = { name: 'IDP', icon: Layers, iconBackground: '#8b5cf6' };

/**
 * The developer portal's shell — three tiers:
 *
 *   rail (activity bar · domains)  →  panel (the section's entities)  →  page
 *
 * Both upper tiers derive from `lib/idp-nav.ts` and the ACTIVE section is read
 * from the pathname (`activeSectionForPath`), so no page has to declare which
 * nav item it belongs to — a page cannot disagree with the rail.
 */
export default function IdpShell({ token, user, breadcrumbs, children, headerChildren, showHeader = true, showStatusBar = true }: IdpShellProps) {
	const { pathname } = useLocation();
	const { t } = useTranslation(token);
	const logout = useLogout();

	const section = activeSectionForPath(pathname);
	const label = (id: string, fallback: string) => t(`studio.idp.${id}`, fallback);

	// Tier 2 — the panel body is the active section's registry entry. A section with
	// a `none` panel (Overview, API Docs: nothing to enumerate, so the page IS the
	// section) passes `null`, which drops the sidebar
	// column entirely instead of showing an empty gutter, a single self-link, or — as
	// Overview once did — a copy of the rail's own list. The switch is exhaustive:
	// adding a panel kind to the registry is a compile error here until it is
	// rendered.
	const panel = (() => {
		switch (section.panel.kind) {
			case 'none':
				return null;
			case 'collections':
				return <CollectionsPanel token={token} />;
			case 'links':
				return (
					<LinksPanel
						title={label(section.id, section.label)}
						activePath={pathname}
						items={section.panel.items.map((i) => ({ ...i, label: label(i.label, i.label) }))}
					/>
				);
			case 'views':
				return <ViewsPanel title={label(section.id, section.label)} />;
		}
	})();

	return (
		<AppShell
			// Tier 1 — the activity bar (domains, icon-only).
			rail={<IdpRail token={token} />}
			panel={panel}
			headerChildren={showHeader ? headerChildren : undefined}
			breadcrumbs={showHeader ? breadcrumbs : undefined}
			showFullscreenToggle={showHeader}
			data={{
				user: { name: user.full_name || user.email || 'Developer', email: user.email ?? '', avatar: '' },
				// Just the sidebar's identity anchor (its `activeModule`): the switcher
				// that would list the apps is off below, because the Catalog section IS
				// the app list — one path, not two.
				modules: [PORTAL_MODULE],
				// Navigation lives in the rail + panel, so the sidebar body is the
				// section's panel (never a nav list).
				navByModule: {},
			}}
			statusBar={showStatusBar ? <StatusBar /> : null}
			// The portal's navigation is permanent: the panel cannot be collapsed
			// (no ⌘/Ctrl+B, no edge grip), so the rail and its list can never slide
			// away under the pointer. Below `md` the panel is still the header
			// trigger's Sheet.
			providerProps={{ collapsible: false }}
			sidebarProps={{
				activeModule: PORTAL_MODULE,
				// No module switcher: this portal's navigation is the rail + panel, and
				// the apps live in the Catalog section. The full-screen launcher grid
				// would be a second path to the same list — and it binds ⌘K, which here
				// belongs to the command palette.
				sidebarHeaderProps: { showModuleSwitcher: false },
				// Sign-out lives in the panel's account menu — the portal replaced the
				// launcher grid, which was the only surface that owned it. The DS
				// default menu (Account / Billing / Notifications) names surfaces this
				// app does not have, so the menu carries the one action that exists.
				// The LOCALE switcher is off for the same reason AND because it is a
				// crash: `LocaleMenuItem` requires a `LocaleProvider`, which the Studio
				// does not mount (it renders the backend bundle through `lib/i18n.ts`,
				// with no language picker) — opening the menu without this flag took
				// the whole tree down. Theme stays (main.tsx mounts `ThemeProvider`).
				navUserProps: {
					showLocaleSwitcher: false,
					userMenuItems: [{ kind: 'logout', label: t('studio.logout', 'Log out'), icon: LogOut, onClick: logout }],
				},
			}}
		>
			{children}
		</AppShell>
	);
}
