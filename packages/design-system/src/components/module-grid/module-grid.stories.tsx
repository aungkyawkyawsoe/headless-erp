import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
	BarChart3,
	Calculator,
	Car,
	Clock,
	FileText,
	Fuel,
	Map,
	Package,
	Receipt,
	Shield,
	Truck,
	Users,
	Warehouse,
	Wrench,
} from 'lucide-react';

import { ModuleGrid, ModuleGridPagination, type Module } from './';

const modules: Module[] = [
	{ name: 'Logistics', icon: Package },
	{ name: 'HRM', icon: Users },
	{ name: 'MRO', icon: Wrench },
	{ name: 'Vehicle', icon: Car },
	{ name: 'Fuel', icon: Fuel },
	{ name: 'Accounting', icon: Calculator },
	{ name: 'Finance', icon: Receipt },
	{ name: 'Warehouse', icon: Warehouse },
	{ name: 'Inventory', icon: Package },
	{ name: 'Procurement', icon: Truck },
	{ name: 'Sales', icon: BarChart3 },
	{ name: 'CRM', icon: Users },
	{ name: 'Compliance', icon: Shield },
	{ name: 'Documents', icon: FileText },
	{ name: 'Fleet', icon: Truck },
	{ name: 'Dispatch', icon: Clock },
	{ name: 'Route Planner', icon: Map },
];

// A longer list so the grid pages across two pages (18 items per page).
const pagedModules: Module[] = [
	...modules,
	{ name: 'Quality', icon: Shield },
	{ name: 'Safety', icon: Shield },
	{ name: 'Training', icon: Users },
	{ name: 'Assets', icon: Truck },
	{ name: 'Maintenance', icon: Wrench },
	{ name: 'Suppliers', icon: Truck },
	{ name: 'Customers', icon: Users },
];

const burmeseModules: Module[] = [
	{ name: 'ထောက်ပံ့', icon: Package },
	{ name: 'လူ့စွမ်းအား', icon: Users },
	{ name: 'ပြုပြင်ရေး', icon: Wrench },
	{ name: 'ယာဉ်များ', icon: Car },
	{ name: 'လောင်စာဆီ', icon: Fuel },
	{ name: 'စာရင်း', icon: Calculator },
	{ name: 'ဘဏ္ဍာ', icon: Receipt },
	{ name: 'ဂိုဒေါင်', icon: Warehouse },
	{ name: 'ကုန်စာရင်း', icon: Package },
	{ name: 'ဝယ်ယူရေး', icon: Truck },
	{ name: 'အရောင်း', icon: BarChart3 },
	{ name: 'ဖောက်သည်', icon: Users },
	{ name: 'လိုက်နာမှု', icon: Shield },
	{ name: 'စာတမ်းများ', icon: FileText },
	{ name: 'ယာဉ်တန်း', icon: Truck },
	{ name: 'စေလွှတ်မှု', icon: Clock },
	{ name: 'လမ်းကြောင်း', icon: Map },
];

// Muted, earthy "vintage" palette — warm terracotta, olive, mustard,
// faded teal, and dusty plum. White icons stay readable on all of them.
const palette = [
	{ iconBackground: '#b0552e', iconColor: '#ffffff' },
	{ iconBackground: '#6e7450', iconColor: '#ffffff' },
	{ iconBackground: '#b08a2e', iconColor: '#ffffff' },
	{ iconBackground: '#47787a', iconColor: '#ffffff' },
	{ iconBackground: '#8b5e6f', iconColor: '#ffffff' },
];

/**
 * A full-screen stage that mimics the module switcher backdrop so the
 * grid can be previewed in isolation (the switcher itself portals this
 * overlay to `document.body`).
 */
function GridStage({ children }: { children: React.ReactNode }) {
	return <div className="flex h-svh w-full flex-col bg-background/95 backdrop-blur-md">{children}</div>;
}

/**
 * ModuleGrid renders the tappable module tiles from the module switcher as a
 * standalone component with a built-in search box. Compose it with
 * `ModuleGridPagination` to page long module lists.
 */
const meta: Meta<typeof ModuleGrid> = {
	title: 'Components/ModuleGrid',
	component: ModuleGrid,
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'The module grid extracted from the AppShell module switcher. <b>ModuleGrid</b> renders a responsive grid of <b>ModuleGridItem</b> tiles (icon + label) with a built-in <b>SearchBox</b> to filter by name, and highlights the active module; <b>ModuleGridPagination</b> renders the page dots for paged lists.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A 6-column grid of module tiles with a built-in search box — type to filter tiles by name. Clicking a tile selects it — the active module gets an accent background. Use <code>activeModuleName</code> to control which tile is highlighted.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState(modules[0]);
		return (
			<GridStage>
				<ModuleGrid modules={modules} activeModuleName={selected.name} onSelect={setSelected} onClose={() => {}} />
			</GridStage>
		);
	},
};

