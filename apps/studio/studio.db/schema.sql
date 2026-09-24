-- ═══════════════════════════════════════════════════════════════
--  Studio Metadata Database — schema (local-only, git-committed)
--  Source of truth for what the visual page builder can create:
--  components, props, styles, events, views, templates, presets.
--  AI/code-generation tools read THIS file to generate page configs.
-- ═══════════════════════════════════════════════════════════════

-- Tier 1 — Design system catalog ────────────────────────────────

DROP TABLE IF EXISTS design_components;
CREATE TABLE design_components (
	id            TEXT    PRIMARY KEY,           -- 'core/heading'
	name          TEXT    NOT NULL UNIQUE,       -- 'heading'
	label         TEXT    NOT NULL,              -- 'Heading'
	group_name    TEXT    NOT NULL DEFAULT 'Content', -- palette group
	icon          TEXT    NOT NULL DEFAULT 'box',-- lucide icon name
	def_type      TEXT    NOT NULL DEFAULT 'block'
	              CHECK (def_type IN ('page_block','atom','block','module')),
	defaults_json TEXT    NOT NULL DEFAULT '{}', -- initial config
	demo_json     TEXT,                          -- demo props for catalog storyboard preview
	capabilities_json TEXT NOT NULL DEFAULT '{}',-- {"style":true,"events":false,"condition":true,"hidden":true,"slots":false}
	is_active     INTEGER NOT NULL DEFAULT 1,
	is_system     INTEGER NOT NULL DEFAULT 1,    -- 1 = immutable core block
	sort_order    INTEGER NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS component_props;
CREATE TABLE component_props (
	id            TEXT    PRIMARY KEY,
	component_id  TEXT    NOT NULL REFERENCES design_components(id) ON DELETE CASCADE,
	config_key    TEXT    NOT NULL,              -- key inside block.config
	label         TEXT    NOT NULL,
	prop_type     TEXT    NOT NULL DEFAULT 'text'
	              CHECK (prop_type IN ('text','number','select','color','icon','url','collection','toggle','expression','slot','code','report')),
	options_json  TEXT,                          -- [{value,label}] for select
	placeholder   TEXT,
	default_value TEXT,
	is_required   INTEGER NOT NULL DEFAULT 0,
	is_readonly   INTEGER NOT NULL DEFAULT 0,
	hint_text     TEXT,
	sort_order    INTEGER NOT NULL DEFAULT 0,
	UNIQUE (component_id, config_key)
);

DROP TABLE IF EXISTS component_styles;
CREATE TABLE component_styles (
	component_id  TEXT NOT NULL REFERENCES design_components(id) ON DELETE CASCADE,
	style_key     TEXT NOT NULL,                 -- margin|padding|width|radius|textAlign|background
	label         TEXT NOT NULL,
	style_type    TEXT NOT NULL DEFAULT 'preset'
	              CHECK (style_type IN ('preset','color','slider','toggle','input')),
	preset_group  TEXT,                          -- 'size'|'width'|'align'|'radius'
	default_val   TEXT,
	sort_order    INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (component_id, style_key)
);

DROP TABLE IF EXISTS component_events;
CREATE TABLE component_events (
	component_id  TEXT NOT NULL REFERENCES design_components(id) ON DELETE CASCADE,
	event_name    TEXT NOT NULL,                 -- 'onClick'
	event_type    TEXT NOT NULL DEFAULT 'action_list',
	description   TEXT,
	PRIMARY KEY (component_id, event_name)
);

-- Tier 2 — Views & templates ────────────────────────────────────

DROP TABLE IF EXISTS view_modes;
CREATE TABLE view_modes (
	key               TEXT    PRIMARY KEY,       -- 'table'|'form'|'kanban'|'card'|'list'|'calendar'
	label             TEXT    NOT NULL,
	icon              TEXT    NOT NULL,          -- lucide icon name
	data_configurable INTEGER NOT NULL DEFAULT 1, -- has collection/field config
	block_fallback    INTEGER NOT NULL DEFAULT 0, -- shows block stack when no collection
	groupable         INTEGER NOT NULL DEFAULT 0, -- kanban group-by
	field_visible     INTEGER NOT NULL DEFAULT 1, -- field visibility toggles
	sortable          INTEGER NOT NULL DEFAULT 0, -- default sort config
	description       TEXT,
	sort_order        INTEGER NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS page_templates;
CREATE TABLE page_templates (
	key           TEXT PRIMARY KEY,              -- 'table-form'|'full'...
	label         TEXT NOT NULL,
	description   TEXT,
	is_default    INTEGER NOT NULL DEFAULT 0,
	sort_order    INTEGER NOT NULL DEFAULT 0
);

DROP TABLE IF EXISTS template_views;
CREATE TABLE template_views (
	template_id TEXT NOT NULL REFERENCES page_templates(key) ON DELETE CASCADE,
	view_key    TEXT NOT NULL REFERENCES view_modes(key)   ON DELETE CASCADE,
	sort_order  INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (template_id, view_key)
);

-- Tier 3 — Shared presets & actions ─────────────────────────────

DROP TABLE IF EXISTS style_presets;
CREATE TABLE style_presets (
	group_key  TEXT NOT NULL,                    -- 'size'|'width'|'align'|'radius'
	value_key  TEXT NOT NULL,                    -- 'xs'|'sm'...
	label      TEXT NOT NULL,                    -- 'XS'
	css_value  TEXT,                             -- '4px'|'100%'|'center'
	sort_order INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (group_key, value_key)
);

DROP TABLE IF EXISTS event_action_types;
CREATE TABLE event_action_types (
	action_key TEXT PRIMARY KEY,                 -- 'navigate'|'toast'|'dialog'
	label      TEXT NOT NULL,
	params_json TEXT NOT NULL DEFAULT '[]',      -- [{name,label,type,required}]
	sort_order INTEGER NOT NULL DEFAULT 0
);

-- Tier 4 — Design-system introspection (optional, scripted) ─────

DROP TABLE IF EXISTS ds_exports;
CREATE TABLE ds_exports (
	export_name TEXT PRIMARY KEY,                -- 'Button'
	ds_level    TEXT NOT NULL CHECK (ds_level IN ('atom','block','module')),
	category    TEXT NOT NULL DEFAULT 'general',
	has_props   INTEGER NOT NULL DEFAULT 0,
	is_used     INTEGER NOT NULL DEFAULT 0
);

-- Tier 5 — Global studio config ─────────────────────────────────

DROP TABLE IF EXISTS studio_config;
CREATE TABLE studio_config (
	config_key  TEXT PRIMARY KEY,
	config_val  TEXT NOT NULL DEFAULT '{}',
	description TEXT,
	updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tier 6 — Canvas keyboard shortcuts (remappable, no code) ──────
-- action_key = behavior in code; key/modifiers = the remappable trigger.
-- e.code values: Digit1-9, KeyL, KeyC, KeyR, KeyT, KeyB, …

DROP TABLE IF EXISTS keyboard_shortcuts;
CREATE TABLE keyboard_shortcuts (
	action_key  TEXT PRIMARY KEY,               -- 'col-span-3' | 'align-center' | …
	key         TEXT NOT NULL,                  -- e.code: 'Digit3' | 'KeyL' …
	modifiers   TEXT NOT NULL DEFAULT '',       -- '' | 'shift' (ctrl/meta stay app-level)
	label       TEXT NOT NULL,
	description TEXT,
	params_json TEXT NOT NULL DEFAULT '{}',     -- future action params
	scope       TEXT NOT NULL DEFAULT 'canvas', -- 'canvas' | 'global'
	is_active   INTEGER NOT NULL DEFAULT 1,
	sort_order  INTEGER NOT NULL DEFAULT 0
);
