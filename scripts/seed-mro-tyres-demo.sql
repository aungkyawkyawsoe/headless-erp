-- Demo fitment for ONE truck: 6 tyres WORN on its wheels + 2 tray spares.
--
-- Why: the wear loop on `/app/tyres/vehicle/:id` needs a truck that actually
-- holds tyres. 5S-6467 (`tractor_unit`, 10 wheels, no declared `wheel_slots`) had
-- none, so the rig drew ten vacant seats and the list's Tyre tab was empty.
--
-- Idempotent: every serial is find-or-create by `serial_no`, and every event is
-- guarded by (serial, event) — so `issued` + `vehicle` set is never duplicated.
-- Safe to run repeatedly against a local OR remote D1:
--
--   cd apps/api && npx wrangler d1 execute mff-sys-db --local  --file ../../scripts/seed-mro-tyres-demo.sql
--   npx wrangler d1 execute mff-sys-db --remote --file scripts/seed-mro-tyres-demo.sql
--
-- If the shell cannot reach D1's import host, the same file applies through the
-- plain query endpoint: strip the `--` lines and pass the rest to `--command`.
--
-- Ledger-clean by construction: every row is `issued` (never `in_stock`), so the
-- stock reconcile's `derived_qty` (which counts only `in_stock` serials) never
-- sees them, `cms_mro_inventory` is untouched (no `balance_drift`), and the final
-- UPDATE keeps each serial's `updated_at` at/after its newest event (no
-- `snapshot_stale`). `GET /api/mro/stock/reconcile` stays empty.
--
-- The serials are raw SQL because `cms_mro_stock_serials` is a
-- `writes.mode = 'service'` collection and `cms_mro_serial_events` is
-- `append_only`: the generic entity API refuses both by design.
--
-- SKUs + the plate are resolved BY NAME, never by hard-coded id, so the same file
-- seeds local and remote alike. `by_user` is the existing demo operator.
--
-- Cleanup (run manually to undo):
--   DELETE FROM cms_mro_serial_events WHERE serial IN (SELECT id FROM cms_mro_stock_serials WHERE serial_no LIKE 'TYR-5S6467-%');
--   DELETE FROM cms_mro_stock_serials WHERE serial_no LIKE 'TYR-5S6467-%';

-- ── 1. The worn wheels — one serial per occupied seat, tread spread across the
--       three bands (≥5 mm Good / 3–5 Warning / <3 Replace) so the rig's tiles and
--       the KPI footer show all three tones. Seats follow `fallbackSeatsFor` for a
--       cabbed 10-wheel unit: steer-l / steer-r, then two dual rear axles.
INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '11R 22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-01', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'steer-l', 12.9, 120, 480000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '11R 22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-01');

INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT 'cd1c98e2-bb48-4c99-84a6-3280d41d1764',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '11R 22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-02', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'steer-r', 11.5, 118, 480000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '11R 22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-02');

INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT '52bad0fa-f0ae-45da-9747-b328032b4309',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-03', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-lo', 8.0, 110, 520000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-03');

INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT 'fd609d2f-ff28-4996-a1a4-ac15364d53e5',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-04', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-li', 4.5, 108, 520000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-04');

INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT '56fee964-6c13-4b54-878e-6af571696173',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-05', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-ri', 4.9, 108, 520000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-05');

INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-06', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-ro', 2.1, 102, 520000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '315/80R22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-06');

-- ── 2. The tray spares — `slot` NULL, still `issued` to the same truck. These are
--       the units the list's `Wear` action seats onto a vacant wheel, so the whole
--       wear → rig-repaints loop is exercisable from the demo data.
INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT 'e24e464a-bd72-4675-af1c-99a1fb85f4e8',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '10.00R20' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-07', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       NULL, 10.0, NULL, 440000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '10.00R20' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-07');

