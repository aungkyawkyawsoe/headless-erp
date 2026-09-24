-- Demo stock for the MRO stock screens (/app/stocks, "In Stock" tab).
--
-- Idempotent: new SKUs are find-or-create by name, and balances are upserted by
-- (model, location). Safe to run repeatedly against a local OR remote D1:
--
--   npx wrangler d1 execute mff-sys-db --local  --file scripts/seed-mro-demo-stock.sql
--   npx wrangler d1 execute mff-sys-db --remote --file scripts/seed-mro-demo-stock.sql
--
-- Only `standard`-tracking SKUs get balances here, so every row is ledger-clean
-- (derived_qty = null, drift = false) and /api/mro/stock/reconcile stays empty.
-- Rows whose reorder_level sits at/above the on-hand qty feed the "Reorder" tab.

-- ── 1. New standard SKUs (find-or-create by name_en) ───────────────────────
INSERT INTO cms_mro_item_model (id, name_en, item_name, expiry_alert_days, doc_status, _meta, created_at, updated_at)
SELECT 'cbe1422f-60b9-4891-9d97-1c05717052f1', 'M8 × 30', (SELECT id FROM cms_mro_item_name WHERE name_en = 'Bolt' AND deleted_at IS NULL LIMIT 1), 30, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL);

INSERT INTO cms_mro_item_model (id, name_en, item_name, expiry_alert_days, doc_status, _meta, created_at, updated_at)
SELECT 'a95908a5-7213-4d17-a89b-a0089fd427fd', 'M20 × 80', (SELECT id FROM cms_mro_item_name WHERE name_en = 'Bolt' AND deleted_at IS NULL LIMIT 1), 30, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_model WHERE name_en = 'M20 × 80' AND deleted_at IS NULL);

INSERT INTO cms_mro_item_model (id, name_en, item_name, expiry_alert_days, doc_status, _meta, created_at, updated_at)
SELECT '4cd2d9e8-e153-4504-a3f7-69f53ab9a1d0', 'M24 × 100', (SELECT id FROM cms_mro_item_name WHERE name_en = 'Bolt' AND deleted_at IS NULL LIMIT 1), 30, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_model WHERE name_en = 'M24 × 100' AND deleted_at IS NULL);

INSERT INTO cms_mro_item_model (id, name_en, item_name, expiry_alert_days, doc_status, _meta, created_at, updated_at)
SELECT 'c960ca9c-4f12-47c8-9ab2-43b4c51d5334', 'AF-3003', (SELECT id FROM cms_mro_item_name WHERE name_en = 'Air Filter' AND deleted_at IS NULL LIMIT 1), 30, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL);

INSERT INTO cms_mro_item_model (id, name_en, item_name, expiry_alert_days, doc_status, _meta, created_at, updated_at)
SELECT '2170b2e4-ce4e-4b29-977e-9cf704eb48a5', 'AF-4004', (SELECT id FROM cms_mro_item_name WHERE name_en = 'Air Filter' AND deleted_at IS NULL LIMIT 1), 30, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_model WHERE name_en = 'AF-4004' AND deleted_at IS NULL);

