import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AuthGate } from './auth-gate';
import { RouteErrorBoundary } from './route-error';
import { RouteFallback } from './route-fallback';
import { TelegramBackButtonController } from '@/shared/platform/back-button-controller';

// Route-level code splitting — the initial shell loads fast; each page ships in
// its own lazy chunk.
const LauncherPage = lazy(() => import('@/modules/launcher/launcher-page'));
// Start the home screen's download NOW — at module evaluation, in parallel with
// the auth boot. `<Suspense>` cannot request a lazy route until AuthGate renders
// it, and AuthGate renders only AFTER `/auth/me` resolves, so without this the
// chunk fetch queues behind the auth round trip: a whole extra round trip before
// the first tile, on every launch. (Measured on a 1.6 Mbps link: `/auth/me` at
// 1.30 s → launcher chunk at 1.47 s → tiles at 1.78 s.) The specifier is the
// same as the `lazy()` one, so it is one chunk, fetched once; `lazy` then
// resolves from the already-settled import.
if (typeof window !== 'undefined') void import('@/modules/launcher/launcher-page').catch(() => {});
const AppPlaceholderPage = lazy(() => import('@/modules/launcher/app-placeholder-page'));
// ရုံးတက် (attendance) — the dashboard + its quick-action destinations. The
// static `/app/attendance/*` segments outrank the dynamic `/app/:appId` route,
// so the launcher tile lands on the real page while every other app keeps the
// styled placeholder until it gets its own screen.
const AttendancePage = lazy(() => import('@/modules/attendance/pages/attendance-page'));
// Team Tracking → ONE report's identity + last 7 days (`/app/attendance/team/:id`).
const TeamAttendancePage = lazy(() => import('@/modules/attendance/pages/team-attendance-page'));
const RequestListPage = lazy(() => import('@/modules/attendance/pages/request-list-page'));
const RequestCreatePage = lazy(() => import('@/modules/attendance/pages/request-create-page'));
const RequestEditPage = lazy(() => import('@/modules/attendance/pages/request-edit-page'));
// အတည်ပြုချက် — the approval center (launcher tile `approval` → /app/approval).
const ApprovalPage = lazy(() => import('@/modules/attendance/pages/approval-page'));
const SettingsPage = lazy(() => import('@/modules/settings/settings-page'));
// ဝန်ထမ်းများ — the employee directory (launcher tile `hr` → /app/employees).
const EmployeesPage = lazy(() => import('@/modules/employees/pages/employees-page'));
const EmployeesBrowsePage = lazy(() => import('@/modules/employees/pages/employees-browse-page'));
// ယာဉ် — the fleet master list (launcher tile `vehicles` → /app/fleets).
const FleetsKioskPage = lazy(() => import('@/modules/fleets/pages/fleets-page'));
const FleetsBrowsePage = lazy(() => import('@/modules/fleets/pages/fleets-browse-page'));
// Daily ODO — the odometer app (launcher tile `daily-odo` → /app/daily-odo):
// the search-first kiosk (record today's reading for a searched truck), each
// vehicle's full-screen record page, and the register at /app/daily-odo/browse.
const OdoListPage = lazy(() => import('@/modules/odo/pages/odo-list-page'));
const OdoBrowsePage = lazy(() => import('@/modules/odo/pages/odo-browse-page'));
const OdoVehiclePage = lazy(() => import('@/modules/odo/pages/odo-vehicle-page'));
// Daily ODO → the newest reading's CORRECTION screen (reached from the Odometer
// card's pencil; a reading has no row id, so the screen targets the current one).
const OdoReadingEditPage = lazy(() => import('@/modules/odo/pages/odo-reading-edit-page'));
// Daily ODO → New reading — the RECORD page (a real page, native MainButton),
// bound to a truck (`/app/daily-odo/:id/reading/new`), reached from the vehicle
// page's +. No bottom bar there: the form owns the whole screen.
const OdoReadingCreatePage = lazy(() => import('@/modules/odo/pages/odo-reading-create-page'));
// Fluid — the vehicle-first engine/gear-oil service app (launcher tile `fluid`
// → /app/fluid): vehicle list + each vehicle's full-screen fill page.
const FluidsListPage = lazy(() => import('@/modules/fluids/pages/fluids-list-page'));
const FluidVehiclePage = lazy(() => import('@/modules/fluids/pages/fluid-vehicle-page'));
// Fluid → ONE fill's CORRECTION screen — the newest fill's edit form (reached
// from the Edit action on the vehicle's newest history card).
const FluidEditPage = lazy(() => import('@/modules/fluids/pages/fluid-edit-page'));
// Fluid → New fill — the RECORD page (a real page, native MainButton), bound to
// a truck (`?vehicle=`) + kind (`?type=`), reached from the vehicle page's +.
const FluidCreatePage = lazy(() => import('@/modules/fluids/pages/fluid-create-page'));
// Fluid → Browse all — the full serviceable register (reached from the Fluid
// kiosk search's idle "Browse all vehicles" link; a real route so back returns
// to the register in place, like the tyre module's /fitment board).
const FluidBrowsePage = lazy(() => import('@/modules/fluids/pages/fluid-browse-page'));
// အာမခံ — the insurance policy list (launcher tile `insurance` → /app/insurances).
const InsurancesPage = lazy(() => import('@/modules/insurances/pages/insurances-page'));
// အာမခံ → Browse all — the grouped policy register (reached from the insurance
// kiosk search's idle "Browse all policies" link; a real route so back returns
// to the register in place, like the tyre module's /fitment board).
const InsuranceBrowsePage = lazy(() => import('@/modules/insurances/pages/insurance-browse-page'));
// အာမခံ — the policy list's bottom-bar + destination (placeholder page until
// the insurance create form ships).
const InsuranceCreatePage = lazy(() => import('@/modules/insurances/pages/insurance-create-page'));
// အာမခံ → ONE truck — the per-truck full-screen page (tap a truck card): the
// form-first renewal screen + the truck's policy history list (Fluid-style).
const InsuranceTruckPage = lazy(() => import('@/modules/insurances/pages/insurance-truck-page'));
// အာမခံ → ONE policy's CORRECTION screen — the newest record's edit form
// (reached from the Edit action on the truck's newest history card).
const InsuranceEditPage = lazy(() => import('@/modules/insurances/pages/insurance-edit-page'));
// အာမခံ → the truck's RENEWAL screen — a dedicated page (no bottom bar, native
// MainButton Save), opened by the per-truck page's + button.
const InsuranceRenewPage = lazy(() => import('@/modules/insurances/pages/insurance-renew-page'));
// လိုင်စင် — the license renewal list (launcher tile `licenses` → /app/licenses).
const LicensesPage = lazy(() => import('@/modules/licenses/pages/licenses-page'));
// လိုင်စင် → Browse all — the grouped license register (reached from the license
// kiosk search's idle "Browse all licenses" link; a real route so back returns
// to the register in place, like the tyre module's /fitment board).
const LicenseBrowsePage = lazy(() => import('@/modules/licenses/pages/license-browse-page'));
// လိုင်စင် — the license list's bottom-bar + destination (placeholder page until
// the license create form ships).
const LicenseCreatePage = lazy(() => import('@/modules/licenses/pages/license-create-page'));
// လိုင်စင် → ONE truck — the per-truck full-screen page (tap a truck card): the
// form-first renewal screen + the truck's license history list (Fluid-style).
const LicenseTruckPage = lazy(() => import('@/modules/licenses/pages/license-truck-page'));
// လိုင်စင် → ONE permit's CORRECTION screen — the newest record's edit form
// (reached from the Edit action on the truck's newest history card).
const LicenseEditPage = lazy(() => import('@/modules/licenses/pages/license-edit-page'));
// လိုင်စင် → the truck's RENEWAL screen — a dedicated page (no bottom bar, native
// MainButton Save), opened by the per-truck page's + button.
const LicenseRenewPage = lazy(() => import('@/modules/licenses/pages/license-renew-page'));
// တာယာ → By Serial — the search-first serial-unit lookup (the module's DEFAULT
// scope tab; /app/tyres, the module root, redirects here).
const TyresPage = lazy(() => import('@/modules/tyres/pages/tyres-page'));
// တာယာ → By Fleet — the plate-search-first fleet lookup (second scope tab).
const TyreFleetPage = lazy(() => import('@/modules/tyres/pages/tyre-fleet-page'));
// တာယာ → ONE truck — the FULL-SCREEN wheel-position plan for a matched plate
// (the old fitment bottom sheet, promoted to a page with a back arrow).
const TyreVehiclePage = lazy(() => import('@/modules/tyres/pages/tyre-vehicle-page'));
// ဝန်ထမ်း → ONE employee's full PROFILE — the directory card's tap target, a real
// route so the person has a shareable address (tabs: overview / assets / tasks /
// projects). Replaced the old in-page details bottom sheet.
const EmployeeDetailPage = lazy(() => import('@/modules/employees/pages/employee-detail-page'));
// ဝန်ထမ်း → ONE employee's ASSETS — the person-side register (the same shared
// `AssetRegister` a truck's inventory uses), opened from the employee directory.
const EmployeeAssetsPage = lazy(() => import('@/modules/tyres/pages/employee-assets-page'));
// တာယာ → ONE serial — the FULL-SCREEN lifecycle history for a matched tyre unit
// (the old per-tyre detail bottom sheet, promoted to a page with a back arrow;
// reached from a By Serial match/card and from a By Fleet wheel-plan tyre tap).
const TyreSerialPage = lazy(() => import('@/modules/tyres/pages/tyre-serial-page'));
// တာယာ → ONE action on ONE tyre — the FULL-SCREEN body behind a manage-menu row
// (`/app/tyres/vehicle/:id/action/:kind/:tyreId`): the menu only navigates, so a
// write form owns the whole screen and the app bar's real back.
const TyreActionPage = lazy(() => import('@/modules/tyres/pages/tyre-action-page'));
// တာယာ → On vehicles — the all-fleet fitment BOARD (browse-all, reached from
// By Fleet's idle link; kept for old deep links).
const TyreFitmentPage = lazy(() => import('@/modules/tyres/pages/tyre-fitment-page'));
// တောင်းခံလွှာ — the MRO store requisition list (launcher tile `store-requests`
// → /app/store-requests).
const StoreRequestsPage = lazy(() => import('@/modules/store-requests/pages/store-requests-page'));
// တောင်းခံလွှာ — the bottom bar's + destination: the create page (placeholder
// until the requisition form ships).
const StoreRequestCreatePage = lazy(() => import('@/modules/store-requests/pages/store-request-create-page'));
// တောင်းခံလွှာကြည့်ရှုမည် — tap one store-request card to open its detail page: the
// store keeper reviews the items and approves / issues (partial goods issue) / closes.
const StoreRequestDetailPage = lazy(() => import('@/modules/store-requests/pages/store-request-detail-page'));
// အသိပေးချက် — the in-app notification inbox (launcher tile `notifications`
// → /app/notifications): the session's own notification rows, newest first.
const NotificationsPage = lazy(() => import('@/modules/notifications/pages/notifications-page'));
// ပြင်ဆင် — the vehicle-maintenance app (launcher tile `maintenance` →
// /app/maintenances). Reads + writes the REAL `veh_maintenance_logs` collection
// (bound to `veh_fleets`, citing a `veh_issue_types` job). The landing is the
// truck-first search kiosk; its register lives at /browse, each matched truck
// opens its file at /vehicle/:id, and a log's create/edit forms live at /+ and
// /log/:id.
const MaintenancesPage = lazy(() => import('@/modules/maintenances/pages/maintenances-page'));
const MaintenancesBrowsePage = lazy(() => import('@/modules/maintenances/pages/maintenances-browse-page'));
const MaintenanceVehiclePage = lazy(() => import('@/modules/maintenances/pages/maintenance-vehicle-page'));
const MaintenanceCreatePage = lazy(() => import('@/modules/maintenances/pages/maintenance-create-page'));
const MaintenanceEditPage = lazy(() => import('@/modules/maintenances/pages/maintenance-edit-page'));
// မှတ်တမ်း — the vehicle accident/incident app (launcher tile `emergency` →
// /app/incidents): the search-first kiosk (find a truck's record file, or log
// one), its register at /browse, and the create page for records.
const IncidentPage = lazy(() => import('@/modules/incidents/pages/incident-page'));
const IncidentBrowsePage = lazy(() => import('@/modules/incidents/pages/incidents-browse-page'));
// យှတ်တမ်း → ONE record — tap a register card for that record's edit form
// (prefilled), so a wrong type/severity/location is corrected in place.
const IncidentEditPage = lazy(() => import('@/modules/incidents/pages/incident-edit-page'));
// မှတ်တမ်း — the bottom bar's + destination: the create page (records may be
// vehicle-less, so the register keeps a standalone log entry).
const IncidentCreatePage = lazy(() => import('@/modules/incidents/pages/incident-create-page'));
// မှတ်တမ်း → ONE truck — tap a truck card for its full-screen page: the truck's
// record list with the log form behind the bar's List/+ toggle.
const IncidentTruckPage = lazy(() => import('@/modules/incidents/pages/incident-truck-page'));
// မှတ်တမ်း → the truck's LOG screen — a dedicated page (no bottom bar, native
// MainButton Save), opened by the per-truck page's + button.
const IncidentLogPage = lazy(() => import('@/modules/incidents/pages/incident-log-page'));
// ပစ္စည်းများ — the item catalog list (launcher tile `items` → /app/items).
const ItemsPage = lazy(() => import('@/modules/items/pages/items-page'));
// ပစ္စည်းများ — the bottom bar's + destination: the create form.
const ItemCreatePage = lazy(() => import('@/modules/items/pages/item-create-page'));
// ပစ္စည်း ပြင်ဆင်မည် — one item-model's edit page (tap an item card).
const ItemEditPage = lazy(() => import('@/modules/items/pages/item-edit-page'));
// ပစ္စည်းအုပ်စု — the MRO masters hub (launcher tile `item-categories` →
// /app/mro-categories): အုပ်စု (mro_item_name) / ရောင်းချသူ (mro_suppliers)
// tabs on ONE route (`?tab=`).
const MroCategoriesPage = lazy(() => import('@/modules/mro-categories/pages/mro-categories-page'));
// ပစ္စည်းအုပ်စု — the hub's အုပ်စု tab + destination: the real item-name
// (mro_item_name) master create form.
const MroCategoryCreatePage = lazy(() => import('@/modules/mro-categories/pages/mro-category-create-page'));
// ပစ္စည်းအုပ်စု ပြင်ဆင်မည် — one item-name master's rename page (tap a group card's pencil).
const MroCategoryEditPage = lazy(() => import('@/modules/mro-categories/pages/mro-category-edit-page'));
// ရောင်းချသူ — the hub's ရောင်းချသူ tab + destination: a supplier (mro_suppliers) master create form.
const MroSupplierCreatePage = lazy(() => import('@/modules/mro-categories/pages/mro-supplier-create-page'));
// ရောင်းချသူ ပြင်ဆင်မည် — one supplier's rename page (tap a supplier row on the hub's ရောင်းချသူ tab).
const MroSupplierEditPage = lazy(() => import('@/modules/mro-categories/pages/mro-supplier-edit-page'));
// စတော့ — the stock dashboard app (launcher tile `reports` → /app/stocks): the
// search-first item kiosk + its full alert dashboard at /app/stocks/browse.
const StockPage = lazy(() => import('@/modules/stock/pages/stock-page'));
const StockBrowsePage = lazy(() => import('@/modules/stock/pages/stock-browse-page'));
const StockItemPage = lazy(() => import('@/modules/stock/pages/stock-item-page'));
// ထုတ်ပေးမှု — the ONE outbound hub (launcher tile `outbounds` → /app/outbounds):
// the ထုတ်ပေး / ပယ်ဖျက် / စွန့်ပစ် kinds are `?type=` tabs on the SAME mro_outbounds flow.
const OutboundHubPage = lazy(() => import('@/modules/goods-issues/pages/outbound-hub-page'));
// ထုတ်ပေးမှုအသစ် — the hub's single + destination (kind comes from `?type=`).
const OutboundHubCreatePage = lazy(() => import('@/modules/goods-issues/pages/outbound-hub-create-page'));
// ထုတ်ပေးမှု → ONE document — tap an outbound card for its FULL-SCREEN doc page
// (the former items bottom sheet is this real page with a back arrow).
const OutboundDetailPage = lazy(() => import('@/modules/goods-issues/pages/outbound-detail-page'));
// အဝင်စာရင်း — the MRO inbound (GRN) HUB (launcher tile `inbounds` → /app/inbounds).
const InboundsPage = lazy(() => import('@/modules/inbounds/pages/inbound-hub-page'));
// အဝင်စာရင်းအသစ် — the bottom bar's + destination: the multi-line inbound create form.
const InboundCreatePage = lazy(() => import('@/modules/inbounds/pages/inbound-create-page'));
// အဝင်စာရင်း → ONE document — tap an inbound card for its FULL-SCREEN doc page
// (the former items bottom sheet is this real page with a back arrow).
const InboundDetailPage = lazy(() => import('@/modules/inbounds/pages/inbound-detail-page'));
// စတော့ — the MRO location-transfer list (launcher tile `stock-moves` → /app/stock-moves).
const StockMovesPage = lazy(() => import('@/modules/stock-moves/pages/stock-moves-page'));
// ပြောင်းရွှေ့မှုအသစ် — the bottom bar's + destination: the transfer create form.
const StockMoveCreatePage = lazy(() => import('@/modules/stock-moves/pages/stock-move-create-page'));
// ပြောင်းရွှေ့မှု → ONE document — tap a transfer card (or a TRF ledger line) for its
// FULL-SCREEN doc page (the former items bottom sheet is this real page now).
const StockMoveDetailPage = lazy(() => import('@/modules/stock-moves/pages/stock-move-detail-page'));
// Adjustment — the MRO stock-correction list (launcher tile `adjustments` → /app/adjustments).
const AdjustmentsPage = lazy(() => import('@/modules/adjustments/pages/adjustments-page'));
// Adjustment အသစ် — the bottom bar's + destination: the adjustment create form.
const AdjustmentCreatePage = lazy(() => import('@/modules/adjustments/pages/adjustment-create-page'));
// Adjustment → ONE document — tap an adjustment card (or an ADJ ledger line) for its
// FULL-SCREEN doc page (the former items bottom sheet is this real page now).
const AdjustmentDetailPage = lazy(() => import('@/modules/adjustments/pages/adjustment-detail-page'));
// ပစ္စည်းလှုပ်ရှားမှု — the MRO parts-movement ledger (launcher tile `movements`
// → /app/movements): the search-first item kiosk (find an item → its movement
// feed), the browse-all item-groups register at /browse, the group's moving
// models (Screen 2) → ONE model's confirmed-line ledger (Screen 3).
const MovementGroupsPage = lazy(() => import('@/modules/movements/pages/movement-groups-page'));
// ပစ္စည်းလှုပ်ရှားမှု → Browse all — the item-groups register (the kiosk's idle
// "Browse all item groups" link; a real route so back returns to it in place).
const MovementGroupsBrowsePage = lazy(() => import('@/modules/movements/pages/movement-groups-browse-page'));
const MovementModelsPage = lazy(() => import('@/modules/movements/pages/movement-models-page'));
const MovementLedgerPage = lazy(() => import('@/modules/movements/pages/movement-ledger-page'));
// Projects — the HR project/task board (launcher tile `projects` → /app/projects):
// the project register, one project's task feed, and a task's detail + comments.
const ProjectsPage = lazy(() => import('@/modules/projects/pages/projects-page'));
const ProjectCreatePage = lazy(() => import('@/modules/projects/pages/project-create-page'));
const ProjectEditPage = lazy(() => import('@/modules/projects/pages/project-edit-page'));
const ProjectDetailPage = lazy(() => import('@/modules/projects/pages/project-detail-page'));
const WorkloadPage = lazy(() => import('@/modules/projects/pages/workload-page'));
const TaskCreatePage = lazy(() => import('@/modules/projects/pages/task-create-page'));
const TaskEditPage = lazy(() => import('@/modules/projects/pages/task-edit-page'));
const TaskDetailPage = lazy(() => import('@/modules/projects/pages/task-detail-page'));

