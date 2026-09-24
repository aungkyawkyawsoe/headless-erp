/**
 * MVE (Mobile View Engine) — module template contract.
 *
 * Served by the API (D1 `_mve_templates`) → BFF (cached) → MiniApp client.
 * A template is the JSON-serializable LAYOUT of a miniapp module (list / form /
 * editForm / dashboard configs) keyed by the full module slug (e.g.
 * `store/products`, `hr/leave`).
 *
 * Behavior is deliberately NOT part of a template: loaders, submit handlers,
 * beforeSubmit transforms and dynamic option loading live in the client's
 * per-module behavior registry, keyed by the same slug. The client merges
 * template (layout) + behavior (behavior) at render time — edit a template in
 * the Studio/API and every miniapp install renders it without a redeploy.
 */

/** Display hint for how a field value should be formatted. */
export type MveFieldKind =
	| 'text'
	| 'longtext'
	| 'text_editor'
	| 'number'
	| 'integer'
	| 'currency'
	| 'date'
	| 'datetime'
	| 'time'
	| 'boolean'
	| 'select'
	| 'json'
	| 'location'
	| 'file'
	| 'email'
	| 'phone'
	| 'url';

/** Semantic tones shared by badges and accents (dark/light safe). */
export type MveTone = 'pending' | 'success' | 'danger' | 'neutral' | 'info' | 'warning';

/** One field in a form template. */
export interface MveFieldTemplate {
	key: string;
	kind: MveFieldKind;
	label: string;
	placeholder?: string;
	required?: boolean;
	/** Static choice list (values). Dynamic options come from client behavior. */
	options?: string[];
	/** value → display label for select options */
	optionLabels?: Record<string, string>;
	/** Force the searchable dropdown picker */
	searchable?: boolean;
	/** Context-appropriate boolean labels — e.g. { true: 'တပ်', false: 'မတပ်' } */
	booleanLabels?: { true: string; false: string };
	/** default value for new forms */
	default?: string;
}

/** A tabbed group inside a long form. */
export interface MveGroupTemplate {
	key: string;
	label: string;
	/** Field keys belonging to this group */
	fields: string[];
}

/** Form template — entry/edit forms. */
export interface MveFormTemplate {
	collection: string;
	title: string;
	accent: string;
	/** Record field shown as the page title when editing */
	titleField?: string;
	/** Record field shown under the title in the header */
	subtitleField?: string;
	submitLabel: string;
	fields: MveFieldTemplate[];
	groups?: MveGroupTemplate[];
	successMessage?: string;
}

/** One line inside a list card. */
export interface MveCardLineTemplate {
	key: string;
	icon?: string;
	weight?: 'semibold' | 'normal' | 'muted';
	kind?: MveFieldKind;
	truncate?: number;
	prefix?: string;
	fallback?: string;
}

/** A per-card action (kind resolves to a client handler by slug). */
export interface MveActionTemplate {
	kind: string;
	label: string;
	variant?: 'default' | 'outline' | 'destructive' | 'ghost';
	icon?: string;
	params?: Record<string, unknown>;
}

/** How list cards are composed. */
export interface MveCardTemplate {
	title: MveCardLineTemplate;
	lines?: MveCardLineTemplate[];
	badgeKey?: string;
	/** value → tone map for the badge field */
	badgeToneMap?: Record<string, MveTone>;
	actions?: MveActionTemplate[];
	detailOnClick?: boolean;
}

/** Filter chip row above the list. */
export interface MveTabTemplate {
	label: string;
	field?: string;
	value?: string;
}

/** One read-only row in the record meta strip. */
export interface MveInfoFieldTemplate {
	key: string;
	label: string;
	kind?: MveFieldKind;
	tone?: 'default' | 'danger';
	badgeToneMap?: Record<string, MveTone>;
}

export interface MveDetailFieldTemplate {
	key: string;
	label?: string;
	kind?: MveFieldKind;
	tone?: 'default' | 'danger';
	booleanLabels?: { true: string; false: string };
}

/** List template — the server-driven list screen. */
export interface MveListTemplate {
	collection: string;
	title: string;
	accent: string;
	sort?: string;
	searchFields?: string[];
	tabs?: MveTabTemplate[];
	showTabCounts?: boolean;
	exportable?: boolean;
	card: MveCardTemplate;
	detail?: {
		info?: MveInfoFieldTemplate[];
		fields?: MveDetailFieldTemplate[];
		groups?: MveGroupTemplate[];
	};
	empty?: { title: string; hint?: string };
	pageSize?: number;
}

/**
 * A module's MVE template — everything the client needs to RENDER the module,
 * minus behavior. `version` is bumped on every edit and used for ETag /
 * If-None-Match freshness (the client revalidates instead of guessing TTLs).
 */
export interface MveTemplate {
	/** Full miniapp module key — e.g. 'store/products', 'hr/leave'. */
	slug: string;
	title: string;
	accent: string;
	/** Primary entity collection (the list's collection). */
	collection?: string;
	list?: MveListTemplate;
	form?: MveFormTemplate;
	editForm?: MveFormTemplate;
	/** Dashboard config — opaque today (client interprets it); refined when dashboards go server-driven. */
	dashboard?: Record<string, unknown>;
	version: number;
	updatedAt?: string;
}

/** Raw row shape from D1 (config_json holds list/form/editForm/dashboard). */
export interface MveTemplateRecord {
	slug: string;
	title: string;
	accent: string;
	collection: string | null;
	config_json: string;
	version: number;
	created_at: string;
	updated_at: string;
}
