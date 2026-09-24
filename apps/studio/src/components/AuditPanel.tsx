import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@mmbix/design-system';
import { api, type EntitySchema } from '../lib/api';
import { collectionQuery } from '../lib/queries';

/**
 * AuditPanel — Directus-style per-collection audit toggle.
 *
 * Stored in schema_json.audit_enabled (default OFF). When on, every
 * create/update/delete (incl. restore + hard delete) on the collection writes
 * a row to _audit_log with document snapshots.
 */
export default function AuditPanel({
	token,
	slug,
	onSaved,
	schema,
}: {
	token: string;
	slug: string;
	onSaved?: () => void;
	/** The focused collection's schema, when the parent already holds it. Passing it
	 *  avoids a redundant `GET /api/collections/:slug` merely to read the audit flag. */
	schema?: EntitySchema | null;
}) {
	const [enabled, setEnabled] = useState(false);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	// The flag lives on the focused schema. When the parent doesn't pass it, read the
	// SAME cached schema entry (the dialog opens over a collection that is already in
	// the cache, so this is a cache hit — never a second network read).
	const schemaQ = useQuery({ ...collectionQuery(token, slug), enabled: token.length > 0 && !!slug && !schema });
	const stored = !!((schema ?? schemaQ.data)?.schema_json as unknown as { audit_enabled?: boolean } | undefined)?.audit_enabled;

	// Seed the checkbox from server truth; a later change to the flag re-seeds it, a
	// local toggle does not (the derived value is unchanged).
	useEffect(() => setEnabled(stored), [stored]);

	const save = async () => {
		setBusy(true);
		setMsg(null);
		try {
			await api(token, `/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ audit_enabled: enabled }) });
			setMsg(enabled ? 'Audit ON — changes to this collection are now recorded in _audit_log.' : 'Audit OFF — no audit rows are written.');
			onSaved?.();
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} />
				<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Write audit log for this collection</span>
			</div>
			<p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: 0 }}>
				Default OFF — like Directus's audit setting. When enabled, every create / update / delete (including restore and permanent delete)
				records a snapshot entry in <code>_audit_log</code>.
			</p>
			{msg && <p style={{ fontSize: '0.74rem', color: 'var(--mmbix-primary, #2563eb)', margin: 0 }}>{msg}</p>}
			<div>
				<Button size="sm" onClick={save} disabled={busy}>
					{busy ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</div>
	);
}
