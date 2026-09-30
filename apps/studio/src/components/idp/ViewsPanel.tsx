/**
 * ViewsPanel — the side panel (tier 2) for a section whose list has saved VIEWS
 * rather than pages: the user directory's Directus sidebar (Active Users /
 * Suspended Users / Invited Users / All Users).
 *
 * A row here is a FILTER, not a destination. It writes `?view=` through
 * `useUserView` (replace — the URL/history contract), so the section keeps its
 * ONE history entry and the back arrow leaves Users in one press instead of
 * walking back through every view the operator tried.
 *
 * The rows ARE `USER_VIEWS` (`lib/user-view.ts`) — the same array the table
 * filters by and the Studio Admin toggle renders, so the panel can never offer
 * a view the table does not know.
 */
import { USER_VIEWS, useUserView } from '../../lib/user-view';

export default function ViewsPanel({ title }: { title: string }) {
	const { view, selectView } = useUserView();
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
				{USER_VIEWS.map((v) => {
					const active = v.id === view;
					const Icon = v.icon;
					return (
						<button
							key={v.id}
							type="button"
							onClick={() => selectView(v.id)}
							// View state, not a page — the generic `aria-current` form. It is
							// also what tells a screen reader (and the e2e pin) which filter
							// is applied.
							aria-current={active ? 'true' : undefined}
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
							<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
						</button>
					);
				})}
			</nav>
		</div>
	);
}
