/**
 * LinksPanel — the side panel (tier 2) for a section whose content is a short
 * list of pages rather than a live registry: Catalog (Catalog, Create) and
 * Governance (Policies, one row — a remaining self-link; the one-page sections
 * that held a panel like this dropped it instead, and the two whose only page
 * was deleted left the registry altogether).
 *
 * It renders the registry's `links` spec, so a section's pages are declared
 * once in `lib/idp-nav.ts` and cannot drift from what the panel offers.
 */
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export default function LinksPanel({
	title,
	items,
	activePath,
}: {
	title: string;
	items: Array<{ label: string; path: string; icon: LucideIcon }>;
	/** The current pathname — the matching row is the active one. */
	activePath: string;
}) {
	const navigate = useNavigate();
	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--mmbix-border, #e5e7eb)' }}>
				<span
					style={{
						fontSize: '0.72rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					{title}
				</span>
			</div>
			<nav aria-label={title} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
				{items.map((item) => {
					const active = item.path === activePath;
					const Icon = item.icon;
					return (
						<button
							key={item.path}
							type="button"
							onClick={() => navigate(item.path)}
							aria-current={active ? 'page' : undefined}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 8,
								width: '100%',
								padding: '0.45rem 0.5rem',
								borderRadius: 6,
								border: 'none',
								cursor: 'pointer',
								textAlign: 'left',
								fontSize: '0.82rem',
								fontWeight: active ? 700 : 500,
								background: active ? 'var(--mmbix-primary, #2563eb)' : 'transparent',
								color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'inherit',
							}}
						>
							<Icon
								size={13}
								style={{
									flexShrink: 0,
									color: active ? 'var(--mmbix-primary-foreground, #ffffff)' : 'var(--mmbix-muted-foreground, #9ca3af)',
								}}
							/>
							<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
						</button>
					);
				})}
			</nav>
		</div>
	);
}
