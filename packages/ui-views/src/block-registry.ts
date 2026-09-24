/**
 * Shared page-block registry — the single source of truth for which block types
 * the page builder can create (Studio palette + runtime renderer agree by
 * construction, so a new block type works everywhere).
 *
 * Pure data — no JSX. Icons are mapped to components by each app.
 */
export interface BlockRegistryEntry {
	type: string;
	label: string;
	group: string;
	/** Design-system component export name (resolve layer) — must match what the
	 *  shared BlockView renderer ACTUALLY renders for this type. When the renderer
	 *  deliberately renders something else (a hand-rolled markup, a ui-views view,
	 *  a static hint), `resolve` names that reality instead of a DS export that is
	 *  never used. */
	resolve?: string;
	defaults: Record<string, unknown>;
	/** Block types this container accepts as children (null=any, []=leaf). */
	allowedChildren?: string[] | null;
}

export const BLOCK_REGISTRY: BlockRegistryEntry[] = [
	// ── Containers — nest other blocks (row/column → children laid out; tabs/accordion → each child is one panel) ──
	{ type: 'row', label: 'Row', group: 'Layout', defaults: { gap: 12 } },
	{ type: 'column', label: 'Column', group: 'Layout', defaults: { gap: 12 } },
	{ type: 'grid', label: 'Grid', group: 'Layout', defaults: { cols: 3, gap: 16 } },
	{ type: 'tabs', label: 'Tabs', group: 'Layout', defaults: {} },
	{ type: 'accordion', label: 'Accordion', group: 'Layout', defaults: {} },
	{ type: 'card', label: 'Card', group: 'Layout', defaults: { title: 'Card title' } },
	{ type: 'spacer', label: 'Spacer', group: 'Layout', defaults: { height: 24 } },
	{ type: 'divider', label: 'Divider', group: 'Layout', defaults: {} },

	// ── Content — leaf display blocks ──
	{ type: 'text', label: 'Text', group: 'Content', defaults: { content: 'Hello from Studio' } },
	{ type: 'heading', label: 'Heading', group: 'Content', defaults: { content: 'Heading', level: 2 }, resolve: 'Heading' },
	{ type: 'section-header', label: 'Section Header', group: 'Content', defaults: { text: 'Section title' } },
	{
		type: 'button',
		label: 'Button',
		group: 'Content',
		defaults: { label: 'Click me', variant: 'default', size: 'default' },
		resolve: 'Button',
	},
	{ type: 'badge', label: 'Badge', group: 'Content', defaults: { text: 'New', variant: 'default' }, resolve: 'Badge' },
	{ type: 'avatar', label: 'Avatar', group: 'Content', defaults: { src: '', alt: 'User', size: 'default' }, resolve: 'Avatar' },
	{
		type: 'alert',
		label: 'Alert',
		group: 'Content',
		defaults: { text: 'This is an alert message.', variant: 'default' },
		resolve: 'Alert',
	},
	{ type: 'image', label: 'Image', group: 'Content', defaults: { url: '', alt: '' } },
	{ type: 'skeleton', label: 'Skeleton', group: 'Content', defaults: { width: '100%', height: 20 }, resolve: 'Skeleton' },
	{
		type: 'empty',
		label: 'Empty State',
		group: 'Content',
		defaults: { title: 'No data', description: 'Nothing here yet.' },
		resolve: 'Empty',
	},
	{ type: 'progress', label: 'Progress', group: 'Content', defaults: { value: 50 }, resolve: 'Progress' },
	{ type: 'links-card', label: 'Links Card', group: 'Content', defaults: { title: 'Links', links: [] } },
	{ type: 'choice-card', label: 'Choice Card', group: 'Content', defaults: { title: 'Choose', options: [] }, resolve: 'ChoiceCard' },

	// ── Inputs — form controls (leaf blocks) ──
	{ type: 'input', label: 'Text Input', group: 'Inputs', defaults: { placeholder: 'Enter text...' }, resolve: 'Input' },
	{ type: 'textarea', label: 'Textarea', group: 'Inputs', defaults: { placeholder: 'Enter text...', rows: 3 }, resolve: 'Textarea' },
	{ type: 'select', label: 'Select', group: 'Inputs', defaults: { options: [], placeholder: 'Select...' }, resolve: 'NativeSelect' },
	{ type: 'combobox', label: 'Combobox', group: 'Inputs', defaults: { options: [], placeholder: 'Search...' }, resolve: 'Combobox' },
	{ type: 'checkbox', label: 'Checkbox', group: 'Inputs', defaults: { label: 'Option', checked: false }, resolve: 'Checkbox' },
	{ type: 'switch', label: 'Switch', group: 'Inputs', defaults: { label: 'Toggle', checked: false }, resolve: 'Switch' },
	{ type: 'toggle', label: 'Toggle', group: 'Inputs', defaults: { label: 'Toggle', pressed: false }, resolve: 'Toggle' },
	{ type: 'radio-group', label: 'Radio Group', group: 'Inputs', defaults: { options: [], value: '' }, resolve: 'RadioGroup' },
	{ type: 'slider', label: 'Slider', group: 'Inputs', defaults: { min: 0, max: 100, value: 50 }, resolve: 'Slider' },
	{ type: 'rating', label: 'Rating', group: 'Inputs', defaults: { value: 0, max: 5 }, resolve: 'Rating' },
	{ type: 'datepicker', label: 'Date Picker', group: 'Inputs', defaults: { value: '' }, resolve: 'DatePicker' },
	{ type: 'color-picker', label: 'Color Picker', group: 'Inputs', defaults: { value: '#3b82f6' }, resolve: 'ColorPicker' },
	{ type: 'search-box', label: 'Search Box', group: 'Inputs', defaults: { placeholder: 'Search...' }, resolve: 'SearchBox' },
	{ type: 'tags-input', label: 'Tags Input', group: 'Inputs', defaults: { tags: [], placeholder: 'Add tag...' }, resolve: 'TagsInput' },
	{ type: 'field', label: 'Field (label + input)', group: 'Inputs', defaults: { label: 'Label', placeholder: 'Enter…' }, resolve: 'Field' },
	{ type: 'input-group', label: 'Input Group', group: 'Inputs', defaults: { addon: '@', placeholder: 'Input…' }, resolve: 'InputGroup' },
	{ type: 'input-otp', label: 'OTP Input', group: 'Inputs', defaults: { length: 4 }, resolve: 'InputOTP' },
	{
		type: 'button-group',
		label: 'Button Group',
		group: 'Inputs',
		defaults: { buttons: ['Left', 'Center', 'Right'] },
		resolve: 'ButtonGroup',
	},
	{
		type: 'toggle-group',
		label: 'Toggle Group',
		group: 'Inputs',
		defaults: { options: ['Bold', 'Italic', 'Underline'] },
		resolve: 'ToggleGroup',
	},

	// ── Content — more display blocks ──
	{ type: 'separator', label: 'Separator', group: 'Content', defaults: {}, resolve: 'Separator' },
	{ type: 'spinner', label: 'Spinner', group: 'Content', defaults: {}, resolve: 'Spinner' },
	{ type: 'kbd', label: 'Keyboard Key', group: 'Content', defaults: { text: 'Ctrl K' }, resolve: 'Kbd' },
	{
		type: 'aspect-ratio',
		label: 'Aspect Ratio',
		group: 'Content',
		defaults: { ratio: '16/9', content: 'Aspect ratio box' },
		resolve: 'AspectRatio',
	},
	{ type: 'frame', label: 'Frame', group: 'Content', defaults: { title: 'Frame', content: 'Frame content' }, resolve: 'Frame' },
	{
		type: 'item',
		label: 'List Item',
		group: 'Content',
		defaults: { title: 'Item title', description: 'Item description' },
		resolve: 'Item',
	},
	{ type: 'bubble', label: 'Bubble', group: 'Content', defaults: { text: 'Hello there!', side: 'end' }, resolve: 'Bubble' },
	{ type: 'message', label: 'Message', group: 'Content', defaults: { text: 'This is a message.' }, resolve: 'Message' },
	{
		type: 'attachment',
		label: 'Attachment',
		group: 'Content',
		defaults: { title: 'report.pdf', description: '128 KB' },
		resolve: 'Attachment',
	},
	{
		type: 'collapsible',
		label: 'Collapsible',
		group: 'Content',
		defaults: { title: 'More details', content: 'Collapsible content here.' },
		resolve: 'Collapsible',
	},
	{ type: 'carousel', label: 'Carousel', group: 'Content', defaults: { items: ['Slide 1', 'Slide 2', 'Slide 3'] }, resolve: 'Carousel' },
	{
		type: 'command',
		label: 'Command Palette',
		group: 'Content',
		defaults: { placeholder: 'Type a command…', items: ['New page', 'Search', 'Settings'] },
		resolve: 'Command',
	},
	{
		type: 'message-scroller',
		label: 'Message Scroller',
		group: 'Content',
		defaults: { items: ['Hello', 'How are you?', 'Great!'] },
		resolve: 'MessageScroller',
	},

	// ── Overlays — menus & dialogs ──
	{
		type: 'alert-dialog',
		label: 'Alert Dialog',
		group: 'Overlays',
		defaults: { trigger: 'Open alert', title: 'Are you sure?', description: 'This action cannot be undone.' },
		resolve: 'AlertDialog',
	},
	{
		type: 'dropdown-menu',
		label: 'Dropdown Menu',
		group: 'Overlays',
		defaults: { trigger: 'Open menu', items: ['Profile', 'Settings', 'Logout'] },
		resolve: 'DropdownMenu',
	},
	{
		type: 'context-menu',
		label: 'Context Menu',
		group: 'Overlays',
		defaults: { trigger: 'Right-click here', items: ['Cut', 'Copy', 'Paste'] },
		resolve: 'ContextMenu',
	},

	// ── Navigation ──
	{ type: 'menubar', label: 'Menubar', group: 'Navigation', defaults: { items: ['File', 'Edit', 'View'] }, resolve: 'Menubar' },
	{
		type: 'navigation-menu',
		label: 'Navigation Menu',
		group: 'Navigation',
		defaults: { items: ['Home', 'Docs', 'About'] },
		resolve: 'NavigationMenu',
	},

	// ── Layout — panels & containers ──
	{ type: 'resizable', label: 'Resizable Panels', group: 'Layout', defaults: { panels: ['Panel A', 'Panel B'] }, resolve: 'Resizable' },
	{
		type: 'scroll-area',
		label: 'Scroll Area',
		group: 'Layout',
		defaults: { content: 'Scrollable content — keep going…' },
		resolve: 'ScrollArea',
	},
	{ type: 'form', label: 'Form', group: 'Layout', defaults: { title: 'Form', content: 'Form fields go here.' }, resolve: 'Form' },
	{ type: 'module-grid', label: 'Module Grid', group: 'Layout', defaults: { modules: [] }, resolve: 'ModuleGrid' },
	{
		type: 'appshell',
		label: 'App Shell',
		group: 'Layout',
		defaults: { title: 'My App', items: ['Dashboard', 'Reports', 'Settings'] },
		resolve: 'AppShell',
	},
	{ type: 'sidebar', label: 'Sidebar', group: 'Layout', defaults: { items: ['Dashboard', 'Reports', 'Settings'] }, resolve: 'Sidebar' },
	{ type: 'datatable', label: 'Data Table', group: 'Data', defaults: {}, resolve: 'DataTable' },
	{ type: 'schema', label: 'Schema View', group: 'Data', defaults: {}, resolve: 'schema-hint' },
	{ type: 'marker', label: 'Marker', group: 'Content', defaults: { title: 'Location', content: 'Marker content' }, resolve: 'Marker' },
	{
		type: 'native-select',
		label: 'Native Select',
		group: 'Inputs',
		defaults: { options: ['Option A', 'Option B'], placeholder: 'Select…' },
		resolve: 'NativeSelect',
	},
	{ type: 'label', label: 'Label', group: 'Content', defaults: { text: 'Label text' }, resolve: 'Label' },
	{ type: 'locale-provider', label: 'Locale Provider', group: 'Content', defaults: { locale: 'en-US' }, resolve: 'locale-badge' },
	{ type: 'theme-provider', label: 'Theme Provider', group: 'Content', defaults: { theme: 'light' }, resolve: 'theme-badge' },

	// ── Dialogs & Overlays — container-like: the renderer renders their child
	// blocks (a static placeholder in the page flow), so they accept children
	// (allowedChildren unset = any). ──
	{
		type: 'dialog',
		label: 'Dialog',
		group: 'Overlays',
		defaults: { title: 'Dialog', open: false },
		// Rendered as a static placeholder whose children DO render (block-renderer),
		// so it accepts children — matching the renderer instead of a leaf.
		resolve: 'Dialog',
		allowedChildren: null,
	},
	{
		type: 'drawer',
		label: 'Drawer',
		group: 'Overlays',
		defaults: { title: 'Drawer', side: 'right' },
		resolve: 'Drawer',
		allowedChildren: null,
	},
	{
		type: 'sheet',
		label: 'Sheet',
		group: 'Overlays',
		defaults: { title: 'Sheet', side: 'right' },
		resolve: 'Sheet',
		allowedChildren: null,
	},
	{ type: 'popover', label: 'Popover', group: 'Overlays', defaults: { content: 'Popover content' }, resolve: 'Popover' },
	{ type: 'hover-card', label: 'Hover Card', group: 'Overlays', defaults: { content: 'Hover content' }, resolve: 'HoverCard' },
	{ type: 'tooltip', label: 'Tooltip', group: 'Overlays', defaults: { content: 'Tooltip text' }, resolve: 'Tooltip' },
	{
		type: 'toast',
		label: 'Toast',
		group: 'Overlays',
		defaults: { title: 'Notification', description: '', variant: 'default' },
		resolve: 'Toast',
	},

	// ── Navigation — leaf blocks ──
	{ type: 'breadcrumb', label: 'Breadcrumb', group: 'Navigation', defaults: { items: [] }, resolve: 'Breadcrumb' },
	{ type: 'pagination', label: 'Pagination', group: 'Navigation', defaults: { total: 100, pageSize: 10 }, resolve: 'Pagination' },

	// ── Data — collection-bound blocks ──
	{ type: 'list', label: 'Entity List', group: 'Data', defaults: { title: 'Records', collection: '', limit: 10 } },
	{ type: 'kpi', label: 'KPI (count)', group: 'Data', defaults: { label: 'Records', collection: '' } },
	{ type: 'table', label: 'Entity Table', group: 'Data', defaults: { title: 'Table', collection: '', limit: 10 } },
	{ type: 'entity-card-grid', label: 'Entity Card Grid', group: 'Data', defaults: { title: 'Cards', collection: '', limit: 12 } },
	{ type: 'entity-form', label: 'Entity Form', group: 'Data', defaults: { collection: '' } },
	{
		type: 'chart',
		label: 'Chart',
		group: 'Data',
		defaults: { title: 'Chart', collection: '', groupBy: 'month(created_at)', aggregate: { op: 'count', field: '*' }, chartType: 'line' },
		// The shared renderer draws charts via ui-views ChartView (a tiny SVG),
		// not the DS recharts bundle — naming that here keeps metadata honest.
		resolve: 'ChartView',
	},
	{
		type: 'report',
		label: 'Report',
		group: 'Data',
		defaults: { title: 'Report', collection: '', groupBy: '', aggregates: [{ op: 'count', field: '*' }] },
		resolve: 'Report',
	},
	{
		type: 'pivot',
		label: 'Pivot Table',
		group: 'Data',
		defaults: {
			title: 'Pivot',
			collection: '',
			rowGroup: '',
			columnGroup: '',
			aggregate: { op: 'count', field: '*', alias: 'count_all' },
			showTotals: false,
		},
		resolve: 'PivotTable',
	},
	{ type: 'kanban', label: 'Kanban', group: 'Data', defaults: { collection: '', groupBy: 'status' }, resolve: 'Kanban' },
	{ type: 'calendar', label: 'Calendar', group: 'Data', defaults: { collection: '', dateField: 'created_at' }, resolve: 'Calendar' },

	// ── Rich-card primitives (complex card layouts, e.g. the record card) ──
	{
		type: 'media-panel',
		label: 'Media Panel',
		group: 'Content',
		defaults: { initials: 'HW', status: '', code: '', sub: '' },
		resolve: 'MediaPanel',
	},
	{ type: 'info-row', label: 'Info Row', group: 'Content', defaults: { icon: 'phone', label: '', value: '' }, resolve: 'InfoRow' },
	{
		type: 'counter-chip',
		label: 'Counter Chip',
		group: 'Content',
		defaults: { label: '', count: 0, tone: 'neutral' },
		resolve: 'CounterChip',
	},
];

