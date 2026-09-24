import { useEffect, useState, useSyncExternalStore } from 'react';
import { CARD_FRAME } from '@/shared/components/card';

import { Check, LogOut, Moon, Monitor, Palette, RefreshCw, Sun, User } from 'lucide-react';

import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { ModuleShell } from '@/shared/components/module-shell';
import { getCachedMe, clearToken } from '@/shared/auth';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { discardOffline, flushOffline, pendingCount, subscribeQueue } from '@/shared/platform/offline';
import { reloadApp } from '@/shared/platform/reload';
import { isTelegramApp } from '@/shared/platform/telegram';
import {
	applyThemePreference,
	loadThemePreference,
	onSystemSchemeChange,
	systemScheme,
	type Scheme,
	type ThemePreference,
} from '@/shared/platform/theme';

/**
 * ဆက်တင် (Settings) — compact theme changer.
 *
 * ONE card: a header row (section label + live active-scheme chip), a
 * three-option radiogroup of miniature previews, and a one-line status
 * footer. Preview palettes mirror the REAL index.css tokens so each option
 * shows exactly what the user gets. Selection persists (`mmbix-theme`),
 * applies instantly and — inside Telegram — tries the native
 * `setColorScheme` (Bot API 7.10+, guarded).
 */

/** Miniature-mockup palettes — mirror `index.css` tokens exactly. */
const PREVIEW: Record<Scheme, { bg: string; card: string; fg: string; primary: string; border: string; shadow: string }> = {
	light: {
		bg: 'oklch(0.955 0.006 250)',
		card: 'oklch(0.997 0.003 250)',
		fg: 'oklch(0.2 0.012 250)',
		primary: 'oklch(0.28 0.02 250)',
		border: 'oklch(0.88 0.01 250)',
		shadow: '0 1px 2px rgb(15 23 42 / 0.05), 0 4px 10px -4px rgb(15 23 42 / 0.12)',
	},
	dark: {
		bg: 'oklch(0.14 0.01 248)',
		card: 'oklch(0.19 0.012 248)',
		fg: 'oklch(0.93 0.006 250)',
		primary: 'oklch(0.88 0.01 240)',
		border: 'oklch(1 0 0 / 10%)',
		shadow: '0 1px 2px rgb(0 0 0 / 0.25), 0 4px 10px -4px rgb(0 0 0 / 0.4)',
	},
};

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; caption: string; icon: typeof Sun }> = [
	{ value: 'light', label: 'Light', caption: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', caption: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', caption: 'System', icon: Monitor },
];

const SCHEME_LABEL: Record<Scheme, string> = { light: 'Light', dark: 'Dark' };

/** Tiny app mockup (mini bar + card with a primary pill) in one scheme. */
function SchemeMockup({ scheme }: { scheme: Scheme }) {
	const p = PREVIEW[scheme];
	return (
		<div aria-hidden className="relative h-14 overflow-hidden rounded-md border" style={{ background: p.bg, borderColor: p.border }}>
			{/* Mini app bar */}
			<div className="flex h-3.5 items-center justify-center" style={{ background: p.card }}>
				<div className="h-0.5 w-6 rounded-full" style={{ background: p.fg, opacity: 0.7 }} />
			</div>
			{/* Mini card with a primary pill */}
			<div className="absolute bottom-1.5 left-1.5 w-12 rounded p-1" style={{ background: p.card, boxShadow: p.shadow }}>
				<div className="h-0.5 w-6 rounded-full" style={{ background: p.fg }} />
				<div className="mt-0.5 h-1 w-4 rounded-full" style={{ background: p.primary }} />
			</div>
		</div>
	);
}

const rowClass = 'flex w-full items-center justify-between gap-3 px-0.5 py-2.5 text-left';

