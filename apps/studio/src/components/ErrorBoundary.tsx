import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
	/** Fallback shown instead of the crashed subtree. */
	fallback?: ReactNode;
	children: ReactNode;
}

interface State {
	error: Error | null;
}

/**
 * Lightweight error boundary — a render exception in the canvas/provider used to
 * blank the whole Studio. Wrap the page-builder canvas (and the app-detail
 * section) so a crash shows a recoverable message instead of a white screen.
 * "Reload" restores the subtree; the error is logged for diagnosis.
 */
export default class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('[studio] render error:', error, info.componentStack);
	}

	private reset = () => this.setState({ error: null });

	render() {
		if (!this.state.error) return this.props.children;
		if (this.props.fallback) return this.props.fallback;
		return (
			<div
				style={{
					flex: 1,
					minHeight: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 10,
					padding: '2rem',
					color: 'var(--mmbix-muted-foreground, #64748b)',
					fontSize: '0.85rem',
					textAlign: 'center',
				}}
			>
				<div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--mmbix-foreground, #0f172a)' }}>This panel hit an error</div>
				<p style={{ margin: 0, maxWidth: 460 }}>
					Something went wrong while rendering this section. Your draft is safe — reload the panel to keep editing.
				</p>
				<code
					style={{
						fontSize: '0.7rem',
						maxWidth: 460,
						overflow: 'auto',
						background: 'var(--mmbix-muted, #f1f5f9)',
						padding: '0.4rem 0.6rem',
						borderRadius: 6,
					}}
				>
					{this.state.error.message}
				</code>
				<button
					type="button"
					onClick={this.reset}
					style={{
						marginTop: 4,
						padding: '0.35rem 0.9rem',
						borderRadius: 7,
						border: 'none',
						cursor: 'pointer',
						background: 'var(--mmbix-primary, #0f766e)',
						color: 'var(--mmbix-primary-foreground, #ffffff)',
						fontSize: '0.78rem',
						fontWeight: 600,
					}}
				>
					Reload panel
				</button>
			</div>
		);
	}
}
