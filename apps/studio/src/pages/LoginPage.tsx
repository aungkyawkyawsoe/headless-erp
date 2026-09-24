import { useState, type CSSProperties, type FormEvent, type ReactElement } from 'react';
import { Button, Input } from '@mmbix/design-system';
import { Boxes, Eye, EyeOff, Lock, Mail, MoveRight } from 'lucide-react';
import { loginApi } from '../lib/api';

// The DS components' default `h-7` (28px) sizing reads as a compact dev tool.
// Enterprise sign-in forms use roomier controls — matching this page's lighter
// touch by bumping the control height and full-width fields here via inline
// style (the studio styles everything inline, see AppsPage etc.), overriding
// the inherited utility height.
const controlHeight: CSSProperties = { height: 42, borderRadius: 10 };

type FieldProps = {
	label: string;
	icon: ReactElement;
	children: ReactElement;
};

function Field({ label, icon, children }: FieldProps) {
	return (
		// Each field is its own stacked group: label row, then the control. The
		// label and control share the same left edge (no negative margins), and
		// every group uses the same vertical rhythm so the form reads as aligned.
		<label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
			<span
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					color: 'var(--mmbix-foreground, #0f172a)',
					fontSize: 13,
					fontWeight: 600,
				}}
			>
				{icon}
				{label}
			</span>
			{children}
		</label>
	);
}

export default function LoginPage({ onLogin }: { onLogin: (token: string, user: { email: string; full_name: string }) => void }) {
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function submit(e: FormEvent) {
		e.preventDefault();
		setLoading(true);
		setError(null);
		try {
			const { token, user } = await loginApi(email, password);
			onLogin(token, user);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Login failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div
			style={{
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '100vh',
				padding: '2rem 1.25rem',
				boxSizing: 'border-box',
				background:
					'radial-gradient(1100px 500px at 70% -10%, rgba(20,184,166,0.16), transparent 60%), radial-gradient(900px 520px at 8% 110%, rgba(15,118,110,0.12), transparent 55%), var(--mmbix-background, #f8fafc)',
			}}
		>
			{/* Card container — centered card over the tinted backdrop. */}
			<div
				style={{
					width: '100%',
					maxWidth: 420,
					display: 'flex',
					flexDirection: 'column',
					gap: '1.5rem',
				}}
			>
				{/* Brand header */}
				<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', textAlign: 'center' }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 48,
							height: 48,
							borderRadius: 12,
							background: 'linear-gradient(135deg, var(--mmbix-primary,#0f766e), #134e4a)',
							color: '#fff',
							boxShadow: '0 8px 20px -6px rgba(13,148,136,0.5)',
						}}
					>
						<Boxes size={26} strokeWidth={1.8} />
					</div>
					<h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--foreground, #0f172a)' }}>
						Sign in to your workspace
					</h1>
					<p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--mmbix-muted-foreground, #64748b)', maxWidth: 340 }}>
						Welcome back to Headless Studio. Enter your credentials to manage collections, schemas, and pages.
					</p>
				</div>

				{/* Sign-in form */}
				<div
					style={{
						background: 'var(--mmbix-card, #ffffff)',
						borderRadius: 16,
						padding: '1.75rem',
						border: '1px solid var(--mmbix-border, #e2e8f0)',
						boxShadow: '0 12px 32px -12px rgba(15, 23, 42, 0.16)',
					}}
				>
					{error && (
						<div
							role="alert"
							style={{
								display: 'flex',
								alignItems: 'flex-start',
								gap: 8,
								padding: '0.6rem 0.75rem',
								borderRadius: 10,
								background: '#fef2f2',
								border: '1px solid #fecaca',
								color: '#b91c1c',
								fontSize: '0.8125rem',
								lineHeight: 1.4,
								marginBottom: '1.25rem',
							}}
						>
							<Lock size={14} style={{ marginTop: 1, flexShrink: 0 }} />
							<span>{error}</span>
						</div>
					)}

					<form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
						<Field label="Email" icon={<Mail size={15} />}>
							<Input
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								type="email"
								required
								autoComplete="email"
								placeholder="admin@my.co"
								style={controlHeight}
							/>
						</Field>

						<Field label="Password" icon={<Lock size={15} />}>
							<div style={{ position: 'relative' }}>
								<Input
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									type={showPassword ? 'text' : 'password'}
									required
									autoComplete="current-password"
									placeholder="Enter your password"
									style={{ ...controlHeight, paddingRight: 44 }}
								/>
								<button
									type="button"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									title={showPassword ? 'Hide password' : 'Show password'}
									onClick={() => setShowPassword((s) => !s)}
									style={{
										position: 'absolute',
										top: '50%',
										right: 6,
										transform: 'translateY(-50%)',
										display: 'flex',
										alignItems: 'center',
										justifyContent: 'center',
										width: 32,
										height: 32,
										border: 'none',
										background: 'transparent',
										borderRadius: 8,
										color: 'var(--mmbix-muted-foreground, #64748b)',
										cursor: 'pointer',
										opacity: password ? 1 : 0.6,
									}}
								>
									{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
								</button>
							</div>
						</Field>

						<Button type="submit" disabled={loading} style={{ ...controlHeight, marginTop: '0.25rem', fontSize: 15, gap: 8 }}>
							{loading ? 'Signing in…' : 'Sign in'}
							{!loading && <MoveRight size={17} />}
						</Button>
					</form>
				</div>

				{/* Muted footer */}
				<p style={{ margin: 0, textAlign: 'center', fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #64748b)' }}>
					Authorized use only. Access is audited and restricted to provisioned accounts.
				</p>
			</div>
		</div>
	);
}