-- ── 2. Balances: main_store (the In Stock tab's default store) ─────────────
UPDATE cms_mro_inventory SET qty_on_hand = 200, reorder_level = 0,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30'  AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 75,  reorder_level = 0,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M20 × 80' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 40,  reorder_level = 0,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M24 × 100' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 22,  reorder_level = 0,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 9,   reorder_level = 15, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-4004' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 45,  reorder_level = 0,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 120, reorder_level = 0,  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 30,  reorder_level = 10, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 8,   reorder_level = 20, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'main_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1);

INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'c93a61e4-dc40-468c-a293-eb89fa4629c1', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1), 'main_store', 200, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '34a8661a-8a20-4c7f-8a2e-41e4d6c8b84b', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M20 × 80' AND deleted_at IS NULL LIMIT 1), 'main_store', 75, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M20 × 80' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M20 × 80' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '0b854790-9206-4080-9e24-048c093a015e', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M24 × 100' AND deleted_at IS NULL LIMIT 1), 'main_store', 40, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M24 × 100' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M24 × 100' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '8b2b00b4-9088-4e93-a9eb-da8441f9babc', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1), 'main_store', 22, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '107655ce-6bf2-49dd-89e9-4a5c66f2c9f7', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-4004' AND deleted_at IS NULL LIMIT 1), 'main_store', 9, 15, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-4004' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-4004' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '2954aeb1-4601-41a4-a693-0226fc74866f', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1), 'main_store', 45, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'ce76ba7b-e026-427b-bd9d-44e43ffcd35d', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1), 'main_store', 120, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'f659c40e-5d1f-4bb7-9a1b-adfa715c3599', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1), 'main_store', 30, 10, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'c296ec5f-7604-463c-8445-c0a2165ad54a', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1), 'main_store', 8, 20, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'main_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1));

-- ── 3. Balances: safety_store ─────────────────────────────────────────────
UPDATE cms_mro_inventory SET qty_on_hand = 60, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'safety_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 16, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'safety_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 60, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'safety_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 12, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'safety_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1);

INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'd53444a9-7bce-4735-98ce-16f269b4c74c', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1), 'safety_store', 60, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'safety_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M8 × 30' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '0fa625fb-7166-4a02-ae77-c98d7e89966f', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1), 'safety_store', 16, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'safety_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '4bc84bb2-f84f-42d8-8519-fa32648614c6', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1), 'safety_store', 60, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'safety_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'eea8c3bd-35f5-4a02-a63c-43f3615171d0', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1), 'safety_store', 12, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'safety_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-1001' AND deleted_at IS NULL LIMIT 1));

-- ── 4. Balances: admin_store ──────────────────────────────────────────────
UPDATE cms_mro_inventory SET qty_on_hand = 15, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'admin_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 6,  reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'admin_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1);

INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '3d306ee8-94db-4ffb-b38d-7a5aa9c05653', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1), 'admin_store', 15, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'admin_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M16 × 60' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'c717287c-6265-462c-b8a4-e961902efb79', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1), 'admin_store', 6, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'admin_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-3003' AND deleted_at IS NULL LIMIT 1));

-- ── 5. Balances: mandalay_store ───────────────────────────────────────────
UPDATE cms_mro_inventory SET qty_on_hand = 25, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'mandalay_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1);
UPDATE cms_mro_inventory SET qty_on_hand = 40, reorder_level = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE location = 'mandalay_store' AND deleted_at IS NULL AND model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1);

INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT 'df77bd6f-0c9e-4471-8aae-e9f3557edf18', (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1), 'mandalay_store', 25, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'mandalay_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'AF-2002' AND deleted_at IS NULL LIMIT 1));
INSERT INTO cms_mro_inventory (id, model, location, qty_on_hand, reorder_level, doc_status, _meta, created_at, updated_at)
SELECT '6e72ae03-e05e-4940-a3d9-08c93126523b', (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1), 'mandalay_store', 40, 0, 'draft', '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cms_mro_inventory i WHERE i.location = 'mandalay_store' AND i.deleted_at IS NULL AND i.model = (SELECT id FROM cms_mro_item_model WHERE name_en = 'M12 × 40' AND deleted_at IS NULL LIMIT 1));

-- ── Cleanup (run manually to undo) ────────────────────────────────────────
-- DELETE FROM cms_mro_inventory WHERE model IN (SELECT id FROM cms_mro_item_model WHERE name_en IN ('M8 × 30','M20 × 80','M24 × 100','AF-3003','AF-4004'));
-- DELETE FROM cms_mro_item_model WHERE name_en IN ('M8 × 30','M20 × 80','M24 × 100','AF-3003','AF-4004');
