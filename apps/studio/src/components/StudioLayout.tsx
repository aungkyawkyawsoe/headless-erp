/**
 * StudioLayout — Odoo-inspired 3-pane studio workspace shell.
 * Rendered inside the app's global shell (see App.tsx — the narrow activity
 * rail was removed; navigation lives in the Apps ModuleGrid).
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  header                                                        │
 *   ├───────────────┬───────────────────────────────┬───────────────┤
 *   │  left (280px) │  center (canvas, flex-grow)   │  right (320px)│
 *   │  palette      │  live preview / drop targets  │  inspector    │
 *   ├───────────────┴───────────────────────────────┴───────────────┤
 *   │  footer (status bar)                                          │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * The right pane is resizable (drag the handle) and collapsible — panes can
 * call `useRightPane()` to toggle it from a button. The left pane is
 * collapsible the same way (call `useLeftPane()` from inside its content);
 * when collapsed it shrinks to a slim strip with an expand button.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@mmbix/design-system';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import PaneBoundary from './PaneBoundary';
import { useIsNarrow } from '../lib/use-media-query';

interface StudioLayoutProps {
	header?: ReactNode;
	left?: ReactNode;
	right?: ReactNode;
	footer?: ReactNode;
	/** Optional persistence key — the right pane's collapsed state + width survive reloads (localStorage). */
	storageKey?: string;
	children: ReactNode;
}

/** Read a persisted workspace snapshot (collapsed states + right pane size) for a key. */
function loadPersisted(key: string | undefined): { collapsed?: boolean; leftCollapsed?: boolean; rightSize?: number } | null {
	if (!key) return null;
	try {
		const raw = localStorage.getItem(`studio-layout:${key}`);
		return raw ? (JSON.parse(raw) as { collapsed?: boolean; rightSize?: number }) : null;
	} catch {
		return null;
	}
}

/** Lets any right-pane content collapse/expand the pane itself. */
const RightPaneCtx = createContext<{ collapsed: boolean; toggle: () => void } | null>(null);
export function useRightPane() {
	return useContext(RightPaneCtx);
}

/** Lets any left-pane content collapse/expand the pane itself. */
const LeftPaneCtx = createContext<{ collapsed: boolean; toggle: () => void } | null>(null);
export function useLeftPane() {
	return useContext(LeftPaneCtx);
}

