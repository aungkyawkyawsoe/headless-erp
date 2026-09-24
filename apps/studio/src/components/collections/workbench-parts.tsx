/**
 * Collections workbench — extracted presentational pieces.
 *
 * Pulled out of the (large) `CollectionsWorkbench` page so each piece has one
 * reason to change and can be read/tested on its own. Behaviour is unchanged.
 */
import { Button } from '@mmbix/design-system';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useLeftPane } from '../StudioLayout';
import type { StudioCodeHook } from '../../lib/api';

/** Parse a hook's `rules_text` JSON string into rule objects (empty for legacy/no-rules rows). */
export function parseHookRules(rulesText: string | null): Array<{ action: string; target?: string; message?: string; title?: string }> {
	if (!rulesText) return [];
	try {
		const parsed = JSON.parse(rulesText);
		return Array.isArray(parsed)
			? parsed.filter(
					(r): r is { action: string; target?: string; message?: string; title?: string } => !!r && typeof r.action === 'string',
				)
			: [];
	} catch {
		return [];
	}
}

/** One compiled code-hook card — the read-only registry row shown in the
 *  hooks dialog (plugin_id + event pill + human purpose + rewrite targets). */
export function CodeHookCard({ hook, firingCollection }: { hook: StudioCodeHook; firingCollection: string }) {
	return (
		<div
			style={{
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				borderRadius: 8,
				padding: '0.6rem 0.75rem',
				display: 'flex',
				flexDirection: 'column',
				gap: '0.4rem',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
				<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{hook.plugin_id}</span>
				<span
					style={{
						fontSize: '0.62rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.04em',
						padding: '2px 8px',
						borderRadius: 999,
						background: 'var(--mmbix-primary, #2563eb)',
						color: 'var(--mmbix-primary-foreground, #ffffff)',
					}}
				>
					{hook.event}
				</span>
				<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
					fires on <strong>{firingCollection}</strong>
				</span>
			</div>
			{hook.description ? (
				<p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{hook.description}</p>
			) : null}
			{hook.writes_to.length > 0 ? (
				<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
					<span style={{ fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>rewrites</span>
					{hook.writes_to.map((target) => (
						<span
							key={target}
							style={{
								fontSize: '0.62rem',
								fontWeight: 700,
								padding: '2px 8px',
								borderRadius: 999,
								background: 'var(--mmbix-muted, #f1f5f9)',
								color: 'var(--mmbix-muted-foreground, #64748b)',
							}}
						>
							{target}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

/** Collapse/expand toggle for the left Collections pane (lives inside the pane). */
export function CollectionsPaneToggle() {
	const pane = useLeftPane();
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			title={pane?.collapsed ? 'Expand collections panel' : 'Collapse collections panel'}
			aria-label={pane?.collapsed ? 'Expand collections panel' : 'Collapse collections panel'}
			onClick={() => pane?.toggle()}
		>
			{pane?.collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
		</Button>
	);
}
