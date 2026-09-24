import { useEffect, useRef, useState } from 'react';
import { Check, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';

/**
 * "ဝင်ခွင့်မရှိပါ" (No access) — shown by the auth gate when the Telegram login
 * answers `pending`, i.e. the user's Telegram ID is NOT registered in the HR
 * employees directory (`hrm_employees.etg_id`). The API recorded a
 * `telegram_requests` row for the admin approval queue; until HR adds the
 * employee record there is no session and nothing else to render.
 *
 * The screen gives the user everything they need to get unblocked: their
 * Telegram ID (copyable, so they can hand it to HR) and a re-check button
 * that re-runs the login once HR has registered them.
 */
export function PendingScreen({
	tgId,
	fullName,
	username,
	onRetry,
}: {
	/** The Telegram ID that failed the directory gate — null when unknown. */
	tgId: string | null;
	/** Telegram display name from the login answer (best-effort context). */
	fullName?: string | null;
	/** Telegram @handle — absent/null when the user hasn't set one (hidden then). */
	username?: string | null;
	/** Re-run the Telegram login — called by ပြန်စစ်ဆေးမည်. */
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);
	// Hold the feedback timer so a quick double-tap can't leave a stray reset.
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const copyId = async () => {
		if (!tgId) return;
		try {
			await navigator.clipboard.writeText(tgId);
			setCopied(true);
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard unavailable (older WebView) — the ID is still visible above.
		}
	};

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-background px-6 py-12 text-center">
			{/* Lock glyph in a soft rounded card */}
			<div className="flex size-24 items-center justify-center rounded-4xl bg-muted ring-1 ring-border/60">
				<Lock className="size-9 text-foreground/80" strokeWidth={1.8} aria-hidden />
			</div>

			<div className="flex flex-col items-center gap-3">
				<h1 className="text-[1.7rem] leading-myanmar font-semibold">Registration Pending</h1>
				<p className="max-w-xs text-key leading-myanmar text-muted-foreground">Take a screenshot and send it to your admin</p>
				{/* Identity line — rendered only when a name and/or @handle is
				    known; users without either just see title + message. */}
				{fullName || username ? (
					<p className="text-sm text-muted-foreground">{[fullName, username ? `@${username}` : null].filter(Boolean).join(' · ')}</p>
				) : null}
			</div>

			<div className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
				<div className="flex items-center justify-between px-1 py-1">
					<span className="text-sm text-muted-foreground">Telegram ID</span>
					<span className="text-lg font-bold tabular-nums">{tgId ?? '—'}</span>
				</div>

				<Button
					onClick={() => void copyId()}
					disabled={!tgId}
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
					onClick={onRetry}
					className="leading-myanmar h-13 w-full rounded-full bg-foreground text-key font-semibold text-background hover:bg-foreground/90"
				>
					Check Again <RefreshCw className="size-4" aria-hidden />
				</Button>
			</div>
		</div>
	);
}