export function blockDefaults(type: string): Record<string, unknown> {
	return BLOCK_REGISTRY.find((b) => b.type === type)?.defaults ?? {};
}

/** Block types that contain child blocks (nesting) — the exact set the shared
 *  renderer renders children for: layout containers + card/grid/empty/form/
 *  choice-card + the overlay group (dialog/drawer/sheet/popover/hover-card/toast
 *  render their children as a static page-flow placeholder). Studio nesting UI
 *  (isContainerType) and the runtime renderer agree by construction. */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([
	'row',
	'column',
	'tabs',
	'accordion',
	'grid',
	'card',
	'empty',
	'form',
	'choice-card',
	'dialog',
	'drawer',
	'sheet',
	'popover',
	'hover-card',
	'toast',
]);

export function isContainerType(type: string): boolean {
	return CONTAINER_TYPES.has(type);
}

/**
 * Grid column span for a top-level block in a page's responsive 12-column grid
 * (Frappe workspace style — compact cards 3-per-row, full-width sections/charts/tables).
 * Uses `layout.colSpan` when the Studio set it (1–12 via the width shortcut: press 1–6,
 * or Shift+1–6 for 2–12), otherwise falls back by type.
 */
const DEFAULT_COLSPAN: Record<string, number> = {
	'links-card': 4,
	kpi: 4,
};

export function blockColSpan(block: { type: string; layout?: { colSpan?: number } }): number {
	const span = Number(block.layout?.colSpan);
	if (span >= 1 && span <= 12) return span;
	return DEFAULT_COLSPAN[block.type] ?? 12;
}
