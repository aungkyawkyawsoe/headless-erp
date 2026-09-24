import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box } from 'lucide-react';
import { Spinner } from '@mmbix/design-system';
import { APP_ICONS } from './icons';
import { authedFetch } from './api';
import { decodeMeta } from './meta-codec';
import { qk } from './query-keys';

/* ── Types (mirror the studio.db rows) ─────────────────────── */

export interface DesignComponent {
	id: string;
	name: string;
	label: string;
	group_name: string;
	icon: string;
	def_type: string;
	defaults_json: string;
	/** Demo props for the catalog's storyboard preview (may include `_children`). */
	demo_json?: string | null;
	capabilities_json: string;
	is_active: number;
	is_system: number;
	sort_order: number;
}
export interface ComponentProp {
	id: string;
	component_id: string;
	config_key: string;
	label: string;
	prop_type: string;
	options_json: string | null;
	placeholder: string | null;
	default_value: string | null;
	is_required: number;
	is_readonly: number;
	hint_text: string | null;
	sort_order: number;
}
export interface ViewMode {
	key: string;
	label: string;
	icon: string;
	data_configurable: number;
	block_fallback: number;
	groupable: number;
	field_visible: number;
	sortable: number;
	description: string | null;
	sort_order: number;
}
export interface PageTemplate {
	key: string;
	label: string;
	description: string | null;
	is_default: number;
	sort_order: number;
}
export interface StylePreset {
	group_key: string;
	value_key: string;
	label: string;
	css_value: string | null;
	sort_order: number;
}
export interface EventAction {
	action_key: string;
	label: string;
	params_json: string;
	sort_order: number;
}

export interface DsExport {
	export_name: string;
	ds_level: 'atom' | 'block' | 'module';
	category: string;
	has_props: number;
	is_used: number;
}

export interface ComponentStyle {
	component_id: string;
	style_key: string;
	label: string;
	style_type: 'preset' | 'color' | 'slider' | 'toggle' | 'input';
	preset_group: string | null;
	default_val: string | null;
	sort_order: number;
}

export interface ComponentEvent {
	component_id: string;
	event_name: string;
	event_type: string;
	description: string | null;
}

/** Canvas keyboard shortcut — action_key is the behavior, key/modifiers the remappable trigger. */
export interface KeyboardShortcut {
	action_key: string;
	key: string; // e.code — 'Digit1' | 'KeyL' …
	modifiers: string; // '' | 'shift'
	label: string;
	description: string | null;
	params_json: string;
	scope: string;
	is_active: number;
	sort_order: number;
}

/** Built-in canvas shortcuts — fallback when the DB hasn't seeded keyboard_shortcuts yet. */
const SHORTCUT_ROWS: [string, string, string, string][] = [
	['w2-1', 'Digit1', 'shift', 'Width 2/12'],
	['w2-2', 'Digit2', 'shift', 'Width 4/12'],
	['w2-3', 'Digit3', 'shift', 'Width 6/12'],
	['w2-4', 'Digit4', 'shift', 'Width 8/12'],
	['w2-5', 'Digit5', 'shift', 'Width 10/12'],
	['w2-6', 'Digit6', 'shift', 'Width 12/12'],
	['w1-1', 'Digit1', 'alt+shift', 'Width 1/12'],
	['w1-2', 'Digit2', 'alt+shift', 'Width 2/12'],
	['w1-3', 'Digit3', 'alt+shift', 'Width 3/12'],
	['w1-4', 'Digit4', 'alt+shift', 'Width 4/12'],
	['w1-5', 'Digit5', 'alt+shift', 'Width 5/12'],
	['w1-6', 'Digit6', 'alt+shift', 'Width 6/12'],
	['align-left', 'KeyL', '', 'Align left'],
	['align-center', 'KeyC', '', 'Align center'],
	['align-right', 'KeyR', '', 'Align right'],
	['align-top', 'KeyT', '', 'Align top'],
	['align-bottom', 'KeyB', '', 'Align bottom'],
	['toggle-hidden', 'Space', '', 'Toggle visible/hidden'],
];

