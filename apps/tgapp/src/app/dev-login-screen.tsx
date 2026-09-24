import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Check, RefreshCw } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';

import { getDevDevice, resetDevDevice, type DevDevice } from '@/shared/auth';

/**
 * Dev-only sign-in screen — plain browser (no Telegram session), so this
 * browser signs in with its OWN unique, persisted demo Telegram ID instead of
 * real initData. Each browser keeps a distinct id so you can test across two
 * browsers/computers. The worker (dev demo : IS_DEV local-only) still runs the
 * real directory gate, dev.demo included; sign in only when this browser's
 * id is registered in the employee directory (hrm_employees.etg_id), otherwise
 * you land on the register/pending screen:
 *   1. Copy the id below.
 *   2. Register it as this browser's employee etg_id.
 *   3. Sign in → the directory gate answers approved; re-check if you just
 *      registered.
 * Removing that id later logs this browser out (same contract as production).
 * "New id" mints a fresh identity for a second demo user on the same browser.
 * Never rendered in production (import.meta.env.DEV is a dev build flag).
 */
export function DevLoginScreen({ onSignIn }: { onSignIn: () => void }) {
	const [device, setDevice] = useState<DevDevice>(() => getDevDevice());
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	// Hold the feedback timer so a quick double-tap can't leave a stray reset.
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const copyId = async () => {
		try {
			await navigator.clipboard.writeText(String(device.id));
			setCopied(true);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard unavailable — the ID is still visible below.
		}
	};

	const handleNewId = () => {
		// A fresh identity invalidates any session minted under the old one.
		setDevice(resetDevDevice());
		setCopied(false);
	};

	const handleSignIn = () => {
		setBusy(true);
		onSignIn();
	};

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-background px-6 py-12 text-center">
			<div className="flex size-24 items-center justify-center rounded-4xl bg-muted ring-1 ring-border/60">
				<BadgeCheck className="size-9 text-foreground/80" strokeWidth={1.8} aria-hidden />
			</div>

			<div className="flex flex-col items-center gap-3">
				<h1 className="text-[1.7rem] leading-myanmar font-semibold">Dev demo user</h1>
				<p className="max-w-xs text-sm leading-myanmar text-muted-foreground">
					This browser's unique dev demo Telegram ID. Register it as this browser's employee tg_id in the directory to sign in, removing it
					later logs this browser out.
				</p>
			</div>

			<div className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
				<div className="flex items-center justify-between px-1 py-1">
					<span className="text-sm text-muted-foreground">Telegram ID</span>
					<span className="text-lg font-bold tabular-nums">{device.id}</span>
				</div>
				<p className="text-sm text-muted-foreground">
					Persists for this browser only — {device.name}. A real Telegram session (or production) uses your actual employee link instead.
				</p>

				<Button
					onClick={() => void copyId()}
					className="h-13 w-full rounded-full bg-foreground text-key font-semibold text-background hover:bg-foreground/90"
				>
					{copied ? (
						<>
							Copied <Check className="size-4" aria-hidden />
						</>
					) : (
						'Copy Telegram ID'
					)}
				</Button>

				<Button
					onClick={() => void handleSignIn()}
					disabled={busy}
					className="h-13 w-full rounded-full bg-foreground text-key font-semibold text-background hover:bg-foreground/90"
				>
					{busy ? 'Signing in…' : 'Sign in as this dev user'}
				</Button>

				<Button onClick={handleNewId} variant="ghost" className="leading-myanmar text-sm text-muted-foreground">
					<RefreshCw className="size-4" aria-hidden /> New id
				</Button>
			</div>
		</div>
	);
}
