import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FIELD_TYPE_NAMES } from '@mmbix/utils';
import { Badge, Button, Input } from '@mmbix/design-system';
import {
	listGenerationProposals,
	proposeGeneration,
	transitionGeneration,
	updateGenerationFields,
	type GenerationProposalRecord,
} from '../lib/api';
import { blockTypeSummary, confidenceTone, nextGenerationActions, summarizeProposal, type GenerationAction } from '../lib/generation';

/**
 * GenerationPanel — the human gate in the Studio.
 *
 * Paste a DesignDNA (or the prompt-derived DNA an agent produced), Propose, then
 * review the VISIBLE inference per field and walk the state machine:
 * draft → review → promoted → live. Nothing is written until Apply.
 *
 * All view logic lives in `lib/generation.ts` (pure, unit-tested).
 */
const ACTION_LABEL: Record<GenerationAction, string> = {
	submit: 'Submit for review',
	approve: 'Approve',
	reject: 'Reject',
	apply: 'Apply (create app)',
};

const STATUS_TONE: Record<string, string> = {
	draft: '#64748b',
	review: '#b45309',
	promoted: '#1d4ed8',
	live: '#0f766e',
	rejected: '#b91c1c',
};

export default function GenerationPanel({
	token,
	defaultName,
	defaultSlug,
	onApplied,
}: {
	token: string;
	defaultName?: string;
	defaultSlug?: string;
	onApplied?: (slug: string) => void;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState(defaultName ?? '');
	const [slug, setSlug] = useState(defaultSlug ?? '');
	const [dna, setDna] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const proposalsQ = useQuery({
		queryKey: ['generation-proposals'],
		queryFn: () => listGenerationProposals(token),
	});

	const refresh = () => queryClient.invalidateQueries({ queryKey: ['generation-proposals'] });

	const onPropose = async () => {
		setBusy(true);
		setError(null);
		try {
			const trimmed = dna.trim();
			// A JSON object is a DesignDNA; anything else is a plain prompt.
			const body = trimmed.startsWith('{')
				? { collection: { name, slug }, dna: JSON.parse(trimmed) as unknown }
				: { collection: { name, slug }, prompt: trimmed };
			await proposeGeneration(token, body);
			setDna('');
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Proposal failed');
		} finally {
			setBusy(false);
		}
	};

	const onAction = async (record: GenerationProposalRecord, action: GenerationAction) => {
		setBusy(true);
		setError(null);
		try {
			const updated = await transitionGeneration(token, record.id, action);
			if (action === 'apply' && updated.applied_slug) onApplied?.(updated.applied_slug);
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Transition failed');
		} finally {
			setBusy(false);
		}
	};

	// A type edit during review — the backend records it so the NEXT proposal learns.
	const onEditField = async (record: GenerationProposalRecord, name: string, type: string) => {
		setBusy(true);
		setError(null);
		try {
			await updateGenerationFields(token, record.id, [{ name, type }]);
			await refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Edit failed');
		} finally {
			setBusy(false);
		}
	};

	const proposals = proposalsQ.data ?? [];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
				<Input placeholder="Collection name" value={name} onChange={(e) => setName(e.target.value)} />
				<Input placeholder="collection_slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
			</div>
			<textarea
				placeholder='Paste a DesignDNA JSON ({ "source": {...}, "screens": [...] }) — or type a plain prompt like "Invoices with amount: currency, due date"'
				value={dna}
				onChange={(e) => setDna(e.target.value)}
				rows={5}
				style={{
					width: '100%',
					fontFamily: 'monospace',
					fontSize: 12,
					padding: 8,
					borderRadius: 6,
					border: '1px solid var(--mmbix-border, #e2e8f0)',
				}}
			/>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Button size="sm" disabled={busy || !dna.trim() || !name.trim() || !slug.trim()} onClick={() => void onPropose()}>
					Propose
				</Button>
				<span style={{ fontSize: 12, opacity: 0.7 }}>Proposals never write a schema — only Apply does.</span>
			</div>
			{error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}

			<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
				{proposals.map((p) => {
					const summary = summarizeProposal(p.proposal);
					const blockTypes = blockTypeSummary(p.proposal);
					return (
						<div key={p.id} style={{ border: '1px solid var(--mmbix-border, #e2e8f0)', borderRadius: 8, padding: 10 }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
								<strong style={{ fontSize: 13 }}>{p.proposal.collection.name}</strong>
								<Badge variant="outline" style={{ color: STATUS_TONE[p.status] }}>
									{p.status}
								</Badge>
								<span style={{ fontSize: 12, opacity: 0.7, marginLeft: 'auto' }}>
									{summary.fields} fields · {summary.declared} declared / {summary.rules} rules / {summary.heuristic} heuristic
									{summary.relations > 0 ? ` · ${summary.relations} relations` : ''}
									{summary.pages > 0
										? ` · ${summary.pages} page${summary.pages === 1 ? '' : 's'}${blockTypes ? ` (${blockTypes})` : ''}`
										: ''}
									{summary.warnings > 0 ? ` · ${summary.warnings} warnings` : ''}
								</span>
							</div>
							<div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
								{p.proposal.collection.fields.map((f) => {
									const editable = p.status === 'draft' || p.status === 'review';
									return editable ? (
										<label
											key={f.name}
											title={f.inference.reason}
											style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
										>
											{f.name}:
											<select
												value={f.type}
												disabled={busy}
												onChange={(e) => void onEditField(p, f.name, e.target.value)}
												style={{ fontSize: 11, padding: '0 2px' }}
											>
												{FIELD_TYPE_NAMES.map((t) => (
													<option key={t} value={t}>
														{t}
													</option>
												))}
											</select>
										</label>
									) : (
										<span
											key={f.name}
											title={f.inference.reason}
											style={{
												fontSize: 11,
												padding: '1px 6px',
												borderRadius: 999,
												border: '1px solid currentColor',
												opacity: confidenceTone(f.inference.confidence) === 'low' ? 0.6 : 1,
											}}
										>
											{f.name}: {f.type}
										</span>
									);
								})}
							</div>
							{(p.proposal.pages ?? []).length > 0 && (
								<div style={{ marginTop: 6, fontSize: 11, opacity: 0.75 }}>
									{(p.proposal.pages ?? []).map((page) => (
										<div key={page.path}>
											{page.path} · {page.blocks.length} block{page.blocks.length === 1 ? '' : 's'}
										</div>
									))}
								</div>
							)}
							<div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
								{nextGenerationActions(p.status, p.require_review).map((action) => (
									<Button
										key={action}
										size="sm"
										variant={action === 'reject' ? 'outline' : 'default'}
										disabled={busy}
										onClick={() => void onAction(p, action)}
									>
										{ACTION_LABEL[action]}
									</Button>
								))}
								{p.applied_slug && <span style={{ fontSize: 12, alignSelf: 'center', opacity: 0.7 }}>→ {p.applied_slug}</span>}
							</div>
						</div>
					);
				})}
				{proposals.length === 0 && <div style={{ fontSize: 13, opacity: 0.7 }}>No proposals yet.</div>}
			</div>
		</div>
	);
}