INSERT INTO cms_mro_stock_serials (id, model, location, serial_no, status, vehicle, slot, tread_mm, psi, unit_cost, _meta, created_at, updated_at)
SELECT '2eb5e82c-75dc-474f-a006-ad2b9454155b',
       (SELECT id FROM cms_mro_item_model WHERE name_en = '295/80R22.5' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'TYR-5S6467-08', 'issued',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       NULL, 3.8, NULL, 460000, '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = '295/80R22.5' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE serial_no = 'TYR-5S6467-08');

-- ── 3. The lifecycle behind each serial — `purchased` into the vehicle store (the
--       engine sets no `event_date` there, so the timeline narrates from its real
--       timestamp), then ONE `fitted` event: with a `to_slot` for a wheel fit, with
--       none for a tray placement. That is EXACTLY how `POST /serials/:id/fit`
--       writes it, so the serial page reads "Received into store → Fitted to
--       vehicle" / "→ Issued to truck (spare)" for the demo units as it does for
--       real ones.
INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT 'dbba7655-b178-431e-ba9d-f309f7371d1e', '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT '81250dfa-3f90-4e66-9db3-fb34cd2e156d', '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'steer-l', 'vehicle_store', 'fit', 'TYR-5S6467-01', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '6c74a10e-6d0f-4a4a-8454-e7fca1a89be5' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT '6225cbfb-2461-4044-a357-ff08bac94fd8', 'cd1c98e2-bb48-4c99-84a6-3280d41d1764', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'cd1c98e2-bb48-4c99-84a6-3280d41d1764')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'cd1c98e2-bb48-4c99-84a6-3280d41d1764' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT 'f72530c2-4023-485f-9823-58d6c429d8c7', 'cd1c98e2-bb48-4c99-84a6-3280d41d1764', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'steer-r', 'vehicle_store', 'fit', 'TYR-5S6467-02', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'cd1c98e2-bb48-4c99-84a6-3280d41d1764')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'cd1c98e2-bb48-4c99-84a6-3280d41d1764' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT '53d56229-6037-4270-a533-44d754c0df19', '52bad0fa-f0ae-45da-9747-b328032b4309', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '52bad0fa-f0ae-45da-9747-b328032b4309')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '52bad0fa-f0ae-45da-9747-b328032b4309' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT '715633c6-ae02-40aa-a95e-021a287d85ca', '52bad0fa-f0ae-45da-9747-b328032b4309', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-lo', 'vehicle_store', 'fit', 'TYR-5S6467-03', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '52bad0fa-f0ae-45da-9747-b328032b4309')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '52bad0fa-f0ae-45da-9747-b328032b4309' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT '7b293654-6df6-4dbe-957e-ac0d6ee686ab', 'fd609d2f-ff28-4996-a1a4-ac15364d53e5', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'fd609d2f-ff28-4996-a1a4-ac15364d53e5')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'fd609d2f-ff28-4996-a1a4-ac15364d53e5' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT 'ab8e3f30-561d-4eba-81a5-737b225d9352', 'fd609d2f-ff28-4996-a1a4-ac15364d53e5', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-li', 'vehicle_store', 'fit', 'TYR-5S6467-04', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'fd609d2f-ff28-4996-a1a4-ac15364d53e5')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'fd609d2f-ff28-4996-a1a4-ac15364d53e5' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT '8f6224da-1438-4090-a796-182130b13db8', '56fee964-6c13-4b54-878e-6af571696173', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '56fee964-6c13-4b54-878e-6af571696173')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '56fee964-6c13-4b54-878e-6af571696173' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT '318e790a-9378-4435-9596-800f388acbee', '56fee964-6c13-4b54-878e-6af571696173', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-ri', 'vehicle_store', 'fit', 'TYR-5S6467-05', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '56fee964-6c13-4b54-878e-6af571696173')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '56fee964-6c13-4b54-878e-6af571696173' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT 'b5d9d4a5-5eaa-4270-a282-822c57817791', 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, to_slot, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT 'b6c446ed-e7b7-4157-8125-255dd4f76dd4', 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'drv1-ro', 'vehicle_store', 'fit', 'TYR-5S6467-06', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'd2f7a125-adf4-4114-84e1-b19d7eb2b3bc' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT 'e845f5e1-0ba3-4f0e-bbaf-b5805cb3d10e', 'e24e464a-bd72-4675-af1c-99a1fb85f4e8', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'e24e464a-bd72-4675-af1c-99a1fb85f4e8')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'e24e464a-bd72-4675-af1c-99a1fb85f4e8' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT '114eaa49-2a1a-4248-87f5-c2cfeb703eaf', 'e24e464a-bd72-4675-af1c-99a1fb85f4e8', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'fit', 'TYR-5S6467-07', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = 'e24e464a-bd72-4675-af1c-99a1fb85f4e8')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = 'e24e464a-bd72-4675-af1c-99a1fb85f4e8' AND event = 'fitted' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, from_location, to_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at)
SELECT 'e1a316b4-a4b2-4638-90fa-bff0684dc6d5', '2eb5e82c-75dc-474f-a006-ad2b9454155b', 'purchased', NULL, 'vehicle_store', 'purchase', 'INB-00007', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '2eb5e82c-75dc-474f-a006-ad2b9454155b')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '2eb5e82c-75dc-474f-a006-ad2b9454155b' AND event = 'purchased' AND deleted_at IS NULL);

INSERT INTO cms_mro_serial_events (id, serial, event, to_vehicle, from_location, ref_kind, ref_doc, by_user, _meta, created_at, updated_at, event_date)
SELECT '7bd509c9-ad50-40a0-bd79-e909bf3156bb', '2eb5e82c-75dc-474f-a006-ad2b9454155b', 'fitted',
       (SELECT id FROM cms_veh_fleets WHERE plate_no = '5S-6467' AND deleted_at IS NULL LIMIT 1),
       'vehicle_store', 'fit', 'TYR-5S6467-08', '29bffa73-b8ec-412f-8f95-866dcbc5514a', '{}',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), date('now')
WHERE EXISTS (SELECT 1 FROM cms_mro_stock_serials WHERE id = '2eb5e82c-75dc-474f-a006-ad2b9454155b')
  AND NOT EXISTS (SELECT 1 FROM cms_mro_serial_events WHERE serial = '2eb5e82c-75dc-474f-a006-ad2b9454155b' AND event = 'fitted' AND deleted_at IS NULL);

-- ── 4. Keep each serial's LIVE snapshot at/after its newest event, so the stock
--       reconcile's `snapshot_stale` check stays empty (it compares timestamps at
--       second granularity). Harmless on a re-run.
UPDATE cms_mro_stock_serials
   SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE serial_no LIKE 'TYR-5S6467-%' AND deleted_at IS NULL;
