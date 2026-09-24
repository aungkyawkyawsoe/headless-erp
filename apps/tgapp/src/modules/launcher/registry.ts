/**
 * App registry — the phone-style launcher's single source of truth.
 *
 * One entry = one icon on the launcher grid AND one route (`/app/<path>`).
 * New "app" screens: add an entry here, then (later) give it a real page — the
 * router renders a styled placeholder at `/app/:appId` until a dedicated page
 * component exists.
 *
 * NOTE: Burmese labels were transcribed from the design reference; tweak them
 * here as the wording gets finalized.
 *
 * App visibility is NOT declared here. Design-B role→app access lives in the
 * DB: `_roles.app_access` (a JSON list of these `id`s per role) is surfaced on
 * `/auth/me` and the launcher renders only tiles whose id is in that list (all
 * tiles for an admin / an uncurated role). See `launcher-page.tsx allowedApps`.
 */
import type { LucideIcon } from 'lucide-react';
import {
	ArrowRightLeft,
	BarChart3,
	Bell,
	CalendarCheck2,
	Car,
	ClipboardCheck,
	CirclePile,
	Droplets,
	FileBox,
	FileText,
	Fingerprint,
	FolderClock,
	FolderKanban,
	FolderOpen,
	Gauge,
	MoveRight,
	PackagePlus,
	Settings,
	SlidersHorizontal,
	ShieldCheck,
	Users,
	Wrench,
} from 'lucide-react';

export interface AppDefinition {
	/** Stable identifier — also the `_roles.app_access` allow-list value. */
	id: string;
	/** Label shown under the icon. */
	label: string;
	/** Lucide glyph rendered in white on the gradient tile. */
	icon: LucideIcon;
	/** Tailwind gradient stops for the tile, e.g. "from-teal-500 to-teal-700". */
	gradient: string;
	/** Route segment under /app. */
	path: string;
}

export const APPS: AppDefinition[] = [
	// Every gradient is a distinct hue pair — keep them unique so no two tiles
	// on the launcher look alike (no exact-duplicate gradients).
	// Hue follows each tile's meaning: green=approve/stock, blue=official docs,
	// warm=paper/tools/fuel, dark material=rubber/scrap, red=danger.
	// NOTE: the Items page HAS routes (`/app/items`, `/app/items/+`,
	// `/app/items/:id/edit`) but NO tile here — it is hidden from the launcher grid on
	// purpose. It stays reachable via the mro-categories group deep link
	// (`/app/items?item_name=<master id>`) and direct routes.
	// ── Page 1 ────────────────────────────────────────────────────────────────
	{ id: 'attendance', label: 'ရုံးတက်', icon: Fingerprint, gradient: 'from-teal-500 to-teal-700', path: 'attendance' },
	{ id: 'approval', label: 'Approval', icon: ClipboardCheck, gradient: 'from-emerald-500 to-emerald-700', path: 'approval' },
	// အသိပေးချက် — the personal notification inbox (the durable rows behind every
	// request decision, plus the best-effort Telegram DM). Sits with the approval
	// tiles: both are about "what needs/needed my attention".
	{ id: 'notifications', label: 'Notifications', icon: Bell, gradient: 'from-amber-400 to-rose-600', path: 'notifications' },
	{ id: 'hr', label: 'Employees', icon: Users, gradient: 'from-violet-500 to-indigo-800', path: 'employees' },
	{ id: 'vehicles', label: 'Vehicles', icon: Car, gradient: 'from-orange-400 to-orange-700', path: 'fleets' },
	// Fleet-care apps — vehicle-first, full-screen pages (no bottom sheet): the
	// Daily ODO reader/recorder + the engine/gear-oil fluid service app.
	{ id: 'daily-odo', label: 'Daily ODO', icon: Gauge, gradient: 'from-sky-500 to-sky-700', path: 'daily-odo' },
	{ id: 'fluid', label: 'Fluid', icon: Droplets, gradient: 'from-rose-500 to-rose-700', path: 'fluid' },
	{ id: 'licenses', label: 'Licenses', icon: CalendarCheck2, gradient: 'from-blue-500 to-blue-800', path: 'licenses' },
	{ id: 'insurance', label: 'Insurance', icon: ShieldCheck, gradient: 'from-cyan-600 to-cyan-800', path: 'insurances' },
	{ id: 'tyres', label: 'Tyres', icon: CirclePile, gradient: 'from-stone-600 to-stone-900', path: 'tyres' },
	{ id: 'store-requests', label: 'Requisition', icon: FileText, gradient: 'from-amber-500 to-amber-700', path: 'store-requests' },
	{ id: 'maintenance', label: 'Maintenance', icon: Wrench, gradient: 'from-yellow-500 to-yellow-800', path: 'maintenances' },
	{ id: 'emergency', label: 'Incidents', icon: FolderClock, gradient: 'from-red-500 to-red-700', path: 'incidents' },
	// ── Page 2 ────────────────────────────────────────────────────────────────
	// ပစ္စည်းများ (items) intentionally has NO tile here — see the NOTE above.
	// The page stays at /app/items via the group deep link.
	{ id: 'item-categories', label: 'Master', icon: FolderOpen, gradient: 'from-purple-500 to-purple-700', path: 'mro-categories' },
	{ id: 'reports', label: 'Stock', icon: BarChart3, gradient: 'from-green-500 to-green-800', path: 'stocks' },
	{ id: 'outbounds', label: 'Outbounds', icon: FileBox, gradient: 'from-indigo-500 to-indigo-800', path: 'outbounds' },
	{ id: 'inbounds', label: 'Inbounds', icon: PackagePlus, gradient: 'from-green-400 to-teal-700', path: 'inbounds' },
	{ id: 'stock-moves', label: 'Transfers', icon: ArrowRightLeft, gradient: 'from-cyan-500 to-blue-700', path: 'stock-moves' },
	{ id: 'adjustments', label: 'Adjustment', icon: SlidersHorizontal, gradient: 'from-fuchsia-500 to-purple-700', path: 'adjustments' },
	// ပစ္စည်းလှုပ်ရှားမှု — the parts-movement ledger: item groups → moving models
	// → one model's confirmed-line ledger (IN/OUT/TRF). Read-only; sits with the
	// other MRO stock tiles on page 2.
	{ id: 'movements', label: 'Movements', icon: MoveRight, gradient: 'from-amber-500 to-orange-700', path: 'movements' },
	// Projects — the HR project/task board: projects (`hrm_projects`) → a
	// project's tasks (`hrm_tasks`) → one task's detail + comments
	// (`hrm_comments`). Read/write; sits with the HR tiles on page 1.
	{ id: 'projects', label: 'Projects', icon: FolderKanban, gradient: 'from-blue-500 to-indigo-700', path: 'projects' },
	// Account/identity tiles — present for every user.
	{ id: 'settings', label: 'Settings', icon: Settings, gradient: 'from-zinc-500 to-zinc-800', path: 'settings' },
];

/** The most likely destinations — the primary dashboard (attendance) plus the
 *  two apps every session opens. The launcher has NO dock any more, so nothing
 *  renders this list: it is what the launcher WARMS on mount (see
 *  launcher-page.tsx), so the first tap on one of them finds its chunk already
 *  in flight. Order is irrelevant now that it is not a visual strip. */
export const PINNED_APP_IDS = ['attendance', 'approval', 'settings'] as const;

export function getAppById(id: string): AppDefinition | undefined {
	return APPS.find((app) => app.id === id);
}

export function getAppByPath(path: string): AppDefinition | undefined {
	return APPS.find((app) => app.path === path);
}
