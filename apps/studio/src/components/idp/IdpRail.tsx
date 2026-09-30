/**
 * IdpRail — tier 1 of the portal shell: the icon-only activity bar. One icon per
 * DOMAIN (Overview, Catalog, Collections, Roles & Access, Users, Governance,
 * API Docs), so the bar stays bounded however many surfaces the portal grows.
 * A domain with several pages lists them in the tier-2 panel (Catalog's own
 * rows); a domain that IS one page carries no panel at all and its icon lands
 * straight on it (Overview, Users, API Docs) — as do the two domains that
 * enumerate ENTITIES instead of pages, through their own registries
 * (Collections, Roles & Access).
 *
 * It renders `lib/idp-nav.ts` — the same registry the panels and the ⌘K palette
 * read — and derives the active icon from the pathname, so the rail cannot
 * disagree with the page it is highlighting.
 *
 * A click always LEAVES THE PANEL OPEN: it navigates to the clicked section and,
 * if the panel was collapsed, expands it. Collapsing is an explicit act (⌘/Ctrl+B
 * or the sidebar edge) — clicking the active icon used to toggle it shut, which
 * made a double-click on an icon slide the whole nav away.
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { NavRail, useSidebar } from '@mmbix/design-system';
import { activeSectionForPath, visibleSections } from '../../lib/idp-nav';
import { useMe } from '../../lib/use-me';
import { useTranslation } from '../../lib/i18n';
import ThemeToggle from '../ThemeToggle';

export default function IdpRail({ token }: { token: string }) {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const { isAdmin } = useMe(token);
	const { t } = useTranslation(token);
	// The rail is rendered INSIDE the SidebarProvider (AppShell slots it there), so
	// it can expand the panel the same way ⌘/Ctrl+B toggles it.
	const { setOpen } = useSidebar();

	const active = activeSectionForPath(pathname);
	const items = visibleSections(isAdmin).map((section) => ({
		id: section.id,
		label: t(`studio.idp.${section.id}`, section.label),
		icon: section.icon,
	}));

	return (
		<NavRail
			items={items}
			activeId={active.id}
			onSelectItem={(item) => {
				setOpen(true);
				if (item.id === active.id) return;
				const section = visibleSections(isAdmin).find((s) => s.id === item.id);
				if (section) navigate(section.path);
			}}
			footer={<ThemeToggle />}
		/>
	);
}
