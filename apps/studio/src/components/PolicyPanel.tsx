import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@mmbix/design-system';
import { setCollectionPolicies, type EntitySchema } from '../lib/api';
import { collectionPoliciesQuery, collectionQuery } from '../lib/queries';
import { invalidateCollectionPolicies } from '../lib/query-client';
import {
	countEncryptedFields,
	POLICY_DEFAULTS,
	policyFormFrom,
	policyPayload,
	warnsAboutEncryptedOffline,
	type PolicyFormState,
} from '../lib/policy-form';

/**
 * Runtime PolicyPanel — the headless control plane in the Studio.
 *
 * Enables/configure/disposes engine behaviors per collection via REST (no code):
 *   - Auto-index advisor (on/off + mode: auto | propose)
 *   - Response cache (on/off + TTL seconds) — SERVER-side (same trust as D1)
 *   - Offline reads (on/off + max age) — CLIENT device persistence
 * Stored in schema_json.policies; the engine reads the merged result through the
 * PolicyResolver. Toggling here applies at runtime — no redeploy.
 *
 * The offline-reads switch is deliberately a different decision from the response
 * cache: that one keeps rows on the server, this one puts them on the user's
 * device, where logout and erasure cannot reach them. So it defaults OFF, and the
 * panel warns when the collection's own schema suggests it is a poor fit.
 *
 * All state mapping lives in `lib/policy-form.ts` (pure, unit-tested); this file
 * only renders it.
 */
export default function PolicyPanel({
	token,
	slug,
	onSaved,
	schema,
}: {
	token: string;
	slug: string;
	onSaved?: () => void;
	/** The focused collection's schema, when the parent already holds it. Passing it
	 *  avoids a redundant `GET /api/collections/:slug` merely to count encrypted
	 *  fields for the offline-reads warning. */
	schema?: EntitySchema | null;
}) {
	const queryClient = useQueryClient();
	const [form, setForm] = useState<PolicyFormState>(POLICY_DEFAULTS);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// The stored policy is server state → one cached read per collection, shared
	// across every open/close of the dialog (a reopen is a cache hit, not a fetch).
	const policiesQ = useQuery(collectionPoliciesQuery(token, slug));
	const stored = policiesQ.data;
	useEffect(() => {
		if (stored) setForm(policyFormFrom(stored));
	}, [stored]);

	// The schema is the only reliable warning signal available here. When the parent
	// already passes it, skip the fetch entirely; otherwise read the SAME cached schema
	// entry (a cache hit — the panel opens over a collection already in the cache).
	const schemaQ = useQuery({ ...collectionQuery(token, slug), enabled: token.length > 0 && !!slug && !schema });
	const resolvedSchema = schema ?? schemaQ.data ?? null;
	const encryptedFieldCount = resolvedSchema ? countEncryptedFields(resolvedSchema.schema_json) : 0;

	const save = async () => {
		setBusy(true);
		setMsg(null);
		setError(null);
		try {
			await setCollectionPolicies(token, slug, policyPayload(form));
			await invalidateCollectionPolicies(queryClient, slug);
			setMsg('Policies saved — applied at runtime, no redeploy.');
			onSaved?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	};

	const offlineRisk = warnsAboutEncryptedOffline(form, encryptedFieldCount);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
			{/* Auto-index advisor */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Switch
					aria-label="Self-tuning indexes"
					checked={form.autoIndex.enabled}
					onCheckedChange={(v) => setForm((s) => ({ ...s, autoIndex: { ...s.autoIndex, enabled: !!v } }))}
				/>
				<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Self-tuning indexes (auto-create for hot multi-column queries)</span>
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
				<span style={{ fontSize: '0.74rem', color: '#9ca3af', width: 70 }}>Mode</span>
				<Select
					value={form.autoIndex.mode}
					onValueChange={(v) => setForm((s) => ({ ...s, autoIndex: { ...s.autoIndex, mode: (v as 'auto' | 'propose') ?? 'auto' } }))}
				>
					<SelectTrigger aria-label="Auto-index mode" style={{ width: 180 }}>
						<SelectValue placeholder="Select mode" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">auto — apply DDL</SelectItem>
						<SelectItem value="propose">propose — recommend only</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Response cache (server) */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
				<Switch
					aria-label="Response cache"
					checked={form.cache.enabled}
					onCheckedChange={(v) => setForm((s) => ({ ...s, cache: { ...s.cache, enabled: !!v } }))}
				/>
				<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Response cache (skip D1 for repeated reads)</span>
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
				<span style={{ fontSize: '0.74rem', color: '#9ca3af', width: 70 }}>TTL (s)</span>
				<Input
					aria-label="Cache TTL seconds"
					type="number"
					min={1}
					value={String(form.cache.ttlS)}
					onChange={(e) => setForm((s) => ({ ...s, cache: { ...s.cache, ttlS: Number(e.target.value) } }))}
					style={{ width: 90 }}
				/>
			</div>

			{/* Offline reads (device) — a different trust boundary from the cache. */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
				<Switch
					aria-label="Offline reads"
					checked={form.offlineReads.enabled}
					onCheckedChange={(v) => setForm((s) => ({ ...s, offlineReads: { ...s.offlineReads, enabled: !!v } }))}
				/>
				<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Offline reads (let the device keep this collection&apos;s rows)</span>
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
				<span style={{ fontSize: '0.74rem', color: '#9ca3af', width: 70 }}>Max age (s)</span>
				<Input
					aria-label="Offline max age seconds"
					type="number"
					min={1}
					value={String(form.offlineReads.maxAgeS)}
					onChange={(e) => setForm((s) => ({ ...s, offlineReads: { ...s.offlineReads, maxAgeS: Number(e.target.value) } }))}
					style={{ width: 90 }}
				/>
			</div>
			{offlineRisk && (
				<p role="alert" style={{ fontSize: '0.72rem', color: '#b91c1c', margin: 0 }}>
					⚠️ This collection has {encryptedFieldCount} encrypted field{encryptedFieldCount === 1 ? '' : 's'}. They are decrypted before the
					response leaves the API, so offline reads would store that plaintext on the device — which is what field encryption protects
					against.
				</p>
			)}
			<p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: 0 }}>
				Offline reads persist read bodies on the user&apos;s device so the app still shows data without a connection — a different trust
				boundary from the server cache above: <strong>logout and erasure requests cannot reach a device copy</strong>, and a shared or lost
				device exposes it. Enable only for masters and a user&apos;s own records; leave collections holding other people&apos;s personal
				data off. The device copy is bounded by <em>max age</em> and is purged on logout.
			</p>

			<p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: 0 }}>
				Headless runtime policies — toggle engine behavior per collection via REST, no code, no redeploy. Auto-index observes real query
				patterns; the response cache is invalidated automatically on every write.
			</p>
			{error && (
				<p role="alert" style={{ fontSize: '0.74rem', color: '#b91c1c', margin: 0 }}>
					{error}
				</p>
			)}
			{msg && <p style={{ fontSize: '0.74rem', color: 'var(--mmbix-primary, #2563eb)', margin: 0 }}>{msg}</p>}
			<div style={{ display: 'flex', gap: 8 }}>
				<Button size="sm" onClick={save} disabled={busy || !policiesQ.isFetched}>
					{busy ? 'Saving…' : 'Save policies'}
				</Button>
			</div>
		</div>
	);
}