export const DEFAULT_SHORTCUTS: KeyboardShortcut[] = SHORTCUT_ROWS.map(([action_key, key, modifiers, label], i) => ({
	action_key,
	key,
	modifiers,
	label,
	description: null,
	params_json: '{}',
	scope: 'canvas',
	is_active: 1,
	sort_order: i,
}));

/** Derived, ready-to-use metadata (JSON columns parsed, relations joined). */
export interface StudioMeta {
	components: DesignComponent[];
	propsByComponent: Record<string, ComponentProp[]>;
	viewModes: ViewMode[];
	templates: { key: string; label: string; views: string[]; is_default: number; sort_order: number }[];
	stylePresets: Record<string, StylePreset[]>;
	eventActions: EventAction[];
	dsExports: DsExport[];
	stylesByComponent: Record<string, ComponentStyle[]>;
	eventsByComponent: Record<string, ComponentEvent[]>;
	config: Record<string, unknown>;
	configRows: { config_key: string; config_val: string; description: string | null }[];
	capabilities: Record<string, { style?: boolean; events?: boolean; condition?: boolean; hidden?: boolean; slots?: boolean }>;
	shortcuts: KeyboardShortcut[];
}

/* ── Lucide icon registry (DB stores icon NAMES) ──────────── */

/** Map a DB icon name → rendered lucide icon. The registry lives in ./icons
 *  (single source of truth); registered icons are re-cloned at the requested
 *  size so dsIcon(name, 14) honors `size`. */
export function dsIcon(name: string | null | undefined, size = 13): ReactNode {
	const Icon = name ? APP_ICONS[name] : undefined;
	if (Icon) return <Icon size={size} />;
	return <Box size={size} />;
}

/* ── Derive ready-to-use metadata from the raw API snapshot ── */

function parse<T>(json: string | null | undefined, fallback: T): T {
	if (!json) return fallback;
	try {
		return JSON.parse(json) as T;
	} catch {
		return fallback;
	}
}

export function deriveStudioMeta(raw: Record<string, unknown>): StudioMeta {
	const components = (raw.components ?? []) as DesignComponent[];
	const props = (raw.props ?? []) as ComponentProp[];
	const viewModes = (raw.viewModes ?? []) as ViewMode[];
	const templates = (raw.templates ?? []) as PageTemplate[];
	const templateViews = (raw.templateViews ?? []) as { template_id: string; view_key: string }[];
	const stylePresets = (raw.stylePresets ?? []) as StylePreset[];
	const eventActions = (raw.eventActions ?? []) as EventAction[];
	const dsExports = (raw.dsExports ?? []) as DsExport[];
	const rawStyles = (raw.styles ?? []) as ComponentStyle[];
	const rawEvents = (raw.events ?? []) as ComponentEvent[];
	const configRows = Array.isArray(raw.config)
		? (raw.config as { config_key: string; config_val: string; description: string | null }[])
		: [];

	const propsByComponent: Record<string, ComponentProp[]> = {};
	// Key props by the block TYPE (component name) — the same key a block uses in `type`.
	const compNameById: Record<string, string> = {};
	for (const c of components) compNameById[c.id] = c.name;
	for (const p of props) {
		const key = compNameById[p.component_id] ?? p.component_id;
		(propsByComponent[key] ??= []).push(p);
	}
	for (const list of Object.values(propsByComponent)) list.sort((a, b) => a.sort_order - b.sort_order);

	// Same mapping for per-component style/event definitions.
	const stylesByComponent: Record<string, ComponentStyle[]> = {};
	for (const s of rawStyles) {
		const key = compNameById[s.component_id] ?? s.component_id;
		(stylesByComponent[key] ??= []).push(s);
	}
	for (const list of Object.values(stylesByComponent)) list.sort((a, b) => a.sort_order - b.sort_order);

	const eventsByComponent: Record<string, ComponentEvent[]> = {};
	for (const e of rawEvents) {
		const key = compNameById[e.component_id] ?? e.component_id;
		(eventsByComponent[key] ??= []).push(e);
	}

	const stylePresetsByGroup: Record<string, StylePreset[]> = {};
	for (const s of stylePresets) (stylePresetsByGroup[s.group_key] ??= []).push(s);

	const capabilities: StudioMeta['capabilities'] = {};
	for (const c of components) capabilities[c.name] = parse(c.capabilities_json, {});

	const config: Record<string, unknown> = {};
	for (const row of configRows) config[row.config_key] = parse(row.config_val, null);

	// Fall back to built-in defaults when the DB hasn't seeded shortcuts yet
	// (e.g. a dev server still running an older snapshot without the table).
	const rawShortcuts = raw.shortcuts;
	const shortcuts = Array.isArray(rawShortcuts) && rawShortcuts.length > 0 ? (rawShortcuts as KeyboardShortcut[]) : DEFAULT_SHORTCUTS;

	return {
		components,
		propsByComponent,
		viewModes,
		templates: templates
			.map((t) => ({
				key: t.key,
				label: t.label,
				views: templateViews
					.filter((tv) => tv.template_id === t.key)
					.sort((a, b) => (a as unknown as { sort_order: number }).sort_order - (b as unknown as { sort_order: number }).sort_order)
					.map((tv) => tv.view_key),
				is_default: t.is_default,
				sort_order: t.sort_order,
			}))
			.sort((a, b) => a.sort_order - b.sort_order),
		stylePresets: stylePresetsByGroup,
		eventActions,
		dsExports,
		stylesByComponent,
		eventsByComponent,
		config,
		configRows,
		capabilities,
		shortcuts,
	};
}

