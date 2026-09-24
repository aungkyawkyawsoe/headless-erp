import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@mmbix/design-system';
import { popBack } from '../lib/view-state';

// Lazy-loaded — Scalar is heavy and only needed when the API docs page is opened.
const ApiDocsTab = lazy(() => import('../components/ApiDocsTab'));

/** Full-page Scalar API reference — a standalone destination (opened from the
 *  Apps grid "Api" tile), NOT wrapped in the IDP nav drawer. */
export default function ApiDocsPage({ token }: { token: string }) {
	const navigate = useNavigate();
	return (
		<div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '0.75rem',
					padding: '0.5rem 1rem',
					borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
					background: 'var(--mmbix-background, #fff)',
				}}
			>
				<Button size="icon" variant="outline" title="Back to Apps" aria-label="Back to Apps" onClick={() => popBack(navigate, '/')}>
					<ArrowLeft size={16} />
				</Button>
				<h1 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>API Docs</h1>
			</div>
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
				<Suspense fallback={<p style={{ padding: '1rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading API docs…</p>}>
					<ApiDocsTab token={token} />
				</Suspense>
			</div>
		</div>
	);
}
