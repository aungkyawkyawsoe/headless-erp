import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, Button, ModuleGrid, type Module } from '@mmbix/design-system';
import { Box, Settings } from 'lucide-react';
import { BookOpen } from 'lucide-react';
import { Layers } from 'lucide-react';
import { appColor, smartIconFor } from '@mmbix/ui-views';
import { isIdpManagedModule } from '../lib/idp';
import { modulesQuery } from '../lib/queries';
import { invalidateModuleList } from '../lib/query-client';
import { messageOf } from '../lib/errors';
import ManageAppDialog from '../components/ManageAppDialog';
import FullscreenToggle from '../components/FullscreenToggle';
import UserMenu from '../components/UserMenu';

// Business modules (HR / Vehicle / Store) are managed under the IDP catalog, so
// they don't belong on the app-level launcher grid — only system entries remain.

export default function AppsPage({
	token,
	user,
	onLogout,
}: {
	token: string;
	user: { email: string; full_name: string };
	onLogout: () => void;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);

	// The launcher grid and the app workbench read the SAME `qk.modules()` entry,
	// so opening an app costs no extra module read and coming back is instant.
	const modulesQ = useQuery(modulesQuery(token));
	const modules = useMemo(() => (modulesQ.data ?? []).filter((m) => !isIdpManagedModule(m.slug)), [modulesQ.data]);
	const loading = modulesQ.isPending;
	const error = messageOf(modulesQ.error);

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
				<h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Apps</h1>
				{/* Right controls — Manage App (icon-only) then the fullscreen toggle
				 * flush against the right edge of the module grid layout. */}
				<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
					<UserMenu user={user} onLogout={onLogout} />
					<Button size="icon" title="Manage App" aria-label="Manage App" onClick={() => setOpen(true)}>
						<Settings size={15} />
					</Button>
					<FullscreenToggle />
				</div>
			</div>

			{error && (
				<Alert variant="destructive" style={{ marginBottom: '1rem' }}>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{loading ? (
				<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading...</p>
			) : (
				// Design-system ModuleGrid — 6-column tile grid with built-in search.
				// Same component the admin shell's dock uses, so the Studio preview
				// matches the runtime launcher (preview == runtime). A Settings tile
				// (the activity rail is gone) opens the Studio admin page.
				<ModuleGrid
					modules={[
						...modules.map((m): Module => ({
							name: m.name,
							icon: smartIconFor(m.icon, Box),
							iconBackground: m.bg_color ?? appColor(m.slug),
							iconColor: m.icon_color ?? undefined,
						})),
						// System entries — neutral tiles, same level as the app modules.
						// Settings opens the Studio admin; Api opens the Scalar API docs;
						// IDP opens the developer portal.
						{ name: 'Settings', icon: Settings, iconBackground: '#64748b' },
						{ name: 'Api', icon: BookOpen, iconBackground: '#0ea5e9' },
						{ name: 'IDP', icon: Layers, iconBackground: '#8b5cf6' },
					]}
					onSelect={(mod) => {
						if (mod.name === 'Settings') {
							navigate('/studio');
							return;
						}
						if (mod.name === 'Api') {
							navigate('/api-docs');
							return;
						}
						if (mod.name === 'IDP') {
							navigate('/idp');
							return;
						}
						const target = modules.find((m) => m.name === mod.name);
						if (target) navigate(`/apps/${target.slug}`);
					}}
					onClose={() => {
						/* full-page grid — nothing to close after selecting */
					}}
				/>
			)}

			{/* A module write moves only the module LIST — no focused module here. */}
			<ManageAppDialog
				token={token}
				open={open}
				onOpenChange={setOpen}
				modules={modules}
				initialMode="new"
				onSaved={() => void invalidateModuleList(queryClient)}
			/>
		</div>
	);
}
