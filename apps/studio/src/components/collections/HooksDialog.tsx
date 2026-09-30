/**
 * Lifecycle hooks viewer — read-only, for one focused collection.
 *
 * TWO kinds of hooks can fire on a collection: COMPILED code hooks (TS
 * registered in the worker at boot — e.g. veh-relink, shown from
 * GET /api/hook-registry) and DECLARATIVE rules (`_server_functions` rows,
 * GET /api/server-functions). Code hooks that REWRITE the focused collection
 * while firing elsewhere (fleet relink → vehicles pointers) appear under their
 * own group so the viewer never answers "Hooks (0)" for a table another hook
 * keeps fresh. Extracted out of the Collections workbench; behaviour unchanged.
 */
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mmbix/design-system';
import type { StudioCodeHook, StudioServerHook } from '../../lib/api';
import { CodeHookCard, parseHookRules } from './workbench-parts';

export interface CollectionHooks {
	codeOnCollection: StudioCodeHook[];
	codeAffectingCollection: StudioCodeHook[];
	hookTotal: number;
}

/**
 * Group the hooks that touch ONE collection: those that FIRE on it, and those
 * that REWRITE it when they fire on ANOTHER collection (e.g. veh-relink keeps
 * fleet pointers fresh from permit/policy writes — so vehicles shows them under
 * "rewrites this collection"). `hooks` is already scoped to the collection.
 */
export function hooksForCollection(hooks: StudioServerHook[], codeHooks: StudioCodeHook[], selected: string | null): CollectionHooks {
	const codeOnCollection = codeHooks.filter((h) => h.collection === selected);
	const codeAffectingCollection = codeHooks.filter((h) => h.collection !== selected && selected != null && h.writes_to.includes(selected));
	return { codeOnCollection, codeAffectingCollection, hookTotal: hooks.length + codeOnCollection.length + codeAffectingCollection.length };
}

export function HooksDialog({
	open,
	onOpenChange,
	collectionName,
	selected,
	hooks,
	codeHooks,
	hooksLoading,
	codeHooksLoading,
	hooksError,
	codeHooksError,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	collectionName: string;
	selected: string | null;
	hooks: StudioServerHook[];
	codeHooks: StudioCodeHook[];
	hooksLoading: boolean;
	codeHooksLoading: boolean;
	hooksError: string | null;
	codeHooksError: string | null;
}) {
	const { codeOnCollection, codeAffectingCollection, hookTotal } = hooksForCollection(hooks, codeHooks, selected);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Lifecycle hooks — {collectionName}</DialogTitle>
					<DialogDescription>
						Lifecycle hooks that run as this collection's records are created / updated / deleted — compiled code hooks registered in the
						worker (e.g. the veh-relink fleet pointer hooks), plus declarative JSON rules stored via <code>POST /api/server-functions</code>
						.
					</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '55vh', overflowY: 'auto' }}>
					{hooksLoading || codeHooksLoading ? (
						<p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading hooks…</p>
					) : hooksError || codeHooksError ? (
						<p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>{hooksError ?? codeHooksError}</p>
					) : hookTotal === 0 ? (
						<div
							style={{
								border: '1px dashed var(--mmbix-border, #e5e7eb)',
								borderRadius: 10,
								padding: '1.5rem 1rem',
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								gap: '0.3rem',
								textAlign: 'center',
							}}
						>
							<p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>No lifecycle hooks touch this collection</p>
							<p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
								Declarative rules are created via <code>POST /api/server-functions</code> with <code>collection_slug: {selected}</code>;
								compiled code hooks live in the domain modules / plugins and are registered on the collections they fire on.
							</p>
						</div>
					) : (
						<>
							{/* Code hooks registered ON this collection. */}
							{codeOnCollection.length > 0 && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
									<div>
										<p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700 }}>Code hooks ({codeOnCollection.length})</p>
										<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
											Compiled TypeScript hooks registered in the worker — they fire on this collection's lifecycle events.
										</p>
									</div>
									{codeOnCollection.map((h, i) => (
										<CodeHookCard key={`${h.plugin_id}-${h.event}-${i}`} hook={h} firingCollection={h.collection} />
									))}
								</div>
							)}
							{/* Code hooks that REWRITE this collection while firing elsewhere. */}
							{codeAffectingCollection.length > 0 && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
									<div>
										<p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700 }}>
											Keep this collection fresh ({codeAffectingCollection.length})
										</p>
										<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
											Code hooks registered on another collection that rewrite rows of this one when they fire — e.g. the fleet relink
											keeping <code>{selected}</code> pointers current.
										</p>
									</div>
									{codeAffectingCollection.map((h, i) => (
										<CodeHookCard key={`aff-${h.plugin_id}-${h.event}-${i}`} hook={h} firingCollection={h.collection} />
									))}
								</div>
							)}
							{/* Declarative server-function rules. */}
							{hooks.length > 0 && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
									<div>
										<p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700 }}>Declarative rules ({hooks.length})</p>
										<p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
											JSON rules stored in <code>_server_functions</code>, managed through the API.
										</p>
									</div>
									{hooks.map((h) => {
										const rules = parseHookRules(h.rules_text);
										return (
											<div
												key={h.id}
												style={{
													border: '1px solid var(--mmbix-border, #e5e7eb)',
													borderRadius: 8,
													padding: '0.6rem 0.75rem',
													display: 'flex',
													flexDirection: 'column',
													gap: '0.4rem',
												}}
											>
												<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
													<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{h.name}</span>
													<span
														style={{
															fontSize: '0.62rem',
															fontWeight: 700,
															textTransform: 'uppercase',
															letterSpacing: '0.04em',
															padding: '2px 8px',
															borderRadius: 999,
															background: 'var(--mmbix-primary, #2563eb)',
															color: 'var(--mmbix-primary-foreground, #ffffff)',
														}}
													>
														{h.trigger_event}
													</span>
													{h.enabled ? (
														<Badge
															variant="outline"
															style={{
																color: 'var(--mmbix-tone-positive-fg, #15803d)',
																background: '#f0fdf4',
																borderColor: '#bbf7d0',
																fontWeight: 600,
															}}
														>
															Enabled
														</Badge>
													) : (
														<Badge
															variant="outline"
															style={{
																color: 'var(--mmbix-muted-foreground, #6b7280)',
																background: '#f3f4f6',
																borderColor: 'var(--mmbix-border, #e5e7eb)',
																fontWeight: 600,
															}}
														>
															Disabled
														</Badge>
													)}
													<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
														Updated {new Date(h.updated_at).toLocaleString()}
													</span>
												</div>
												{rules.length === 0 && h.function_code ? (
													<span style={{ fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
														Legacy function_code (JS) — kept for reference; never executed on the Workers runtime.
													</span>
												) : rules.length === 0 ? null : (
													<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
														<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
															{rules.length} rule{rules.length === 1 ? '' : 's'}
														</span>
														{rules.map((rule, i) => (
															<span
																key={i}
																title={rule.message ?? rule.target ?? rule.action}
																style={{
																	fontSize: '0.62rem',
																	fontWeight: 700,
																	textTransform: 'uppercase',
																	letterSpacing: '0.04em',
																	padding: '2px 8px',
																	borderRadius: 999,
																	background: 'var(--mmbix-muted, #f1f5f9)',
																	color: 'var(--mmbix-muted-foreground, #64748b)',
																}}
															>
																{rule.action}
																{rule.target ? ` → ${rule.target}` : ''}
															</span>
														))}
													</div>
												)}
											</div>
										);
									})}
								</div>
							)}
						</>
					)}
				</div>
				<DialogFooter>
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
