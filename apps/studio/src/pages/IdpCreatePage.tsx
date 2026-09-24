import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	Alert,
	AlertDescription,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from '@mmbix/design-system';
import { Rocket } from 'lucide-react';
import { scaffoldModule, type IdpTemplate } from '../lib/api';
import { idpTemplatesQuery } from '../lib/queries';
import { invalidateIdp } from '../lib/query-client';
import { messageOf } from '../lib/errors';
import IdpShell from '../components/IdpShell';

/** Auto-generate a slug from a human-readable name, e.g. "Sales CRM" → "sales-crm". */
function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.25rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

export default function IdpCreatePage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Scaffolder dialog state.
	const [scaffoldTemplate, setScaffoldTemplate] = useState<IdpTemplate | null>(null);
	const [scaffoldName, setScaffoldName] = useState('');
	const [scaffoldSlug, setScaffoldSlug] = useState('');
	const [scaffoldError, setScaffoldError] = useState<string | null>(null);
	const [scaffolding, setScaffolding] = useState(false);

	// Golden-path templates are static per deploy (`staleTime: Infinity`).
	const templatesQ = useQuery(idpTemplatesQuery(token));
	const templates = templatesQ.data ?? [];
	const loading = templatesQ.isPending;
	const error = messageOf(templatesQ.error);

	async function runScaffold(e: React.FormEvent) {
		e.preventDefault();
		if (!scaffoldTemplate) return;
		const name = scaffoldName.trim();
		const slug = scaffoldSlug.trim() || slugify(name);
		if (!name || !slug) {
			setScaffoldError('Name is required');
			return;
		}
		setScaffolding(true);
		setScaffoldError(null);
		try {
			const result = await scaffoldModule(token, scaffoldTemplate.name, { name, slug });
			const newSlug = (result.module as { slug?: string })?.slug ?? slug;
			setScaffoldTemplate(null);
			// A scaffolded app appears in the catalog + the launcher grid.
			void invalidateIdp(queryClient);
			navigate(`/idp/${newSlug}`);
		} catch (err) {
			setScaffoldError(err instanceof Error ? err.message : 'Scaffold failed');
		} finally {
			setScaffolding(false);
		}
	}

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Create' }]} activeNav="create">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>Loading…</p>
				) : templates.length === 0 ? (
					<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>No templates available.</p>
				) : (
					templates.map((t) => (
						<div
							key={t.name}
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: '1rem',
								padding: '0.6rem 0.75rem',
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 8,
							}}
						>
							<div style={{ minWidth: 0 }}>
								<div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{t.label}</div>
								<div style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{t.description}</div>
							</div>
							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									setScaffoldTemplate(t);
									setScaffoldName('');
									setScaffoldSlug('');
									setScaffoldError(null);
								}}
							>
								<Rocket size={13} /> New from template
							</Button>
						</div>
					))
				)}

				{/* Scaffold dialog */}
				<Dialog open={scaffoldTemplate !== null} onOpenChange={(open) => !open && setScaffoldTemplate(null)}>
					<DialogContent style={{ maxWidth: 440 }}>
						<DialogHeader>
							<DialogTitle>Scaffold {scaffoldTemplate?.label}</DialogTitle>
							<DialogDescription>Create a new app from the {scaffoldTemplate?.name} golden-path template.</DialogDescription>
						</DialogHeader>
						<form onSubmit={runScaffold} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
							<div>
								<Label>Name</Label>
								<Input
									value={scaffoldName}
									onChange={(e) => {
										setScaffoldName(e.target.value);
										setScaffoldSlug(slugify(e.target.value));
									}}
									placeholder="e.g. Inventory Service"
									required
									autoFocus
								/>
							</div>
							<div>
								<Label>Slug</Label>
								<Input value={scaffoldSlug} onChange={(e) => setScaffoldSlug(e.target.value)} placeholder="inventory-service" required />
							</div>
							{scaffoldError && <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: 0 }}>{scaffoldError}</p>}
							<DialogFooter>
								<Button type="button" variant="outline" onClick={() => setScaffoldTemplate(null)}>
									Cancel
								</Button>
								<Button type="submit" disabled={scaffolding}>
									{scaffolding ? 'Scaffolding…' : 'Scaffold'}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>
		</IdpShell>
	);
}
