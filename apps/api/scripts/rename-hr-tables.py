#!/usr/bin/env python3
"""
Align the HR (hrm_*) and vehicle (veh_*) verticals to their module slugs.

One-time migration for databases that were provisioned BEFORE the module-slug
rename (slugs `employees`/`fleets`…, tables `cms_employees`/`cms_fleets`…).
After this, slug == API endpoint == `hrm_employees` etc., and the physical
table name derives automatically (cms_ + slug). Fresh provisions via
provision-hr-schema.mjs already use the module slugs — this script then
becomes a no-op.

What it does, idempotently:
  1. rename physical tables  cms_<oldSlug>        → cms_<newSlug>
  2. rename the employees↔shifts m2m junction      → _jt_cms_hrm_employees_cms_hrm_shifts
  3. update _entity_schemas.slug (old → new)
  4. rewrite every schema_json `related_collection` pointing at old slugs
  5. re-point _role_permissions.collection_slug rows

NOT renamed: telegram_requests — apps/api/src/routes/auth-telegram.ts queries
it through `collectionTable('telegram_requests')` (slug-derived), so slug and
table stay `telegram_requests` / `cms_telegram_requests`.

Usage:
    python3 apps/api/scripts/rename-hr-tables.py [path-to-d1.sqlite]
"""
import sqlite3
import sys

DEFAULT_DB = (
    "apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/"
    "ba8df3bc13a30ad40c6aeb7753a161bfccef0d938508a6abe400cd43af55d4ab.sqlite"
)

# old slug → new slug (module-prefixed)
SLUG = {
    "employees": "hrm_employees",
    "attendances": "hrm_attendances",
    "leaves": "hrm_leaves",
    "overtimes": "hrm_overtimes",
    "early_leaves": "hrm_early_leaves",
    "shifts": "hrm_shifts",
    "departments": "hrm_departments",
    "designations": "hrm_designations",
    "employee_links": "hrm_employee_links",
    "fleets": "veh_fleets",
}
# vehicle lifecycle slugs (collections provisioned later under veh_*)
VEH = {
    "vehicle_fuel_logs": "veh_fuel_logs",
    "vehicle_permits": "veh_permits",
    "vehicle_insurances": "veh_insurances",
    "vehicle_maintenance": "veh_maintenance",
    "vehicle_incidents": "veh_incidents",
    "vehicle_tyres": "veh_tyres",
    "vehicle_issue_types": "veh_issue_types",
}
JUNCTION = "_jt_cms_hrm_employees_cms_hrm_shifts"
JUNCTION_VARIANTS = [
    "_jt_cms_employees_cms_shifts",
    "_jt_cms_hrm_employees_cms_shifts",
]


def q(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def has_table(db, name: str) -> bool:
    return db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?", (name,)).fetchone()[0] == 1


def main(path: str) -> int:
    print(f"Migrating {path}")
    db = sqlite3.connect(path, timeout=30)
    db.execute("PRAGMA busy_timeout = 30000")
    try:
        # ── 1+2: physical tables + the m2m junction ──────────────────────────
        for old_slug, new_slug in SLUG.items():
            old_tbl, new_tbl = f"cms_{old_slug}", f"cms_{new_slug}"
            row = db.execute("SELECT table_name FROM _entity_schemas WHERE slug = ?", (old_slug,)).fetchone()
            stored = row[0] if row else None
            new_row = db.execute("SELECT table_name FROM _entity_schemas WHERE slug = ?", (new_slug,)).fetchone()
            if stored is None:
                # Already renamed (or never existed under the old slug).
                if new_row and new_row[0] == new_tbl and has_table(db, new_tbl):
                    print(f"  = {old_slug} → {new_slug}: already aligned (slug {new_slug}, table {new_tbl})")
                else:
                    print(f"  ! {old_slug}: no old row and no aligned {new_slug} row — skipped")
                continue
            if stored == new_tbl and has_table(db, new_tbl):
                print(f"  = {old_slug} → {new_slug}: table already {new_tbl} (slug rename still pending)")
            elif stored == old_tbl and not has_table(db, new_tbl) and has_table(db, old_tbl):
                db.execute(f"ALTER TABLE {q(old_tbl)} RENAME TO {q(new_tbl)}")
                db.execute("UPDATE _entity_schemas SET table_name = ? WHERE slug = ?", (new_tbl, old_slug))
                print(f"  ✓ {old_slug}: table {old_tbl} → {new_tbl}")
            else:
                print(f"  ✗ {old_slug}: stored {stored!r}, physical old={has_table(db, old_tbl)} new={has_table(db, new_tbl)} — aborting")
                return 1

        if has_table(db, JUNCTION):
            print(f"  = junction: already {JUNCTION}")
        else:
            found = None
            for v in JUNCTION_VARIANTS:
                if has_table(db, v):
                    found = v
                    break
            if found:
                db.execute(f"ALTER TABLE {q(found)} RENAME TO {q(JUNCTION)}")
                print(f"  ✓ junction: {found} → {JUNCTION}")
            else:
                print(f"  ! junction {JUNCTION} not found — was it never created? (no employees↔shifts m2m rows)")

        # ── 3: slugs ─────────────────────────────────────────────────────────
        for old_slug, new_slug in SLUG.items():
            cur = db.execute("UPDATE _entity_schemas SET slug = ? WHERE slug = ?", (new_slug, old_slug))
            if cur.rowcount:
                print(f"  ✓ slug {old_slug} → {new_slug}")

        # ── 4: related_collection inside every schema_json ───────────────────
        map_all = {**SLUG, **VEH}
        changed = 0
        for slug, sj in db.execute("SELECT slug, schema_json FROM _entity_schemas").fetchall():
            if not sj:
                continue
            import json

            blob = json.loads(sj)
            hit = False
            for f in blob.get("fields") or []:
                rc = f.get("related_collection")
                if rc in map_all:
                    f["related_collection"] = map_all[rc]
                    hit = True
            if hit:
                db.execute(
                    "UPDATE _entity_schemas SET schema_json = ? WHERE slug = ?", (json.dumps(blob), slug)
                )
                changed += 1
        print(f"  ✓ schema_json related_collection rewritten in {changed} collection(s)")

        # ── 5: RBAC rows ─────────────────────────────────────────────────────
        total = 0
        for old_slug, new_slug in map_all.items():
            cur = db.execute(
                "UPDATE _role_permissions SET collection_slug = ? WHERE collection_slug = ?",
                (new_slug, old_slug),
            )
            total += cur.rowcount
        print(f"  ✓ _role_permissions rows re-pointed: {total}")

        db.commit()
    finally:
        db.close()

    # ── verification ────────────────────────────────────────────────────────
    db = sqlite3.connect(path, timeout=30)
    try:
        for old_slug, new_slug in SLUG.items():
            row = db.execute(
                "SELECT table_name FROM _entity_schemas WHERE slug = ?", (new_slug,)
            ).fetchone()
            if not row or row[0] != f"cms_{new_slug}" or not has_table(db, row[0]):
                print(f"  ✗ verify {new_slug}: {row}")
                return 1
        print("  ✓ all collections aligned (slug == endpoint == cms_<slug> table)")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB))