/* ── Fallback — empty until the provider's fetch resolves. The real catalog is
 *     served by the vite plugin from studio.db (auto-rebuilt from seed when
 *     missing), so this is only a brief pre-fetch placeholder, never a second
 *     hand-maintained copy of the seed. ── */

export const DEFAULT_META: StudioMeta = deriveStudioMeta({});

/* ── Provider ──────────────────────────────────────── */

const StudioMetaContext = createContext<StudioMeta>(DEFAULT_META);
const StudioMetaRefreshContext = createContext<() => void>(() => {});

/** The ONE studio.db metadata read — cached, shared by every consumer, and gated so
 *  nothing renders the builder against an empty catalog. */
export const studioMetaQuery = () =>
	queryOptions({
		queryKey: qk.studioMeta(),
		queryFn: async () => {
			const r = await authedFetch('/__studio/meta');
			if (!r.ok) throw new Error(`studio meta ${r.status}`);
			// The wire is columnar (`meta-codec`); decode back to the object map the
			// rest of the module (and `deriveStudioMeta`) reads.
			return deriveStudioMeta(decodeMeta(await r.json()));
		},
		// The catalog only changes when the Admin console writes to studio.db, which
		// invalidates this key — so within a session it is a constant.
		staleTime: Infinity,
	});

/** Shown only while the very first catalog snapshot for THIS page load resolves.
 *  The provider used to return `null`, so a cold load painted an empty document —
 *  indistinguishable from a crashed app. A visible, branded indicator is honest
 *  about the one read that genuinely gates the builder. */
function StudioMetaLoading() {
	return (
		<div
			style={{
				height: '100vh',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 10,
				fontSize: 14,
				color: 'var(--mmbix-muted-foreground, #64748b)',
			}}
		>
			<Spinner />
			Loading Studio…
		</div>
	);
}

export function StudioMetaProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const metaQ = useQuery(studioMetaQuery());

	const refresh = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.studioMeta() });
	}, [queryClient]);

	// Gate rendering until the first metadata snapshot resolves — the builder reads
	// templates/view-modes/components from meta, so it must not mount on an empty
	// catalog. A failed fetch settles too (isPending false) and falls back to the
	// empty catalog. A session change KEEPS this cache entry (`resetStudioQueries`),
	// so this indicator appears at most once per page load.
	if (metaQ.isPending) return <StudioMetaLoading />;
	const meta = metaQ.data ?? DEFAULT_META;

	return (
		<StudioMetaRefreshContext.Provider value={refresh}>
			<StudioMetaContext.Provider value={meta}>{children}</StudioMetaContext.Provider>
		</StudioMetaRefreshContext.Provider>
	);
}

/** Access the studio metadata (component catalog, templates, presets, …). */
export function useStudioMeta(): StudioMeta {
	return useContext(StudioMetaContext);
}

/** Re-fetch the studio metadata (e.g. after the Admin page writes to studio.db). */
export function useStudioMetaRefresh(): () => void {
	return useContext(StudioMetaRefreshContext);
}