export default function StudioLayout({ header, left, right, footer, storageKey, children }: StudioLayoutProps) {
	// Workspace persistence — panel geometry is part of the user's spatial mental
	// model (the "workshop"), so it must survive reloads, keyed per workspace.
	const [rightCollapsed, setRightCollapsed] = useState(() => loadPersisted(storageKey)?.collapsed ?? false);
	const [rightSize, setRightSize] = useState(() => {
		const s = loadPersisted(storageKey)?.rightSize;
		return typeof s === 'number' && s > 0 ? s : 26;
	});
	const [leftCollapsed, setLeftCollapsed] = useState(() => loadPersisted(storageKey)?.leftCollapsed ?? false);
	// Responsive: on a narrow viewport, collapse both inspectors to their slim
	// strips so the canvas keeps the width. Runs only when `narrow` CHANGES (so a
	// deliberate manual expand on a wide screen is not undone), and the user can
	// still re-expand by hand while narrow.
	const narrow = useIsNarrow();
	useEffect(() => {
		if (!narrow) return;
		setLeftCollapsed(true);
		setRightCollapsed(true);
	}, [narrow]);
	useEffect(() => {
		if (!storageKey) return;
		try {
			localStorage.setItem(`studio-layout:${storageKey}`, JSON.stringify({ collapsed: rightCollapsed, rightSize, leftCollapsed }));
		} catch {
			/* storage full / unavailable */
		}
	}, [storageKey, rightCollapsed, rightSize, leftCollapsed]);

	return (
		<div style={{ flex: 1, height: '100%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			{header && (
				<header style={{ borderBottom: '1px solid var(--mmbix-border, #e5e7eb)', background: 'var(--mmbix-background, #fff)', zIndex: 10 }}>
					{header}
				</header>
			)}
			<div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
				<LeftPaneCtx.Provider value={{ collapsed: leftCollapsed, toggle: () => setLeftCollapsed((v) => !v) }}>
					{left && leftCollapsed ? (
						// Collapsed — a slim strip keeps the pane one click away.
						<div
							style={{
								width: 26,
								flexShrink: 0,
								borderRight: '1px solid var(--mmbix-border, #e5e7eb)',
								background: 'var(--mmbix-muted, #f9fafb)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							<button
								type="button"
								title="Expand panel"
								onClick={() => setLeftCollapsed(false)}
								style={{
									width: 22,
									height: 40,
									borderRadius: 6,
									border: '1px solid var(--mmbix-border, #e5e7eb)',
									background: 'var(--mmbix-card, #ffffff)',
									cursor: 'pointer',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									color: '#6b7280',
									padding: 0,
								}}
							>
								<ChevronsRight size={14} />
							</button>
						</div>
					) : left ? (
						<aside
							style={{
								width: 'min(340px, 85vw)',
								flexShrink: 0,
								borderRight: '1px solid var(--mmbix-border, #e5e7eb)',
								background: 'var(--mmbix-muted, #f9fafb)',
								overflowY: 'auto',
								display: 'flex',
								flexDirection: 'column',
							}}
						>
							<PaneBoundary label="left">{left}</PaneBoundary>
						</aside>
					) : null}
				</LeftPaneCtx.Provider>
				<RightPaneCtx.Provider value={{ collapsed: rightCollapsed, toggle: () => setRightCollapsed((v) => !v) }}>
					<ResizablePanelGroup orientation="horizontal" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
						<ResizablePanel defaultSize={100 - rightSize} minSize="40%" style={{ minWidth: 0, minHeight: 0 }}>
							<main style={{ height: '100%', minWidth: 0, overflowY: 'auto', background: 'var(--mmbix-background, #fff)' }}>
								<PaneBoundary label="center">{children}</PaneBoundary>
							</main>
						</ResizablePanel>
						{right && rightCollapsed ? (
							// Collapsed — a slim strip keeps the pane one click away.
							<div
								style={{
									width: 26,
									flexShrink: 0,
									borderLeft: '1px solid var(--mmbix-border, #e5e7eb)',
									background: 'var(--mmbix-muted, #f9fafb)',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<button
									type="button"
									title="Expand properties"
									onClick={() => setRightCollapsed(false)}
									style={{
										width: 22,
										height: 40,
										borderRadius: 6,
										border: '1px solid var(--mmbix-border, #e5e7eb)',
										background: 'var(--mmbix-card, #ffffff)',
										cursor: 'pointer',
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										color: '#6b7280',
										padding: 0,
									}}
								>
									<ChevronsLeft size={14} />
								</button>
							</div>
						) : right ? (
							<>
								<ResizableHandle withHandle style={{ background: 'var(--mmbix-border, #e5e7eb)' }} />
								<ResizablePanel
									defaultSize={rightSize}
									minSize="15%"
									maxSize="45%"
									onResize={(s) => {
										// This design-system's react-resizable-panels passes a PanelSize object
										// ({ asPercentage, inPixels }) rather than a bare number — normalize it.
										const pct = s && typeof s === 'object' && 'asPercentage' in s ? (s as { asPercentage: number }).asPercentage : s;
										const n = typeof pct === 'number' ? pct : Number(pct);
										if (Number.isFinite(n) && n > 0) setRightSize(Math.round(n));
									}}
									style={{ minWidth: 0, minHeight: 0 }}
								>
									<aside
										style={{
											height: '100%',
											borderLeft: '1px solid var(--mmbix-border, #e5e7eb)',
											background: 'var(--mmbix-muted, #f9fafb)',
											overflowY: 'auto',
											display: 'flex',
											flexDirection: 'column',
										}}
									>
										<PaneBoundary label="right">{right}</PaneBoundary>
									</aside>
								</ResizablePanel>
							</>
						) : null}
					</ResizablePanelGroup>
				</RightPaneCtx.Provider>
			</div>
			{footer && (
				<footer
					style={{
						borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'var(--mmbix-background, #fff)',
						padding: '0.1rem 1rem',
						fontSize: '0.75rem',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					<div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%' }}>
						<div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{footer}</div>
					</div>
				</footer>
			)}
		</div>
	);
}

/** Small helper: a titled section used inside sidebars. */
export function SideSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
	return (
		<div style={{ padding: '0.75rem 0.9rem', borderBottom: '1px solid var(--mmbix-border, #e5e7eb)' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
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
				{action}
			</div>
			{children}
		</div>
	);
}
