#!/usr/bin/env node
/**
 * db:seed-demos — registers the full block vocabulary (88 types) in
 * design_components WITH demo props, so the Component Catalog can render a
 * storyboard preview straight from the DB (no hardcoded labels in the UI).
 *
 * Run after schema changes:
 *   pnpm db:build && node studio.db/seed-demos.js && pnpm db:dump-seed && pnpm db:build
 *
 * demo_json shape: the block's `config` for a preview render. Containers may
 * include `_children` (array of {type, config}) which the catalog turns into
 * child blocks for a faithful nested preview.
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'studio.db');
const db = new DatabaseSync(dbPath);

/**
 * [name, label, group, icon, defaults_json, demo_json]
 * demo props are the storyboard preview values shown in the catalog.
 */
const COMPONENTS = [
	// ── Layout ──
	['row', 'Row', 'Layout', 'rows-3', { gap: 12 }, { gap: 12, _children: [{ type: 'text', config: { content: 'Block A' } }, { type: 'text', config: { content: 'Block B' } }] }],
	['column', 'Column', 'Layout', 'columns-3', { gap: 12 }, { gap: 12, _children: [{ type: 'heading', config: { content: 'Column', level: 3 } }, { type: 'text', config: { content: 'Nested content inside a column.' } }] }],
	['grid', 'Grid', 'Layout', 'layout-grid', { cols: 3, gap: 16 }, { cols: 3, gap: 12, _children: [{ type: 'card', config: { title: 'A' } }, { type: 'card', config: { title: 'B' } }, { type: 'card', config: { title: 'C' } }] }],
	['tabs', 'Tabs', 'Layout', 'square-stack', {}, { _children: [{ type: 'text', config: { content: 'Tab one content' }, label: 'Tab 1' }, { type: 'text', config: { content: 'Tab two content' }, label: 'Tab 2' }] }],
	['accordion', 'Accordion', 'Layout', 'chevrons-down-up', {}, { _children: [{ type: 'text', config: { content: 'First section content' }, label: 'Section 1' }, { type: 'text', config: { content: 'Second section content' }, label: 'Section 2' }] }],
	['card', 'Card', 'Layout', 'layout-template', { title: 'Card title' }, { title: 'Customer Profile', _children: [{ type: 'text', config: { content: 'Card content goes here — drag blocks inside.' } }] }],
	['spacer', 'Spacer', 'Layout', 'move-vertical', { height: 24 }, { height: 32 }],
	['divider', 'Divider', 'Layout', 'minus', {}, {}],
	['resizable', 'Resizable Panels', 'Layout', 'panels-left-right', { panels: ['Panel A', 'Panel B'] }, { panels: ['Preview', 'Inspector'] }],
	['scroll-area', 'Scroll Area', 'Layout', 'scroll-text', { content: 'Scrollable content — keep going…' }, { content: 'Scrollable panel — scroll me to see more content inside this area.' }],
	['form', 'Form', 'Layout', 'form-input', { title: 'Form', content: 'Form fields go here.' }, { title: 'Contact Form', _children: [{ type: 'field', config: { label: 'Full name', placeholder: 'Enter your name' } }, { type: 'button', config: { label: 'Submit' } }] }],
	['module-grid', 'Module Grid', 'Layout', 'layout-grid', { modules: [] }, { modules: [{ name: 'Sales' }, { name: 'HR' }, { name: 'Inventory' }] }],
	['appshell', 'App Shell', 'Layout', 'app-window', { title: 'My App', items: ['Dashboard', 'Reports', 'Settings'] }, { title: 'Sales Console', items: ['Dashboard', 'Reports', 'Customers', 'Settings'] }],
	['sidebar', 'Sidebar', 'Layout', 'panel-left', { items: ['Dashboard', 'Reports', 'Settings'] }, { items: ['Dashboard', 'Reports', 'Customers', 'Settings'] }],

	// ── Content ──
	['text', 'Text', 'Content', 'type', { content: 'Hello from Studio' }, { content: 'Rich text content goes here — make it yours.' }],
	['heading', 'Heading', 'Content', 'heading-1', { content: 'Heading', level: 2 }, { content: 'Page Heading', level: 2 }],
	['section-header', 'Section Header', 'Content', 'heading-2', { text: 'Section title' }, { text: 'Sales Overview' }],
	['button', 'Button', 'Content', 'mouse-pointer-click', { label: 'Click me', variant: 'default', size: 'default' }, { label: 'Save changes', variant: 'default', size: 'default' }],
	['badge', 'Badge', 'Content', 'tag', { text: 'New', variant: 'default' }, { text: 'New', variant: 'success' }],
	['avatar', 'Avatar', 'Content', 'user-round', { src: '', alt: 'User' }, { fallback: 'MM' }],
	['alert', 'Alert', 'Content', 'alert-triangle', { text: 'This is an alert message.', variant: 'default' }, { text: 'This is an informational alert.', variant: 'default' }],
	['image', 'Image', 'Content', 'image', { url: '', alt: '' }, { url: '', alt: 'Image placeholder' }],
	['skeleton', 'Skeleton', 'Content', 'box', { width: '100%', height: 20 }, { width: '100%', height: 40 }],
	['empty', 'Empty State', 'Content', 'package-open', { title: 'No data', description: 'Nothing here yet.' }, { title: 'No records', description: 'Create your first record to get started.' }],
	['progress', 'Progress', 'Content', 'circle-gauge', { value: 50 }, { value: 65 }],
	['links-card', 'Links Card', 'Content', 'link-2', { title: 'Links', links: [] }, { title: 'Quick Links', links: [{ label: 'Customers', target: 'customers' }, { label: 'Orders', target: 'orders' }] }],
	['choice-card', 'Choice Card', 'Content', 'list-checks', { title: 'Choose', options: [] }, { title: 'Select a plan', _children: [{ type: 'badge', config: { text: 'Basic' } }, { type: 'badge', config: { text: 'Pro' } }] }],
	['separator', 'Separator', 'Content', 'minus', {}, {}],
	['spinner', 'Spinner', 'Content', 'loader-circle', {}, {}],
	['kbd', 'Keyboard Key', 'Content', 'keyboard', { text: 'Ctrl K' }, { text: 'Ctrl K' }],
	['aspect-ratio', 'Aspect Ratio', 'Content', 'frame', { ratio: '16/9', content: 'Aspect ratio box' }, { ratio: '16/9', content: '16:9 media box' }],
	['frame', 'Frame', 'Content', 'frame', { title: 'Frame', content: 'Frame content' }, { title: 'Frame', content: 'Content inside a frame panel.' }],
	['item', 'List Item', 'Content', 'list', { title: 'Item title', description: 'Item description' }, { title: 'User profile', description: 'Edit account settings' }],
	['bubble', 'Bubble', 'Content', 'message-circle', { text: 'Hello there!', side: 'end' }, { text: 'Hello! How can I help?', side: 'end' }],
	['message', 'Message', 'Content', 'message-square', { text: 'This is a message.' }, { text: 'This is a chat message from the team.' }],
	['attachment', 'Attachment', 'Content', 'paperclip', { title: 'report.pdf', description: '128 KB' }, { title: 'invoice.pdf', description: 'PDF · 128 KB' }],
	['collapsible', 'Collapsible', 'Content', 'chevrons-down-up', { title: 'More details', content: 'Collapsible content here.' }, { title: 'More details', content: 'Hidden content revealed on click.' }],
	['carousel', 'Carousel', 'Content', 'gallery-horizontal-end', { items: ['Slide 1', 'Slide 2', 'Slide 3'] }, { items: ['First slide', 'Second slide', 'Third slide'] }],
	['command', 'Command Palette', 'Content', 'command', { placeholder: 'Type a command…', items: ['New page', 'Search', 'Settings'] }, { placeholder: 'Search anything…', items: ['New page', 'Search records', 'Settings'] }],
	['message-scroller', 'Message Scroller', 'Content', 'messages-square', { items: ['Hello', 'How are you?', 'Great!'] }, { items: ['Welcome!', 'How can we help?', 'Feel free to ask.'] }],
		['label', 'Label', 'Content', 'tag', { text: 'Label text' }, { text: 'Full name' }],
		['marker', 'Marker', 'Content', 'map-pin', { title: 'Location', content: 'Marker content' }, { title: 'Main Office', content: '123 Market Street' }],
		['locale-provider', 'Locale Provider', 'Content', 'globe', { locale: 'en-US' }, { locale: 'en-US' }],
		['theme-provider', 'Theme Provider', 'Content', 'palette', { theme: 'light' }, { theme: 'light' }],

	// ── Inputs ──
	['input', 'Text Input', 'Inputs', 'square-pen', { placeholder: 'Enter text...' }, { placeholder: 'Enter your email…' }],
	['textarea', 'Textarea', 'Inputs', 'align-left', { placeholder: 'Enter text...', rows: 3 }, { placeholder: 'Write a comment…', rows: 3 }],
	['select', 'Select', 'Inputs', 'chevrons-up-down', { options: [], placeholder: 'Select...' }, { options: ['In stock', 'Low stock', 'Out of stock'], placeholder: 'Filter by status…' }],
	['combobox', 'Combobox', 'Inputs', 'search', { options: [], placeholder: 'Search...' }, { options: ['Alice', 'Bob', 'Carol'], placeholder: 'Search contacts…' }],
	['checkbox', 'Checkbox', 'Inputs', 'square-check', { label: 'Option', checked: false }, { label: 'Email me updates', checked: true }],
	['switch', 'Switch', 'Inputs', 'toggle-right', { label: 'Toggle', checked: false }, { label: 'Enable notifications', checked: true }],
	['toggle', 'Toggle', 'Inputs', 'toggle-left', { label: 'Toggle', pressed: false }, { label: 'Bold', pressed: true }],
	['radio-group', 'Radio Group', 'Inputs', 'circle-dot', { options: [], value: '' }, { options: ['Weekly', 'Monthly', 'Yearly'], value: 'Monthly' }],
	['slider', 'Slider', 'Inputs', 'sliders-horizontal', { min: 0, max: 100, value: 50 }, { min: 0, max: 100, value: 40 }],
	['rating', 'Rating', 'Inputs', 'star', { value: 0, max: 5 }, { value: 4, max: 5 }],
	['datepicker', 'Date Picker', 'Inputs', 'calendar-days', { value: '' }, { placeholder: 'Pick a due date…' }],
	['color-picker', 'Color Picker', 'Inputs', 'palette', { value: '#3b82f6' }, { value: '#10b981' }],
	['search-box', 'Search Box', 'Inputs', 'search', { placeholder: 'Search...' }, { placeholder: 'Search records…' }],
	['tags-input', 'Tags Input', 'Inputs', 'tags', { tags: [], placeholder: 'Add tag...' }, { tags: ['sales', 'urgent'], placeholder: 'Add tag…' }],
	['field', 'Field (label + input)', 'Inputs', 'square-pen', { label: 'Label', placeholder: 'Enter…' }, { label: 'Company name', placeholder: 'Acme Inc.' }],
	['input-group', 'Input Group', 'Inputs', 'text-cursor-input', { addon: '@', placeholder: 'Input…' }, { addon: '$', placeholder: '0.00' }],
	['input-otp', 'OTP Input', 'Inputs', 'hash', { length: 4 }, { length: 4 }],
	['button-group', 'Button Group', 'Inputs', 'rectangle-horizontal', { buttons: ['Left', 'Center', 'Right'] }, { buttons: ['Day', 'Week', 'Month'] }],
	['toggle-group', 'Toggle Group', 'Inputs', 'toggle-right', { options: ['Bold', 'Italic', 'Underline'] }, { options: ['B', 'I', 'U'] }],
		['native-select', 'Native Select', 'Inputs', 'list-filter', { options: ['Option A', 'Option B'], placeholder: 'Select…' }, { options: ['Weekly', 'Monthly', 'Yearly'], placeholder: 'Billing cycle…' }],

	// ── Overlays ──
	['dialog', 'Dialog', 'Overlays', 'square-stack', { title: 'Dialog', open: false }, { title: 'Confirm action' }],
	['drawer', 'Drawer', 'Overlays', 'panel-right', { title: 'Drawer', side: 'right' }, { title: 'Notification drawer' }],
	['sheet', 'Sheet', 'Overlays', 'panel-right-open', { title: 'Sheet', side: 'right' }, { title: 'Settings sheet' }],
	['popover', 'Popover', 'Overlays', 'messages-square', { content: 'Popover content' }, { content: 'Popover with helpful details.' }],
	['hover-card', 'Hover Card', 'Overlays', 'scan', { content: 'Hover content' }, { content: 'Hover to see more info.' }],
	['tooltip', 'Tooltip', 'Overlays', 'message-circle-question', { content: 'Tooltip text' }, { label: 'Hover me', content: 'I am a tooltip.' }],
	['toast', 'Toast', 'Overlays', 'bell-ring', { title: 'Notification', description: '', variant: 'default' }, { title: 'Changes saved', description: 'Your page was updated.' }],
	['alert-dialog', 'Alert Dialog', 'Overlays', 'alert-triangle', { trigger: 'Open alert', title: 'Are you sure?', description: 'This action cannot be undone.' }, { trigger: 'Delete item', title: 'Delete this record?', description: 'This action cannot be undone.' }],
	['dropdown-menu', 'Dropdown Menu', 'Overlays', 'chevron-down', { trigger: 'Open menu', items: ['Profile', 'Settings', 'Logout'] }, { trigger: 'Actions', items: ['Edit', 'Duplicate', 'Delete'] }],
	['context-menu', 'Context Menu', 'Overlays', 'mouse-pointer-2', { trigger: 'Right-click here', items: ['Cut', 'Copy', 'Paste'] }, { trigger: 'Right-click for options', items: ['Cut', 'Copy', 'Paste'] }],

	// ── Navigation ──
	['breadcrumb', 'Breadcrumb', 'Navigation', 'house', { items: [] }, { items: [{ label: 'Home', target: '#' }, { label: 'Products' }] }],
	['pagination', 'Pagination', 'Navigation', 'chevrons-right', { total: 100, pageSize: 10 }, { total: 120, pageSize: 10 }],
	['menubar', 'Menubar', 'Navigation', 'menu', { items: ['File', 'Edit', 'View'] }, { items: ['File', 'Edit', 'View'] }],
	['navigation-menu', 'Navigation Menu', 'Navigation', 'navigation', { items: ['Home', 'Docs', 'About'] }, { items: ['Home', 'Docs', 'Pricing', 'About'] }],

	// ── Data ──
	['list', 'Entity List', 'Data', 'list', { title: 'Records', collection: '', limit: 10 }, { title: 'Recent records', collection: '' }],
	['kpi', 'KPI (count)', 'Data', 'gauge', { label: 'Records', collection: '' }, { label: 'Total sales', collection: '' }],
	['table', 'Entity Table', 'Data', 'table-2', { title: 'Table', collection: '', limit: 10 }, { title: 'Data table', collection: '' }],
	['entity-card-grid', 'Entity Card Grid', 'Data', 'layout-grid', { title: 'Cards', collection: '', limit: 12 }, { title: 'Card gallery', collection: '' }],
	['entity-form', 'Entity Form', 'Data', 'file-pen-line', { collection: '' }, { collection: '' }],
	['chart', 'Chart', 'Data', 'chart-line', { title: 'Chart', collection: '', groupBy: 'month(created_at)', aggregate: { op: 'count', field: '*' }, chartType: 'line' }, { title: 'Sales trend', collection: '', chartType: 'line' }],
	['report', 'Report', 'Data', 'file-bar-chart', { title: 'Report', collection: '', groupBy: '', aggregates: [{ op: 'count', field: '*' }] }, { title: 'Sales by month', collection: '', groupBy: 'month(created_at)', aggregates: [{ op: 'sum', field: 'amount' }] }],
	['kanban', 'Kanban', 'Data', 'columns-3', { collection: '', groupBy: 'status' }, { collection: '', groupBy: 'status' }],
	['calendar', 'Calendar', 'Data', 'calendar-days', { collection: '', dateField: 'created_at' }, { collection: '', dateField: 'created_at' }],
	['datatable', 'Data Table', 'Data', 'table-2', {}, {}],
	['schema', 'Schema View', 'Data', 'database', {}, {}],

	// ── Rich-card primitives (complex card layouts, e.g. the record card) ──
	['media-panel', 'Media Panel', 'Content', 'media-panel', { initials: 'HW', status: '', code: '', sub: '' }, { initials: 'HW', status: 'success', code: 'HRM-010', sub: 'Sales' }],
	['info-row', 'Info Row', 'Content', 'info-row', { icon: 'phone', label: '', value: '' }, { icon: 'phone', value: '09-421012345' }],
	['counter-chip', 'Counter Chip', 'Content', 'counter-chip', { label: '', count: 0, tone: 'neutral' }, { label: 'Leave Applications', count: 3, tone: 'success' }],
];

