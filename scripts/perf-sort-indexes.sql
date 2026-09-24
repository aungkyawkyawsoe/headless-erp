-- Sort-covering indexes for the hot tgapp list reads.
--
-- The default list read is `WHERE deleted_at IS NULL ORDER BY <sort> LIMIT n`.
-- Only (deleted_at, id) / (deleted_at, created_at, id) were auto-created, so any
-- OTHER sort (plate_no, name_en, month, …) forced a full scan + temp B-tree sort
-- on every page. The self-tuning index advisor now learns the ORDER BY column
-- automatically (packages/core/src/db/auto-indexer.ts); these statements give the
-- already-hot shapes the same index immediately and use the advisor's exact
-- naming + column order, so a later tune sees the index and skips (no duplicate).
--
-- Idempotent (IF NOT EXISTS) — safe to re-run.

-- sort-only shapes → (deleted_at, <sort>)
CREATE INDEX IF NOT EXISTS "idx_cms_veh_fleets_deleted_at_plate_no"           ON "cms_veh_fleets"           ("deleted_at", "plate_no");
CREATE INDEX IF NOT EXISTS "idx_cms_hrm_employees_deleted_at_name_en"        ON "cms_hrm_employees"        ("deleted_at", "name_en");
CREATE INDEX IF NOT EXISTS "idx_cms_hrm_projects_deleted_at_name"            ON "cms_hrm_projects"         ("deleted_at", "name");
CREATE INDEX IF NOT EXISTS "idx_cms_mro_item_name_deleted_at_name_en"        ON "cms_mro_item_name"        ("deleted_at", "name_en");
CREATE INDEX IF NOT EXISTS "idx_cms_mro_item_model_deleted_at_name_en"       ON "cms_mro_item_model"       ("deleted_at", "name_en");
CREATE INDEX IF NOT EXISTS "idx_cms_veh_odo_months_deleted_at_month"         ON "cms_veh_odo_months"       ("deleted_at", "month");
CREATE INDEX IF NOT EXISTS "idx_cms_veh_maintenance_logs_deleted_at_started_at" ON "cms_veh_maintenance_logs" ("deleted_at", "started_at");
CREATE INDEX IF NOT EXISTS "idx_cms_hrm_attendances_deleted_at_check_in"     ON "cms_hrm_attendances"      ("deleted_at", "check_in");

-- filter + sort shapes → (<fk>, <sort>) so one index serves both (the advisor's rule)
CREATE INDEX IF NOT EXISTS "idx_cms_veh_permits_vehicle_issue_date"          ON "cms_veh_permits"          ("vehicle", "issue_date");
CREATE INDEX IF NOT EXISTS "idx_cms_veh_insurances_vehicle_expiry_date"      ON "cms_veh_insurances"       ("vehicle", "expiry_date");
CREATE INDEX IF NOT EXISTS "idx_cms_veh_fluid_fills_vehicle_fluid_kind_odo_at_fill" ON "cms_veh_fluid_fills" ("vehicle", "fluid_kind", "odo_at_fill");

-- Superseded by idx_cms_veh_fleets_deleted_at_plate_no (same columns, canonical name).
DROP INDEX IF EXISTS "idx_cms_veh_fleets_deleted_plate";
