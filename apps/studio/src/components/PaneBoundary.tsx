import { Component, type ReactNode } from 'react';
import { Button } from '@mmbix/design-system';

/**
 * PaneBoundary — error boundary for a studio pane (left/center/right).
 * A render error inside one pane must not kill the whole builder: the broken
 * pane shows a reload affordance while the rest of the workspace keeps working.
 */
export default class PaneBoundary extends Component<{ label?: string; children: ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: unknown) {
		console.error(`[PaneBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info);
	}

	render() {
		if (this.state.error) {
			return (
				<div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
					<strong style={{ fontSize: '0.82rem', color: '#dc2626' }}>This pane hit an error</strong>
					<code style={{ fontSize: '0.72rem', color: '#6b7280', whiteSpace: 'pre-wrap', maxWidth: '100%', overflow: 'auto' }}>
						{String(this.state.error?.message ?? this.state.error)}
					</code>
					<Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
						Reload pane
					</Button>
				</div>
			);
		}
		return this.props.children;
	}
}