const upsert = db.prepare(`
	INSERT INTO design_components (id, name, label, group_name, icon, def_type, defaults_json, capabilities_json, demo_json, is_active, is_system, sort_order)
	VALUES (?, ?, ?, ?, ?, 'page_block', ?, '{"style":true,"events":false,"condition":true,"hidden":true,"slots":false}', ?, 1, 1, ?)
	ON CONFLICT(name) DO UPDATE SET
		label = excluded.label,
		group_name = excluded.group_name,
		icon = excluded.icon,
		defaults_json = excluded.defaults_json,
		demo_json = excluded.demo_json,
		sort_order = excluded.sort_order
`);

COMPONENTS.forEach(([name, label, group, icon, defaults, demo], i) => {
	upsert.run(`core/${name}`, name, label, group, icon, JSON.stringify(defaults), JSON.stringify(demo), i);
});

/* ── Canvas keyboard shortcuts — remappable without code (editable in studio.db) ──
 * action_key is the behavior; key/modifiers are the trigger (e.code values,
 * so Shift works reliably: Shift+Digit1 keeps e.code 'Digit1'). */
const SHORTCUTS = [
	// Width — Shift+1–6 = 2,4,6,8,10,12 · Alt+Shift+1–6 = 1–6 (fixed values).
	// Plain 1–6 are intentionally unmapped. (e.code values, so Shift is safe.)
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
	// Alignment — inside the grid (colStart / alignSelf).
	['align-left', 'KeyL', '', 'Align left'],
	['align-center', 'KeyC', '', 'Align center'],
	['align-right', 'KeyR', '', 'Align right'],
	['align-top', 'KeyT', '', 'Align top'],
	['align-bottom', 'KeyB', '', 'Align bottom'],
	// Visibility — spacebar checks/unchecks (toggles config.hidden).
	['toggle-hidden', 'Space', '', 'Toggle visible/hidden'],
];

const upsertShortcut = db.prepare(`
	INSERT INTO keyboard_shortcuts (action_key, key, modifiers, label, params_json, scope, is_active, sort_order)
	VALUES (?, ?, ?, ?, '{}', 'canvas', 1, ?)
	ON CONFLICT(action_key) DO UPDATE SET
		key = excluded.key,
		modifiers = excluded.modifiers,
		label = excluded.label,
		sort_order = excluded.sort_order
`);
SHORTCUTS.forEach(([actionKey, key, modifiers, label], i) => {
	upsertShortcut.run(actionKey, key, modifiers, label, i);
});
// Purge stale rows — shortcuts REMOVED from the list (e.g. old col-span-* keys)
// must not linger, or they collide with the current map (same key/modifiers →
// stale row wins the alias map and silently breaks the shortcut).
const placeholders = SHORTCUTS.map(() => '?').join(',');
const purge = db.prepare(`DELETE FROM keyboard_shortcuts WHERE action_key NOT IN (${placeholders})`);
purge.run(...SHORTCUTS.map(([actionKey]) => actionKey));

db.close();
console.log(`seed-demos: ${COMPONENTS.length} components + ${SHORTCUTS.length} shortcuts upserted → ${dbPath}`);
