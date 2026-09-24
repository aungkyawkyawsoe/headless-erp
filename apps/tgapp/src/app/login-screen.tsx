import { useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { Eye, EyeOff, KeyRound, LogIn, Mail } from 'lucide-react';
import { Button } from '@mmbix/design-system/button';
import { Input } from '@mmbix/design-system/input';

import { loginWithPassword } from '@/shared/auth';

/**
 * Browser (non-Telegram) sign-in — production. A Telegram Mini App launched
 * from inside Telegram logs in automatically with the signed initData; the SAME
 * URL opened in a plain web browser has no Telegram session, so it lands here
 * and signs in with an email + password.
 *
 * WHO can use it: any `_users` account with a real password — the bootstrap
 * admin, admin/HR accounts, and employees whose account is LINKED to their
 * `hrm_employees` row (`_users.employee_id`). A linked account signs in AS that
 * employee, so it can punch, file leave and move stock exactly like the Telegram
 * app; the session is refused the moment the employee is offboarded.
 *
 * Laid out as an OS lock-screen: a large centred "Sign in" is the whole anchor —
 * deliberately NO explanatory copy under it — then the form as bare UNDERLINED
 * fields rather than a boxed card, so the screen reads as one quiet surface with
 * no chrome. The background is the app's `launcher-bg` utility, so it themes with
 * light/dark for free and needs no new tokens.
 *
 * There is no footer line. A "Employees sign in from the Telegram app" note used
 * to sit under the button, to route a Telegram user who had opened the web URL
 * back to the app. Once employees could sign in HERE that sentence described a
 * restricted screen that no longer exists, and copy that understates the form's
 * own capability is worse than none.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (busy) return;
		const em = email.trim();
		if (!em || !password) {
			setError('Enter your email and password.');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await loginWithPassword(em, password);
			onSignedIn();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Sign-in failed — check your credentials and try again.');
			setBusy(false);
		}
	};

	return (
		<div className="launcher-bg flex min-h-dvh flex-col items-center justify-center gap-10 px-7 py-16 text-center">
			<h1 className="text-3xl leading-myanmar font-semibold tracking-tight">Sign in</h1>

			<form onSubmit={(e) => void submit(e)} className="flex w-full max-w-sm flex-col gap-8 text-left">
				<div className="flex flex-col gap-6">
					<AuthField
						id="login-email"
						label="Email"
						icon={<Mail className="size-4" aria-hidden />}
						type="email"
						inputMode="email"
						autoComplete="email"
						autoCapitalize="none"
						spellCheck={false}
						placeholder="you@company.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={busy}
						aria-invalid={error ? true : undefined}
						required
					/>

					<AuthField
						id="login-password"
						label="Password"
						icon={<KeyRound className="size-4" aria-hidden />}
						type={showPassword ? 'text' : 'password'}
						autoComplete="current-password"
						placeholder="••••••••"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={busy}
						aria-invalid={error ? true : undefined}
						required
						trailing={
							<button
								type="button"
								onClick={() => setShowPassword((s) => !s)}
								aria-label={showPassword ? 'Hide password' : 'Show password'}
								className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
							>
								{showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
							</button>
						}
					/>
				</div>

				{error && (
					<p role="alert" className="text-sm leading-myanmar text-destructive">
						{error}
					</p>
				)}

				<Button
					type="submit"
					disabled={busy}
					className="h-13 w-full rounded-full bg-foreground text-key font-semibold text-background shadow-card hover:bg-foreground/90"
				>
					{busy ? (
						'Signing in…'
					) : (
						<>
							Sign in <LogIn className="size-4" aria-hidden />
						</>
					)}
				</Button>
			</form>
		</div>
	);
}

/**
 * One sign-in field in the OS lock-screen idiom: a small caps label, then an
 * icon + the input on a single hairline that lights up while focused. The input
 * is the design-system `Input` with its box removed (`cn` is tailwind-merge, so
 * these win) — `text-base` is deliberate: an input below 16px makes iOS zoom the
 * whole page on focus.
 */
function AuthField({
	id,
	label,
	icon,
	trailing,
	...input
}: {
	id: string;
	label: string;
	icon: ReactNode;
	trailing?: ReactNode;
} & ComponentProps<'input'>) {
	return (
		<div className="flex flex-col gap-2">
			<label htmlFor={id} className="text-meta font-semibold tracking-[0.14em] text-muted-foreground uppercase">
				{label}
			</label>
			<div className="flex items-center gap-3 border-b border-border pb-2.5 transition-colors focus-within:border-foreground">
				<span className="shrink-0 text-muted-foreground">{icon}</span>
				<Input
					id={id}
					{...input}
					className="h-9 rounded-none border-0 bg-transparent px-0 py-0 text-base leading-6 shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-base"
				/>
				{trailing}
			</div>
		</div>
	);
}