/**
 * Route table — the single source of navigation. Route components live in
 * `app/routes/*` and stay thin: they wire feature pages to URL params, never
 * business logic.
 *
 * `/app` is the phone-style app launcher (pages of icons); every app
 * tile routes to `/app/:appId`, which renders a styled placeholder until a
 * dedicated page exists.
 *
 * AuthGate wraps everything: no valid session → Telegram users land on
 * pending/retry, plain browsers on a password login screen; the app routes
 * only render when authenticated.
 */
export function Router() {
	return (
		<Suspense fallback={<RouteFallback />}>
			<AuthGate>
				{/* The ONE owner of Telegram's native BackButton — see the class doc.
				 * Rendered inside the Router (needs context), outside the pages so
				 * module→module navigation never toggles the button. */}
				<TelegramBackButtonController />
				{/* A route's render throw shows a compact panel and keeps the router
				 * alive — never the whole-app boot boundary (see `route-error.tsx`). */}
				<RouteErrorBoundary>
					<Routes>
						<Route path="/" element={<Navigate to="/app" replace />} />
						<Route path="/app" element={<LauncherPage />} />
						{/* ရုံးတက် — dashboard (launcher tile `attendance` → /app/attendance) */}
						<Route path="/app/attendance" element={<AttendancePage />} />
						{/* Team Tracking → ONE report's identity + last 7 days of attendance. */}
						<Route path="/app/attendance/team/:id" element={<TeamAttendancePage />} />
						{/* Quick actions → list-first request pages; the scroll-away FAB opens
						the `/+` create page (ခွင့် / စောပြန်ခွင့် / အချိန်ပို).
						တောင်းခံချက် stays a read-only inbox. */}
						<Route path="/app/attendance/leave" element={<RequestListPage requestType="leave" />} />
						<Route path="/app/attendance/leave/+" element={<RequestCreatePage requestType="leave" />} />
						{/* Pending-row edit — the card's tap target (`[type]/:id/edit`). */}
						<Route path="/app/attendance/leave/:id/edit" element={<RequestEditPage requestType="leave" />} />
						<Route path="/app/attendance/overtime" element={<RequestListPage requestType="ot" />} />
						<Route path="/app/attendance/overtime/+" element={<RequestCreatePage requestType="ot" />} />
						<Route path="/app/attendance/overtime/:id/edit" element={<RequestEditPage requestType="ot" />} />
						<Route path="/app/attendance/early-leave" element={<RequestListPage requestType="early" />} />
						<Route path="/app/attendance/early-leave/+" element={<RequestCreatePage requestType="early" />} />
						<Route path="/app/attendance/early-leave/:id/edit" element={<RequestEditPage requestType="early" />} />
						<Route path="/app/attendance/claims" element={<RequestListPage requestType="all" />} />
						{/* အတည်ပြုချက် — old /app/attendance/approvals deep links land on the approval center. */}
						<Route path="/app/attendance/approvals" element={<Navigate to="/app/approval" replace />} />
						{/* အတည်ပြုချက် — the approval center (launcher tile `approval` → /app/approval). */}
						<Route path="/app/approval" element={<ApprovalPage />} />
						{/* ဆက်တင် — theme changer (launcher tile `settings`). */}
						<Route path="/app/settings" element={<SettingsPage />} />
						{/* ဝန်ထမ်းများ — the search-first employee lookup (launcher tile `hr`):
					    route opens BLANK; the register stays at the static /browse below. */}
						<Route path="/app/employees" element={<EmployeesPage />} />
						{/* Browse all employees — the old full directory behind the kiosk. */}
						<Route path="/app/employees/browse" element={<EmployeesBrowsePage />} />
						{/* ONE employee's full profile — the tabbed detail page. */}
						<Route path="/app/employees/:id" element={<EmployeeDetailPage />} />
						{/* ONE employee's issued assets — the person-side asset register. */}
						<Route path="/app/employees/:id/assets" element={<EmployeeAssetsPage />} />
						{/* Old `/:id/edit` deep links — the edit view is gone; the profile page's
					   Overview tab is the read view. */}
						<Route path="/app/employees/:id/edit" element={<Navigate to="/app/employees" replace />} />
						{/* Route rename — old /app/hr deep links land on the directory. */}
						<Route path="/app/hr" element={<Navigate to="/app/employees" replace />} />
						{/* Route rename — old /app/vehicles deep links land on the fleets list. */}
						<Route path="/app/vehicles" element={<Navigate to="/app/fleets" replace />} />
						{/* ယာဉ် — the search-first vehicle lookup (launcher tile `vehicles`),
					    opens BLANK; the master register stays at /app/fleets/browse.
					    No create (+) routes — vehicles are master data added outside. */}
						<Route path="/app/fleets" element={<FleetsKioskPage />} />
						{/* Browse all vehicles — the old full register behind the kiosk. */}
						<Route path="/app/fleets/browse" element={<FleetsBrowsePage />} />
						{/* Daily ODO — record today's odometer (launcher tile `daily-odo`).
						The landing is the search-first kiosk: ONE centred plate search; a
						single match opens the full-screen record page directly. The old
						vehicle-first register moved to /app/daily-odo/browse (the kiosk's
						"Browse all vehicles" escape hatch). */}
						<Route path="/app/daily-odo" element={<OdoListPage />} />
						{/* Daily ODO → Browse all — the full serviceable register (the kiosk's
						idle "Browse all vehicles" link; a real route so back returns to it). */}
						<Route path="/app/daily-odo/browse" element={<OdoBrowsePage />} />
						<Route path="/app/daily-odo/:id" element={<OdoVehiclePage />} />
						{/* Daily ODO → New reading — the RECORD page (the bottom bar's +
						destination; a full-page form whose save is the native MainButton). */}
						<Route path="/app/daily-odo/:id/reading/new" element={<OdoReadingCreatePage />} />
						{/* Daily ODO → the newest reading's CORRECTION screen — the Odometer
						card's pencil (a reading has no row id, so it targets the current one). */}
						<Route path="/app/daily-odo/:id/reading/edit" element={<OdoReadingEditPage />} />
						{/* Fluid — engine/gear-oil fill records + km intervals (launcher tile
						`fluid`). The landing is the search-first kiosk: ONE centred plate
						search; a single match opens the full-screen fill page directly. The
						old vehicle-first register moved to /app/fluid/browse (the kiosk's
						"Browse all vehicles" escape hatch). */}
						<Route path="/app/fluid" element={<FluidsListPage />} />
						{/* Fluid → Browse all — the full serviceable register (the kiosk's idle
						"Browse all vehicles" link; a real route so back returns to it). */}
						<Route path="/app/fluid/browse" element={<FluidBrowsePage />} />
						{/* Fluid → ONE fill's CORRECTION screen — the newest fill's edit form,
						reached from the Edit action on the vehicle's newest history card. */}
						<Route path="/app/fluid/fill/:id" element={<FluidEditPage />} />
						{/* Fluid → New fill — the RECORD page (a real page whose save is the
						native MainButton), bound to a truck (`?vehicle=`) + kind (`?type=`).
						The static `+` segment outranks the dynamic `:id` below. */}
						<Route path="/app/fluid/+" element={<FluidCreatePage />} />
						<Route path="/app/fluid/:id" element={<FluidVehiclePage />} />
						{/* အာမခံ — the insurance policy list (launcher tile `insurance`). The
						landing is the search-first kiosk: ONE centred plate search; a single
						match opens the truck's full-screen page directly. The grouped register
						moved to /app/insurances/browse (the kiosk's "Browse all policies"
						escape hatch). */}
						<Route path="/app/insurances" element={<InsurancesPage />} />
						{/* အာမခံ → Browse all — the grouped policy register (the kiosk's idle
						"Browse all policies" link; a real route so back returns to it). */}
						<Route path="/app/insurances/browse" element={<InsuranceBrowsePage />} />
						{/* အာမခံ — the bottom bar's + destination: the create page (placeholder
						until the insurance form ships). */}
						<Route path="/app/insurances/+" element={<InsuranceCreatePage />} />
						{/* အာမခံ → ONE policy's CORRECTION screen — the newest record's edit
						form, reached from the Edit action on the truck's history card. */}
						<Route path="/app/insurances/policy/:id" element={<InsuranceEditPage />} />
						{/* အာမခံ → the truck's RENEWAL screen — a dedicated page (no bottom
						toolbar; native MainButton Save), opened by the per-truck + button. */}
						<Route path="/app/insurances/:id/renew" element={<InsuranceRenewPage />} />
						{/* အာမခံ → ONE truck — tap a truck card for its full-screen page: the
						truck's policy overview + history (the bar's List/+ toggle). */}
						<Route path="/app/insurances/:id" element={<InsuranceTruckPage />} />
						{/* Route rename — old /app/insurance deep links land on the policy list. */}
						<Route path="/app/insurance" element={<Navigate to="/app/insurances" replace />} />
						{/* လိုင်စင် — the license renewal list (launcher tile `licenses`). The
						landing is the search-first kiosk: ONE centred plate search; a single
						match opens the truck's full-screen page directly. The grouped register
						moved to /app/licenses/browse (the kiosk's "Browse all licenses"
						escape hatch). */}
						<Route path="/app/licenses" element={<LicensesPage />} />
						{/* လိုင်စင် → Browse all — the grouped license register (the kiosk's idle
						"Browse all licenses" link; a real route so back returns to it). */}
						<Route path="/app/licenses/browse" element={<LicenseBrowsePage />} />
						{/* လိုင်စင် — the bottom bar's + destination: the create page (placeholder
						until the license form ships). */}
						<Route path="/app/licenses/+" element={<LicenseCreatePage />} />
						{/* လိုင်စင် → ONE permit's CORRECTION screen — the newest record's edit
						form, reached from the Edit action on the truck's history card. */}
						<Route path="/app/licenses/permit/:id" element={<LicenseEditPage />} />
						{/* လိုင်စင် → the truck's RENEWAL screen — a dedicated page (no bottom
						toolbar; native MainButton Save), opened by the per-truck + button. */}
						<Route path="/app/licenses/:id/renew" element={<LicenseRenewPage />} />
						{/* လိုင်စင် → ONE truck — tap a truck card for its full-screen page: the
						truck's license overview + history (the bar's List/+ toggle). */}
						<Route path="/app/licenses/:id" element={<LicenseTruckPage />} />
						{/* Route rename — old /app/trips deep links land on the licenses page. */}
						<Route path="/app/trips" element={<Navigate to="/app/licenses" replace />} />
						{/* တာယာ — module landing (launcher tile `tyres` → /app/tyres). The module
						opens search-first: the root redirects to the By Serial lookup, the
						DEFAULT first scope tab, so old links land on the search screen. */}
						<Route path="/app/tyres" element={<Navigate to="/app/tyres/serial" replace />} />
						{/* တာယာ → By Serial — the search-first serial-unit lookup (default scope tab). */}
						<Route path="/app/tyres/serial" element={<TyresPage />} />
						{/* တာယာ → By Fleet — the plate-search-first fleet lookup (second scope tab). */}
						<Route path="/app/tyres/fleet" element={<TyreFleetPage />} />
						{/* တာယာ → ONE truck — a matched/browsed plate's FULL-SCREEN wheel-position
						plan (the fitment bottom sheet is now this real page with a back arrow). */}
						<Route path="/app/tyres/vehicle/:id" element={<TyreVehiclePage />} />
						{/* ONE wheel action (inspect / move / unseat / swap / write-off request /) — the
					    manage menu's row target: a real page with the app bar's back. */}
						<Route path="/app/tyres/vehicle/:id/action/:kind/:tyreId" element={<TyreActionPage />} />
						{/* Route removal — the truck's inventory IS this page now (the app bar's rig /
					    list switch), so an old `/inventory` deep link lands on the truck. */}
						<Route path="/app/tyres/vehicle/:id/inventory" element={<Navigate to=".." relative="path" replace />} />
						{/* တာယာ → ONE serial — a matched serial's FULL-SCREEN lifecycle history
						(the per-tyre detail bottom sheet is now this real page with a back arrow;
						opened from a By Serial match/card and a By Fleet wheel-plan tyre tap). */}
						<Route path="/app/tyres/tyre/:id" element={<TyreSerialPage />} />
						{/* တာယာ → On vehicles — the all-fleet fitment board (browse-all, linked from
						By Fleet's idle screen; also keeps old /app/tyres/fitment deep links alive). */}
						<Route path="/app/tyres/fitment" element={<TyreFitmentPage />} />
						{/* တာယာ — a serial-tracked tyre unit only enters stock via an MRO inbound
						receipt (serial lines), so the tyre module's + lands on the inbound create. */}
						<Route path="/app/tyres/+" element={<Navigate to="/app/inbounds/+" replace />} />
						{/* Route rename — old /app/departments deep links land on the tyre module
						(default tab via the /app/tyres redirect). */}
						<Route path="/app/departments" element={<Navigate to="/app/tyres" replace />} />
						{/* တောင်းခံလွှာ — the MRO store requisition list (launcher tile `store-requests`). */}
						<Route path="/app/store-requests" element={<StoreRequestsPage />} />
						{/* တောင်းခံလွှာ — the bottom bar's + destination: the create page (placeholder
						until the requisition form ships). */}
						<Route path="/app/store-requests/+" element={<StoreRequestCreatePage />} />
						{/* တောင်းခံလွှာကြည့်ရှုမည် — tap a store-request card to review + act on it
						(approve / issue / reject all happen on the pushed detail screen). */}
						<Route path="/app/store-requests/:id" element={<StoreRequestDetailPage />} />
						{/* Route rename — old /app/purchasing deep links land on the store requests list. */}
						<Route path="/app/purchasing" element={<Navigate to="/app/store-requests" replace />} />
						{/* အသိပေးချက် — the in-app notification inbox (launcher tile `notifications`). */}
						<Route path="/app/notifications" element={<NotificationsPage />} />
						{/* ပြင်ဆင် — the vehicle-maintenance app (launcher tile `maintenance`). The
						landing is the search-first kiosk: ONE centred plate search; a single
						match opens that truck's maintenance file directly. The register moved
						to /app/maintenances/browse (the kiosk's "Browse all logs" link). */}
						<Route path="/app/maintenances" element={<MaintenancesPage />} />
						{/* ပြင်ဆင် → ONE truck — a matched truck's maintenance file (its
						`veh_maintenance_logs` history + a new-log action bound to that plate). */}
						<Route path="/app/maintenances/vehicle/:id" element={<MaintenanceVehiclePage />} />
						{/* ပြင်ဆင် → Browse all — every maintenance log grouped by truck (the
						kiosk's idle "Browse all logs" link; a real route so back returns to it). */}
						<Route path="/app/maintenances/browse" element={<MaintenancesBrowsePage />} />
						{/* ပြင်ဆင် → New log — the create form, optionally pre-bound to a truck
						(`?vehicle=<id>` from a truck's +). */}
						<Route path="/app/maintenances/+" element={<MaintenanceCreatePage />} />
						{/* ပြင်ဆင် → Edit — ONE log's prefilled edit form. */}
						<Route path="/app/maintenances/log/:id" element={<MaintenanceEditPage />} />
						{/* Route rename — old /app/maintenance deep links land on the maintenances kiosk. */}
						<Route path="/app/maintenance" element={<Navigate to="/app/maintenances" replace />} />
						{/* မှတ်တမ်း — the vehicle accident/incident app (launcher tile `emergency`).
						The landing is the search-first kiosk: ONE centred plate search; a single
						match opens that truck's record page directly. The grouped register
						moved to /app/incidents/browse (the kiosk's "Browse all records" escape
						hatch). */}
						<Route path="/app/incidents" element={<IncidentPage />} />
						{/* မှတ်တမ်း → Browse all — the grouped truck register (severity filter + log
						a vehicle-less record), a real route so back returns to it. */}
						<Route path="/app/incidents/browse" element={<IncidentBrowsePage />} />
						{/* မှတ်တမ်း → ONE record — a register card's edit form, prefilled from the
						stored row. A static segment ahead of /:id so it never resolves as a
						truck id. */}
						<Route path="/app/incidents/record/:id" element={<IncidentEditPage />} />
						{/* မှတ်တမ်း — the bottom bar's + destination: the create page (records may be
						vehicle-less, so the register keeps a standalone log entry). */}
						<Route path="/app/incidents/+" element={<IncidentCreatePage />} />
						{/* မှတ်တမ်း → ONE truck — a matched truck's full-screen page: the truck's
						accident/incident record list (the default) with the log form behind the
						bar's List/+ toggle. A NAMED segment (`vehicle/:id`) so it mirrors the
						sibling vehicle pages (`/app/maintenances/vehicle/:id`,
						`/app/tyres/vehicle/:id`) and never collides with `record/:id`. */}
						<Route path="/app/incidents/vehicle/:id" element={<IncidentTruckPage />} />
						{/* မှတ်တမ်း → the truck's LOG screen — a dedicated page (no bottom
						toolbar; native MainButton Save), opened by the per-truck + button. */}
						<Route path="/app/incidents/vehicle/:id/log" element={<IncidentLogPage />} />
						{/* Route rename — old /app/emergency deep links land on the incidents list. */}
						<Route path="/app/emergency" element={<Navigate to="/app/incidents" replace />} />
						<Route path="/app/emergency/+" element={<Navigate to="/app/incidents/+" replace />} />
						{/* Fuel fills were retired (no backend record); old deep links land on the
						launcher rather than a dead list. */}
						<Route path="/app/fuelings" element={<Navigate to="/app" replace />} />
						<Route path="/app/fuelings/+" element={<Navigate to="/app" replace />} />
						<Route path="/app/fuel" element={<Navigate to="/app" replace />} />
						<Route path="/app/fuel/+" element={<Navigate to="/app" replace />} />
						{/* ပစ္စည်းများ — the item catalog list (launcher tile `items`). */}
						<Route path="/app/items" element={<ItemsPage />} />
						{/* ပစ္စည်းများ — the bottom bar's + destination: the create form. */}
						<Route path="/app/items/+" element={<ItemCreatePage />} />
						{/* ပစ္စည်း ပြင်ဆင်မည် — tap an item card (or its ⋮ → Edit item model) to
					    open the row's edit page. The URL names the ACTION (`/edit`), and the
					    old bare `/:id` link redirects into it so existing deep links and the
					    stock register's expire cards keep working — with an honest URL. */}
						<Route path="/app/items/:id" element={<Navigate to="edit" relative="path" replace />} />
						<Route path="/app/items/:id/edit" element={<ItemEditPage />} />
						{/* Route rename — old /app/item-categories deep links land on the MRO hub. */}
						<Route path="/app/item-categories" element={<Navigate to="/app/mro-categories" replace />} />
						<Route path="/app/item-categories/+" element={<Navigate to="/app/mro-categories/+" replace />} />
						{/* ပစ္စည်းအုပ်စု — the MRO masters hub (launcher tile `item-categories`):
						အုပ်စု / ရောင်းချသူ tabs on ONE route (`?tab=`). */}
						<Route path="/app/mro-categories" element={<MroCategoriesPage />} />
						{/* ပစ္စည်းအုပ်စု — the hub's အုပ်စု tab + destination: the real item-name
						(mro_item_name) master create form. */}
						<Route path="/app/mro-categories/+" element={<MroCategoryCreatePage />} />
						{/* ပစ္စည်းအုပ်စု ပြင်ဆင်မည် — tap a group card's pencil to rename it
						(tracking is locked — set once at creation). */}
						<Route path="/app/mro-categories/groups/:id" element={<MroCategoryEditPage />} />
						{/* ရောင်းချသူ — the hub's ရောင်းချသူ tab + destination: a supplier master create form. */}
						<Route path="/app/mro-categories/suppliers/+" element={<MroSupplierCreatePage />} />
						{/* ရောင်းချသူ ပြင်ဆင်မည် — tap a supplier row on the ရောင်းချသူ tab to rename it. */}
						<Route path="/app/mro-categories/suppliers/:id" element={<MroSupplierEditPage />} />
						{/* စတော့ — the stock-level app (launcher tile `reports` → /app/stocks).
						The landing is the search-first item kiosk: ONE centred item-name search
						that answers with the current balance-row cards across every store. The
						full alert dashboard (tabs + store/category filters) moved to
						/app/stocks/browse (the kiosk's "Browse the stock dashboard" escape
						hatch). */}
						<Route path="/app/stocks" element={<StockPage />} />
						{/* စတော့ → Browse all — the tabbed alert dashboard (In Stock / Reorder /
						Stock Out / Expiring Soon + store/category filters), a real route so back
						returns to the kiosk. */}
						<Route path="/app/stocks/browse" element={<StockBrowsePage />} />
						{/* စတော့ → ONE item — the full-screen stock lines behind a balance card
						(per-store balances / FEFO lots / serial units, by the SKU's tracking
						policy). Reached from BOTH stock surfaces, so its back arrow pops to
						wherever the operator came from. */}
						<Route path="/app/stocks/item/:modelId" element={<StockItemPage />} />
						{/* Route rename — old /app/reports deep links land on the stock kiosk. */}
						<Route path="/app/reports" element={<Navigate to="/app/stocks" replace />} />
						{/* အထွက်စာရင်း — the MRO outbound hub (launcher tile `outbounds`): the
						Issue / Write-off / Dispose kinds are `?type=` tabs over one mro_outbounds flow. */}
						<Route path="/app/outbounds" element={<OutboundHubPage />} />
						{/* အထွက်စာရင်းအသစ် — the hub's single + destination (the kind comes from `?type=`). */}
						<Route path="/app/outbounds/+" element={<OutboundHubCreatePage />} />
						{/* အထွက်စာရင်း → ONE doc — tap an outbound card for its FULL-SCREEN items
						page (the former items bottom sheet is this real page with a back arrow). */}
						<Route path="/app/outbounds/:id" element={<OutboundDetailPage />} />
						{/* Route renames — old per-kind outbound deep links land on the matching hub tab. */}
						<Route path="/app/goods-issues" element={<Navigate to="/app/outbounds" replace />} />
						<Route path="/app/goods-issues/+" element={<Navigate to="/app/outbounds/+" replace />} />
						<Route path="/app/transfers" element={<Navigate to="/app/outbounds" replace />} />
						<Route path="/app/transfers/+" element={<Navigate to="/app/outbounds/+" replace />} />
						<Route path="/app/write-offs" element={<Navigate to="/app/outbounds?type=write_offs" replace />} />
						<Route path="/app/write-offs/+" element={<Navigate to="/app/outbounds/+?type=write_offs" replace />} />
						<Route path="/app/scrapes" element={<Navigate to="/app/outbounds?type=defects_missing" replace />} />
						<Route path="/app/scrapes/+" element={<Navigate to="/app/outbounds/+?type=defects_missing" replace />} />
						{/* Route renames — old issue/dispose deep links follow the same mapping. */}
						<Route path="/app/items-issue" element={<Navigate to="/app/outbounds" replace />} />
						<Route path="/app/items-issue/+" element={<Navigate to="/app/outbounds/+" replace />} />
						<Route path="/app/items-issues" element={<Navigate to="/app/outbounds" replace />} />
						<Route path="/app/items-issues/+" element={<Navigate to="/app/outbounds/+" replace />} />
						<Route path="/app/items-dispose" element={<Navigate to="/app/outbounds?type=write_offs" replace />} />
						<Route path="/app/items-dispose/+" element={<Navigate to="/app/outbounds/+?type=write_offs" replace />} />
						{/* အဝင်စာရင်း — the MRO inbound (GRN) HUB (launcher tile `inbounds`): the
						Purchase / Opening / Return kinds are `?type=` tabs over one mro_inbounds flow. */}
						<Route path="/app/inbounds" element={<InboundsPage />} />
						{/* အဝင်စာရင်းအသစ် — the + destination: the multi-line inbound create form
						(draft doc → confirm lands stock); the kind comes from `?type=`. */}
						<Route path="/app/inbounds/+" element={<InboundCreatePage />} />
						{/* အဝင်စာရင်း → ONE doc — tap an inbound card for its FULL-SCREEN items
						page (the former items bottom sheet is this real page with a back arrow). */}
						<Route path="/app/inbounds/:id" element={<InboundDetailPage />} />
						{/* ပြောင်းရွှေ့ — the MRO location-transfer list (launcher tile `stock-moves`). */}
						<Route path="/app/stock-moves" element={<StockMovesPage />} />
						{/* ပြောင်းရွှေ့မှုအသစ် — the bottom bar's + destination: the transfer create
						form (draft doc → confirm moves stock between the stores). */}
						<Route path="/app/stock-moves/+" element={<StockMoveCreatePage />} />
						{/* ပြောင်းရွှေ့မှု → ONE doc — tap a transfer card (or a TRF ledger line)
						for its FULL-SCREEN items page. */}
						<Route path="/app/stock-moves/:id" element={<StockMoveDetailPage />} />
						{/* Adjustment — the MRO stock-correction list (launcher tile `adjustments`). */}
						<Route path="/app/adjustments" element={<AdjustmentsPage />} />
						{/* Adjustment အသစ် — the bottom bar's + destination: the adjustment create
						form (operator report → a separate user authorizes to apply the ± deltas). */}
						<Route path="/app/adjustments/+" element={<AdjustmentCreatePage />} />
						{/* Adjustment → ONE doc — tap an adjustment card (or an ADJ ledger line)
						for its FULL-SCREEN items page. */}
						<Route path="/app/adjustments/:id" element={<AdjustmentDetailPage />} />
						{/* ပစ္စည်းလှုပ်ရှားမှု — the parts-movement ledger (launcher tile `movements`).
						The landing is the search-first item kiosk: ONE centred item search; a
						single match opens that item group's movement feed directly. The item-groups
						register moved to /app/movements/browse (the kiosk's "Browse all item
						groups" escape hatch). */}
						<Route path="/app/movements" element={<MovementGroupsPage />} />
						{/* ပစ္စည်းလှုပ်ရှားမှု → Browse all — the item-groups directory (the kiosk's
						idle link; a real route so back returns to the register in place). */}
						<Route path="/app/movements/browse" element={<MovementGroupsBrowsePage />} />
						<Route path="/app/movements/models" element={<MovementModelsPage />} />
						<Route path="/app/movements/ledger/:modelId" element={<MovementLedgerPage />} />
						{/* Projects — the project register (launcher tile `projects`). */}
						<Route path="/app/projects" element={<ProjectsPage />} />
						{/* Projects — the workload dashboard (bottom-bar shortcut). */}
						<Route path="/app/projects/workload" element={<WorkloadPage />} />
						{/* Projects — the bottom bar's + destination: the create form. */}
						<Route path="/app/projects/+" element={<ProjectCreatePage />} />
						{/* Projects — a task's create form (`?project=` binds the owner); the
					    NAMED `task/*` segment outranks the dynamic `/:id`. */}
						<Route path="/app/projects/task/+" element={<TaskCreatePage />} />
						{/* Projects — ONE task's full-screen detail + comments. */}
						<Route path="/app/projects/task/:id" element={<TaskDetailPage />} />
						{/* Projects — a task's edit form (the `edit` segment beats the detail route). */}
						<Route path="/app/projects/task/:id/edit" element={<TaskEditPage />} />
						{/* Projects — a project's edit form. */}
						<Route path="/app/projects/:id/edit" element={<ProjectEditPage />} />
						{/* Projects — ONE project's task feed (dynamic `:id` LAST in the module so
					    the static `+` / `workload` and `task/*` segments always win). */}
						<Route path="/app/projects/:id" element={<ProjectDetailPage />} />
						<Route path="/app/:appId" element={<AppPlaceholderPage />} />
						<Route path="*" element={<Navigate to="/app" replace />} />
					</Routes>
				</RouteErrorBoundary>
			</AuthGate>
		</Suspense>
	);
}