// ── Search ───────────────────────────────────────────────

export const Search: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The grid ships with a <code>SearchBox</code> that filters tiles by name as you type. It works uncontrolled out of the box; pass <code>searchValue</code> and <code>onSearchChange</code> for a controlled query. This story starts pre-filtered to "e".',
			},
		},
	},
	render: function SearchStory() {
		const [query, setQuery] = React.useState('e');
		const [selected, setSelected] = React.useState<Module>(modules.find((m) => m.name === 'Fuel') ?? modules[0]);
		return (
			<GridStage>
				<ModuleGrid
					modules={modules}
					activeModuleName={selected.name}
					searchValue={query}
					onSearchChange={setQuery}
					onSelect={setSelected}
					onClose={() => {}}
				/>
			</GridStage>
		);
	},
};

// ── Without Search ───────────────────────────────────────

export const WithoutSearch: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass <code>showSearch={false}</code> to hide the built-in search box when the surrounding UI already provides one — the <code>ModuleSwitcher</code> does exactly this.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState(modules[0]);
		return (
			<GridStage>
				<ModuleGrid
					modules={modules.slice(0, 12)}
					activeModuleName={selected.name}
					showSearch={false}
					onSelect={setSelected}
					onClose={() => {}}
				/>
			</GridStage>
		);
	},
};

// ── Four Columns ────────────────────────────────────────

export const FourColumns: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Pass <code>columns</code> to change the number of tiles per row. Four columns gives larger tiles that suit shorter module lists.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState(modules[0]);
		return (
			<GridStage>
				<ModuleGrid modules={modules.slice(0, 12)} activeModuleName={selected.name} columns={4} onSelect={setSelected} onClose={() => {}} />
			</GridStage>
		);
	},
};

// ── Custom Module Colors ────────────────────────────────

export const CustomModuleColors: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Modules can carry their own brand colors via the optional <code>iconColor</code> and <code>iconBackground</code> fields, applied to each tile's icon box.",
			},
		},
	},
	render: () => {
		const colored: Module[] = modules.map((m, i) => ({
			...m,
			iconBackground: palette[i % palette.length].iconBackground,
			iconColor: palette[i % palette.length].iconColor,
		}));
		const [selected, setSelected] = React.useState<Module>(colored[0]);
		return (
			<GridStage>
				<ModuleGrid modules={colored} activeModuleName={selected.name} onSelect={setSelected} onClose={() => {}} />
			</GridStage>
		);
	},
};

// ── Paged ───────────────────────────────────────────────

export const Paged: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Long module lists are split into pages (18 items per page by default). Compose <code>ModuleGrid</code> with <code>ModuleGridPagination</code> to switch pages — exactly how the module switcher wires them together. Paging composes with a parent-managed search, so the grid's built-in search box is disabled (<code>showSearch={false}</code>).",
			},
		},
	},
	render: () => {
		const pageSize = 18;
		const [page, setPage] = React.useState(0);
		const [selected, setSelected] = React.useState(pagedModules[0]);
		const currentModules = pagedModules.slice(page * pageSize, (page + 1) * pageSize);
		return (
			<GridStage>
				<ModuleGrid
					modules={currentModules}
					activeModuleName={selected.name}
					showSearch={false}
					onSelect={setSelected}
					onClose={() => {}}
				/>
				<ModuleGridPagination totalPages={Math.ceil(pagedModules.length / pageSize)} currentPage={page} onPageChange={setPage} />
			</GridStage>
		);
	},
};

// ── Empty State ─────────────────────────────────────────

export const EmptyState: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'When the list is empty or no modules match the search query, the grid shows <code>emptyMessage</code> centered across all columns.',
			},
		},
	},
	render: () => (
		<GridStage>
			<ModuleGrid modules={[]} activeModuleName="" emptyMessage="No apps found" onSelect={() => {}} onClose={() => {}} />
		</GridStage>
	),
};

// ── Burmese Locale (မြန်မာ) ──────────────────────────────

export const BurmeseLocale: Story = {
	name: 'Burmese Locale (မြန်မာ)',
	parameters: {
		docs: {
			description: {
				story:
					'The module grid with the short Burmese (မြန်မာ) module names used by the ERP dashboard, verifying the tall Myanmar script fits on a single line per tile.',
			},
		},
	},
	render: () => {
		const [selected, setSelected] = React.useState(burmeseModules[0]);
		return (
			<GridStage>
				<ModuleGrid modules={burmeseModules} activeModuleName={selected.name} onSelect={setSelected} onClose={() => {}} />
			</GridStage>
		);
	},
};