export default function SettingsPage() {
	const [preference, setPreference] = useState<ThemePreference>(() => loadThemePreference());
	const [system, setSystem] = useState<Scheme>(() => systemScheme());
	const [signOutOpen, setSignOutOpen] = useState(false);
	const [syncing, setSyncing] = useState(false);

	// Live-follow OS scheme flips while on this page (System option + footer).
	useEffect(() => onSystemSchemeChange(setSystem), []);

	// Account identity is a free read — the AuthGate's boot populated the memo.
	const me = getCachedMe();
	const pending = useSyncExternalStore(subscribeQueue, pendingCount, pendingCount);

	const choose = (next: ThemePreference) => {
		if (next === preference) return;
		hapticSelection();
		setPreference(next);
		applyThemePreference(next);
	};

	/** Replay the offline queue on demand — same idempotent flush the connectivity
	 *  watcher runs; here the operator can force it and see the result. */
	const syncNow = async () => {
		hapticImpact('light');
		setSyncing(true);
		try {
			await flushOffline();
		} finally {
			setSyncing(false);
		}
	};

	/** Sign out — drop the session token AND the offline queue (its writes can
	 *  never replay as the next account), then reload so the AuthGate re-arms.
	 *  Without this a shared device could not hand over and pending writes would
	 *  linger against a stale identity. */
	const signOut = () => {
		discardOffline();
		clearToken();
		reloadApp();
	};

	const resolved: Scheme = preference === 'system' ? system : preference;

	return (
		<ModuleShell title="Settings">
			<section aria-labelledby="settings-appearance" className={`${CARD_FRAME} p-3.5 shadow-card`}>
				{/* Header — section label + live active-scheme chip */}
				<div className="flex items-center justify-between px-0.5">
					<div className="flex items-center gap-1.5">
						<Palette className="size-3.5 text-muted-foreground" aria-hidden />
						<h2 id="settings-appearance" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
							Appearance
						</h2>
					</div>
					<span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
						<span className={`size-1.5 rounded-full ${resolved === 'dark' ? 'bg-status-info' : 'bg-status-warning'}`} aria-hidden />
						{SCHEME_LABEL[resolved]}
					</span>
				</div>

				{/* Theme options — accessible radiogroup of preview cards */}
				<div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-2">
					{THEME_OPTIONS.map(({ value, label, caption, icon: Icon }) => {
						const isSelected = preference === value;
						return (
							<button
								key={value}
								type="button"
								role="radio"
								aria-checked={isSelected}
								aria-label={`${caption} (${label})`}
								onClick={() => choose(value)}
								className={`relative flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] ${
									isSelected ? 'border-primary/60 bg-primary/5 ring-1 ring-primary/25' : 'border-border hover:border-primary/30'
								}`}
							>
								{/* Preview — System is a light/dark split */}
								{value === 'system' ? (
									<div aria-hidden className="flex h-14 overflow-hidden rounded-md border border-border">
										<div className="w-1/2">
											<SchemeMockup scheme="light" />
										</div>
										<div className="w-1/2">
											<SchemeMockup scheme="dark" />
										</div>
									</div>
								) : (
									<SchemeMockup scheme={value} />
								)}

								{/* Selected check badge */}
								{isSelected && (
									<span className="absolute top-2.5 right-2.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
										<Check className="size-2.5" strokeWidth={3.5} aria-hidden />
									</span>
								)}

								{/* One-line label */}
								<span className="flex items-center gap-1 px-0.5 pb-0.5 text-xs leading-myanmar">
									<Icon
										className={`size-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
										strokeWidth={2}
										aria-hidden
									/>
									<span className={isSelected ? 'font-semibold text-foreground' : 'text-muted-foreground'}>{label}</span>
								</span>
							</button>
						);
					})}
				</div>

				{/* Footer — one line of live status */}
				<div className="mt-2.5 flex items-center justify-between border-t border-border pt-2 text-meta text-muted-foreground">
					<span>
						{isTelegramApp() ? 'Telegram client' : 'OS preference'} · {SCHEME_LABEL[system]}
					</span>
					<span>{preference === 'system' ? 'Follows device' : 'Saved'}</span>
				</div>
			</section>

			{/* Account — who am I, is anything unsaved, and the way out. The app had
			    NO sign-out at all: a shared device could only be handed over by an
			    admin revoking the Telegram link, and queued writes could not be
			    discarded. */}
			<section aria-labelledby="settings-account" className={`mt-3 ${CARD_FRAME} p-3.5 shadow-card`}>
				<div className="flex items-center gap-1.5 px-0.5">
					<User className="size-3.5 text-muted-foreground" aria-hidden />
					<h2 id="settings-account" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						Account
					</h2>
				</div>

				<dl className="mt-1.5 divide-y divide-border">
					<div className={rowClass}>
						<dt className="text-sm leading-myanmar text-muted-foreground">Signed in as</dt>
						<dd className="min-w-0 truncate text-sm font-semibold leading-myanmar text-foreground">{me?.email ?? '—'}</dd>
					</div>
					<div className={rowClass}>
						<dt className="text-sm leading-myanmar text-muted-foreground">Role</dt>
						<dd className="min-w-0 truncate text-sm font-semibold leading-myanmar text-foreground">
							{me?.role_name ?? (me?.is_admin ? 'Administrator' : '—')}
						</dd>
					</div>
					<div className={rowClass}>
						<dt className="text-sm leading-myanmar text-muted-foreground">Pending changes</dt>
						<dd className="flex items-center gap-2">
							<span className={`text-sm font-semibold tabular-nums ${pending > 0 ? 'text-status-warning' : 'text-foreground'}`}>
								{pending}
							</span>
							{pending > 0 && (
								<button
									type="button"
									disabled={syncing}
									aria-busy={syncing}
									onClick={() => void syncNow()}
									className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} strokeWidth={2.2} aria-hidden />
									Sync
								</button>
							)}
						</dd>
					</div>
				</dl>

				<button
					type="button"
					onClick={() => {
						hapticImpact('light');
						setSignOutOpen(true);
					}}
					className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-semibold leading-myanmar text-destructive transition-transform duration-150 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<LogOut className="size-4" aria-hidden />
					Sign out
				</button>
			</section>

			<ConfirmSheet
				open={signOutOpen}
				title="Sign out?"
				description="You'll return to the sign-in screen. Any changes still waiting to sync will be discarded."
				confirmLabel="Sign out"
				tone="destructive"
				onConfirm={signOut}
				onClose={() => setSignOutOpen(false)}
			/>
		</ModuleShell>
	);
}
