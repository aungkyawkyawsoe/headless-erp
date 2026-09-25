import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { modulesQuery } from '../lib/queries';
import { filterCommands, type PaletteCommand } from '../lib/command-palette';

/* ── Command palette (⌘K / Ctrl-K) — jump to any surface without the mouse ──
 *
 * A thin renderer over the pure `filterCommands`: it lists destinations built
 * from the app modules + the static Studio surfaces, and navigates on Enter.
 * Arrow keys move the selection; Esc closes. Mounted once in the authed tree.
 *
 * Accessibility: a real `dialog` with a focus trap (focus starts on the input and
 * cannot Tab out; it returns to the trigger on close) and a `listbox` of `option`s
 * driven by `aria-activedescendant`, so arrow/Enter/Esc work for screen readers
 * without moving DOM focus off the input. */

export function CommandPalette({ token }: { token: string }) {
	const navigate = useNavigate();
	const modulesQ = useQuery(modulesQuery(token));
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const restoreFocusRef = useRef<HTMLElement | null>(null);
	const baseId = useId();
	const listboxId = `${baseId}-listbox`;
	const optionId = (i: number) => `${baseId}-option-${i}`;

	const commands = useMemo<PaletteCommand[]>(() => {
		const go = (path: string) => () => navigate(path);
		const staticCmds: PaletteCommand[] = [
			{ id: 'home', label: 'Apps gallery', group: 'Go', run: go('/') },
			{ id: 'studio', label: 'Studio Admin', group: 'Go', run: go('/studio') },
			{ id: 'api-docs', label: 'API Docs', group: 'Go', run: go('/api-docs') },
			{ id: 'idp', label: 'IDP portal', group: 'Go', run: go('/idp') },
		];
		const moduleCmds = (modulesQ.data ?? []).map((m) => ({
			id: `app:${m.slug}`,
			label: m.name,
			group: 'Apps',
			keywords: m.slug,
			run: go(`/apps/${m.slug}`),
		}));
		return [...staticCmds, ...moduleCmds];
	}, [modulesQ.data, navigate]);

	const results = useMemo(() => filterCommands(commands, query), [commands, query]);

	// Global ⌘K / Ctrl-K toggle.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				setOpen((v) => !v);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	// Reset + focus whenever it opens (remembering the trigger so focus can return).
	useEffect(() => {
		if (open) {
			restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
			setQuery('');
			setActive(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		} else {
			// Return focus to whatever opened the palette — the trap must not strand it.
			restoreFocusRef.current?.focus?.();
			restoreFocusRef.current = null;
		}
	}, [open]);

	// Clamp the selection when results shrink.
	useEffect(() => {
		setActive((i) => Math.min(i, Math.max(0, results.length - 1)));
	}, [results.length]);

	if (!open) return null;

	const choose = (c: PaletteCommand | undefined) => {
		if (!c) return;
		setOpen(false);
		c.run();
	};

	// Focus trap: Tab cycles inside the dialog (the input is the only tab stop —
	// options are reached via aria-activedescendant, not the tab order). Esc closes
	// from anywhere in the palette.
	const onContainerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			setOpen(false);
			return;
		}
		if (e.key !== 'Tab') return;
		const focusables = containerRef.current?.querySelectorAll<HTMLElement>(
			'a[href],button:not([tabindex="-1"]),input:not([tabindex="-1"]),select,textarea,[tabindex]:not([tabindex="-1"])',
		);
		const list = focusables ? Array.from(focusables) : [];
		if (list.length === 0) {
			e.preventDefault();
			return;
		}
		const first = list[0];
		const last = list[list.length - 1];
		const activeEl = document.activeElement;
		if (e.shiftKey && activeEl === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && activeEl === last) {
			e.preventDefault();
			first.focus();
		}
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			onClick={() => setOpen(false)}
			onKeyDown={onContainerKeyDown}
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 1000,
				background: 'rgba(0,0,0,0.35)',
				display: 'flex',
				justifyContent: 'center',
				paddingTop: '12vh',
			}}
		>
			<div
				ref={containerRef}
				onClick={(e) => e.stopPropagation()}
				style={{
					width: 'min(560px, 92vw)',
					maxHeight: '60vh',
					display: 'flex',
					flexDirection: 'column',
					background: 'var(--mmbix-card, #fff)',
					border: '1px solid var(--mmbix-border, #e5e7eb)',
					borderRadius: 12,
					boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						padding: '0.6rem 0.75rem',
						borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
					}}
				>
					<Search size={15} style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)' }} />
					<input
						ref={inputRef}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Jump to…"
						aria-label="Search commands"
						role="combobox"
						aria-expanded={true}
						aria-controls={listboxId}
						aria-autocomplete="list"
						aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
						style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '0.85rem', color: 'inherit' }}
						onKeyDown={(e) => {
							if (e.key === 'ArrowDown') {
								e.preventDefault();
								setActive((i) => Math.min(i + 1, results.length - 1));
							} else if (e.key === 'ArrowUp') {
								e.preventDefault();
								setActive((i) => Math.max(i - 1, 0));
							} else if (e.key === 'Enter') {
								e.preventDefault();
								choose(results[active]);
							} else if (e.key === 'Escape') {
								e.preventDefault();
								setOpen(false);
							}
						}}
					/>
					<kbd style={{ fontSize: '0.62rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>esc</kbd>
				</div>

				<div id={listboxId} role="listbox" aria-label="Commands" style={{ overflowY: 'auto', padding: '0.35rem' }}>
					{results.length === 0 ? (
						<p style={{ fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', padding: '0.5rem' }}>No matches.</p>
					) : (
						results.map((c, i) => (
							<button
								key={c.id}
								id={optionId(i)}
								type="button"
								role="option"
								tabIndex={-1}
								aria-selected={i === active}
								onMouseEnter={() => setActive(i)}
								onClick={() => choose(c)}
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									width: '100%',
									textAlign: 'left',
									padding: '0.4rem 0.5rem',
									borderRadius: 8,
									border: 'none',
									cursor: 'pointer',
									fontSize: '0.78rem',
									background: i === active ? 'var(--mmbix-accent, #eef2ff)' : 'transparent',
									color: 'inherit',
								}}
							>
								<span>{c.label}</span>
								<span style={{ fontSize: '0.62rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{c.group}</span>
							</button>
						))
					)}
				</div>
			</div>
		</div>
	);
}
