/**
 * Icon Resolver — resolves any icon name stored by the Studio into a real
 * Lucide component for the runtime dock/sidebar and the Studio preview.
 *
 * 100% STATIC and TREE-SHAKEN on purpose. The map below is a CURATED set of
 * explicit imports — every icon this repo actually references by name (app
 * tiles, menu items, form-group labels, widget palette icons, block palette
 * icons) plus the legacy/renamed names still present in stored data. No
 * `import * as LucideIcons` enumeration: that shipped the WHOLE lucide set
 * into the runtime bundle and defeated tree-shaking.
 *
 * Stored names may carry the "lucide:" prefix — it is stripped before lookup.
 * Unknown names fall back to `fallback` (default Box) — the Studio picker only
 * ever stores the curated names below, so nothing real degrades.
 */
import {
	AlertTriangle,
	ArrowDown01,
	ArrowDown10,
	ArrowUp01,
	ArrowUp10,
	BadgeCheck,
	BarChart3,
	Bell,
	Book,
	BookOpen,
	Box,
	Briefcase,
	Building,
	Building2,
	Calendar,
	CalendarDays,
	CalendarX2,
	ChartLine,
	CheckSquare,
	ChevronsDownUp,
	ClipboardList,
	Clock,
	Columns2,
	Columns3,
	CreditCard,
	Database,
	DollarSign,
	FileBarChart,
	FileText,
	Fingerprint,
	Folder,
	FolderOpen,
	Gauge,
	Globe,
	Grid2x2,
	Grid2x2Check,
	Grid2x2Plus,
	Grid2x2X,
	Grid3x2,
	Grid3x3,
	Heading1,
	Heading2,
	Heart,
	Home,
	IdCard,
	Image,
	Key,
	Layers,
	LayoutDashboard,
	LayoutTemplate,
	Link,
	Link2,
	List,
	Mail,
	MapPin,
	MessagesSquare,
	Minus,
	MousePointerClick,
	MoveVertical,
	Package,
	Phone,
	PieChart,
	Rows3,
	Settings,
	Shield,
	ShoppingCart,
	SquareStack,
	Star,
	Table2,
	Tag,
	Trash2,
	Truck,
	Type,
	User,
	Users,
	Wallet,
	type LucideIcon,
} from 'lucide-react';

/**
 * Canonical kebab name → Lucide component. Covers every icon referenced by
 * name anywhere in the repo (apps/studio icon palettes + block registry,
 * form-group icons, widget palette icons) plus legacy renamed names still
 * present in stored app data (pie-chart/bar-chart-3/check-square/…).
 */
const ICON_MAP: Record<string, LucideIcon> = {
	// ── App tiles (apps/studio/src/lib/icons.ts APP_ICONS) ──
	box: Box,
	'layout-dashboard': LayoutDashboard,
	settings: Settings,
	users: Users,
	'building-2': Building2,
	calendar: Calendar,
	'messages-square': MessagesSquare,
	'file-text': FileText,
	'pie-chart': PieChart,
	'book-open': BookOpen,
	briefcase: Briefcase,
	'shopping-cart': ShoppingCart,
	package: Package,
	truck: Truck,
	'dollar-sign': DollarSign,
	'bar-chart-3': BarChart3,
	bell: Bell,
	globe: Globe,
	'folder-open': FolderOpen,
	key: Key,

	// ── Form-group icons (packages/ui-views/src/group-icons.tsx GROUP_ICONS) ──
	folder: Folder,
	user: User,
	building: Building,
	home: Home,
	'map-pin': MapPin,
	mail: Mail,
	phone: Phone,
	wallet: Wallet,
	'credit-card': CreditCard,
	clock: Clock,
	star: Star,
	shield: Shield,
	book: Book,
	'clipboard-list': ClipboardList,
	database: Database,
	layers: Layers,
	// 'link' — used by both the app-tile palette (Link2) and form-group icons
	// (Link): one canonical entry, the glyphs are visually identical.
	link: Link,
	heart: Heart,
	'badge-check': BadgeCheck,

	// ── Widget palette icons ──
	'calendar-days': CalendarDays,
	'id-card': IdCard,

	// ── Block palette icons (apps/studio/src/lib/studioMeta.tsx) ──
	'rows-3': Rows3,
	'columns-3': Columns3,
	'columns-2': Columns2,
	'square-stack': SquareStack,
	'chevrons-down-up': ChevronsDownUp,
	'layout-template': LayoutTemplate,
	'move-vertical': MoveVertical,
	minus: Minus,
	type: Type,
	'heading-1': Heading1,
	'heading-2': Heading2,
	'mouse-pointer-click': MousePointerClick,
	tag: Tag,
	'alert-triangle': AlertTriangle,
	image: Image,
	list: List,
	gauge: Gauge,
	'table-2': Table2,
	'link-2': Link2,
	'chart-line': ChartLine,
	'file-bar-chart': FileBarChart,

	// ── Legacy / renamed names still present in stored data ──
	'arrow-down-0-1': ArrowDown01,
	'arrow-down-1-0': ArrowDown10,
	'arrow-up-0-1': ArrowUp01,
	'arrow-up-1-0': ArrowUp10,
	'calendar-x-2': CalendarX2,
	'grid-2x2': Grid2x2,
	'grid-2x2-check': Grid2x2Check,
	'grid-2x2-plus': Grid2x2Plus,
	'grid-2x2-x': Grid2x2X,
	'grid-3x2': Grid3x2,
	'grid-3x3': Grid3x3,
	'check-square': CheckSquare,
	fingerprint: Fingerprint,
	trash: Trash2,
};

/** Normalize a stored icon name: strip "lucide:", trim, lowercase. */
function normalize(name: string | null | undefined): string {
	return (name ?? '')
		.replace(/^lucide:/, '')
		.trim()
		.toLowerCase();
}

/**
 * Resolve a stored icon name to a Lucide component. Deterministic and
 * synchronous — same name → same component, every time. Curated set only;
 * unknown names fall back to `fallback` (default Box).
 */
export function smartIconFor(name: string | null | undefined, fallback: LucideIcon = Box): LucideIcon {
	const clean = normalize(name);
	if (!clean) return fallback;
	return ICON_MAP[clean] ?? fallback;
}
