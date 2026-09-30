import { useEffect, useState } from 'react';
import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

/**
 * ApiDocsTab — embed Scalar (modern API reference UI) inside the Studio so every
 * API endpoint can be browsed and clicked through without Postman.
 *
 * Auth: the Studio holds the session token. We fetch the OpenAPI spec ourselves
 * with the token (the backend's /api/openapi.json requires auth), then inject
 * the same token into every "Try it out" request via Scalar's `onBeforeRequest`
 * hook — so no manual auth is ever needed.
 */
export default function ApiDocsTab({ token }: { token: string }) {
	const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch('/api/openapi.json', {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) throw new Error(`Failed to load spec (${res.status})`);
				const data = (await res.json()) as Record<string, unknown>;
				if (!cancelled) setSpec(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [token]);

	if (error) {
		return <p style={{ padding: '1rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Failed to load API docs: {error}</p>;
	}
	if (!spec) {
		return <p style={{ padding: '1rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading API docs…</p>;
	}

	return (
		<div style={{ height: '100%', minHeight: '70vh', overflow: 'auto' }}>
			<ApiReferenceReact
				configuration={{
					content: spec,
					onBeforeRequest: ({ requestBuilder }) => {
						requestBuilder?.headers?.set?.('Authorization', `Bearer ${token}`);
					},
				}}
			/>
		</div>
	);
}
