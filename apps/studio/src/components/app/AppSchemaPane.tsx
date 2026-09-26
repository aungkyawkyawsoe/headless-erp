/**
 * AppSchemaPane — the schema (field design) view of the app workbench's
 * collection section: the focused collection's field list plus the one-click
 * launchers for its per-collection governance panels (workflow, permissions,
 * audit, doc-no, policies, generation).
 *
 * Extracted from `AppDetailPage` so the schema surface has ONE reason to
 * change. The parent owns the panels themselves and the focused collection;
 * this pane only reports which panel to open.
 */
import { Badge, Button } from '@mmbix/design-system';
import { Gauge, Hash, History, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import type { CollectionSummary, FieldDefinition } from '../../lib/api';
import { AppSchemaFields } from '../builder/AppSchemaFields';

/** The per-collection governance panels the schema header can open. */
export type AppSchemaPanel = 'workflow' | 'permissions' | 'audit' | 'docno' | 'policies' | 'generation';

export interface AppSchemaPaneProps {
	/** The focused collection. */
	model: CollectionSummary;
	/** Its user-facing fields (system fields already filtered out). */
	visibleFields: FieldDefinition[];
	/** Remove one field from the collection schema. */
	onRemoveField: (name: string) => void;
	/** Open a governance panel for this collection. */
	onOpenPanel: (panel: AppSchemaPanel) => void;
}

/** The schema surface for one focused collection. */
export function AppSchemaPane({ model, visibleFields, onRemoveField, onOpenPanel }: AppSchemaPaneProps) {
	return (
		<>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
				<h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{model.name}</h2>
				<Badge variant="outline">{visibleFields.length} fields</Badge>
				<div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
					<Button size="sm" variant="outline" onClick={() => onOpenPanel('workflow')}>
						<Workflow size={13} /> Workflow
					</Button>
					<Button size="sm" variant="outline" onClick={() => onOpenPanel('permissions')}>
						<ShieldCheck size={13} /> Permissions
					</Button>
					<Button size="sm" variant="outline" onClick={() => onOpenPanel('audit')}>
						<History size={13} /> Audit
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onOpenPanel('docno')}
						title='Auto-number new records — e.g. "OUT-" (OUT-00001) or "OUT-####" (OUT-0001); empty = off'
					>
						<Hash size={13} /> Doc No.
					</Button>
					<Button size="sm" variant="outline" onClick={() => onOpenPanel('policies')}>
						<Gauge size={13} /> Policies
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onOpenPanel('generation')}
						title="Propose fields from a design (reviewed before anything is written)"
					>
						<Sparkles size={13} /> Generate
					</Button>
				</div>
			</div>

			<AppSchemaFields fields={visibleFields} onRemoveField={onRemoveField} />
		</>
	);
}

export default AppSchemaPane;
