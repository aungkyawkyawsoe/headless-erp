#!/usr/bin/env node
/**
 * Idempotent demo seed for the HRM master lookup collections the tgapp's
 * attendance / employees modules join against — `hrm_departments`,
 * `hrm_designations` and `hrm_shifts` (physical tables `cms_hrm_*`).
 *
 * Departments and designations carry a single required `name` column (the
 * engine's display column — `hrm_employees.department` / `.designation` m2o
 * expansions flatten `.name` at the mini-app data boundary). Shifts carry the
 * attendance clock the punch status formulas consume (`time_in` +
 * `working_hours` → shift end, `in_grace_period` / `out_grace_period` → the
 * late-in / early-out grace windows).
 *
 * Usage:
 *   cd apps/api && npx wrangler dev          # terminal 1 (IS_DEV local: dev-token = admin)
 *   node scripts/seed-hr-masters.mjs         # terminal 2
 *
 * Env overrides: PROVISION_API (default http://127.0.0.1:8788),
 *                PROVISION_TOKEN (default dev-token)
 *
 * Idempotent: rows are matched by `name` — re-running skips existing rows and
 * only creates the missing ones, so it is safe to re-run after a partial seed.
 */

const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exitCode = 1;
};

/* ── demo data ─────────────────────────────────────────────────────────── */

const DEPARTMENTS = [
  'Board Of Director',
  'Operation (Branch)',
  'Safety & Store',
  'Business Development',
  'Finance',
  'HR & Admin',
  'Operation (YGN)',
  'Vehicle',
];

const DESIGNATIONS = [
  'P.S.O',
  'Vehicle Director',
  'Executive Director',
  'Managing Director',
  'Procurement & Admin/HR Director',
  'Safety Assistant',
  'Maintenance Assistant',
  'Vehicle Assistant',
  'Vehicle Support Officer',
  'Safety Supervisor',
  'Maintenance Helper',
  'Admin Executive',
  'Store Executive',
  'Maintenance Staff',
  'Office Staff (Receptionist)',
  'HR & Admin Assistant',
  'Software-IT',
  'Labour',
  'Senior Business Controller',
  'Business Development Executive',
  'Cashier',
  'Junior Accountant',
  'HR & Admin Assistant Executive',
  'Finance Manager',
  'Senior Operation Executive',
  'Senior Accountant',
  'Operation Assistant Executive',
  'Junior Operation',
  'Ferry Driver',
  'Cleaner',
  'HR & Admin Assistant(M&E)',
  'Senior HR Executive',
  'Forklift Operator',
  'Assistant Admin Manager',
  'Director',
  'Vehicle Manager',
  'Operation Executive',
  'Supervisor',
  'Operation Manager',
  'Office Staff',
  'Conductor',
  'Driver',
];

// [name, time_in, working_hours, in_grace_period, out_grace_period]
const SHIFTS = [
// Branch offices / ferry terminals (YGN / NPT / TGI / BGO locations).
  ['Shift for YGN,NPT,TGI,BGO', '09:00', 8.0, 15, 15],
  // Board-of-director office hours.
  ['Shift for BOD', '10:00', 6.0, 30, 10],
  // Mandalay branch.
  ['Shift for MDY', '08:00', 8.5, 5, 10],
  // Safety & Store department (early start).
  ['Shift for Safety', '07:00', 8.0, 15, 40],
];

/* ── thin API helpers ──────────────────────────────────────────────────── */

/** Full parsed response body (envelope intact — list paging needs `meta`). */
async function callRaw(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...opts });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Call that unwraps the `{ success, data, meta }` envelope to `data`. */
async function call(path, opts = {}) {
  const body = await callRaw(path, opts);
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

/** Walk every page of a collection list (page-size policy caps one call at 100). */
async function fetchAll(slug) {
  const rows = [];
  let cursor = undefined;
  do {
    const q = new URLSearchParams({ limit: '100', sort: 'name' });
    if (cursor) q.set('cursor', cursor);
    const body = await callRaw(`/api/entities/${slug}?${q}`);
    rows.push(...body.data);
    cursor = body.meta.has_more ? body.meta.next_cursor : undefined;
  } while (cursor);
  return rows;
}

/** Find-or-create by the display `name` — re-runs never duplicate. */
async function findOrCreate(slug, payload) {
  const existing = await fetchAll(slug);
  const found = existing.find((r) => r.name === payload.name);
  if (found) return { row: found, created: false };
  const row = await call(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify(payload) });
  return { row, created: true };
}

/* ── run ───────────────────────────────────────────────────────────────── */

async function seedMasters() {
  log(`Seeding HR masters against ${BASE} (token: ${TOKEN === 'dev-token' ? 'dev-token' : '***'})\n`);

  // Health first — a clear message beats a wall of fetch errors.
  try {
    const health = await call('/api/health');
    log(`  ✓ API reachable (${health && health.status ? health.status : 'ok'})`);
  } catch (err) {
    fail(`API not reachable at ${BASE} — start it first (cd apps/api && npx wrangler dev): ${err.message}`);
    return;
  }

  let created = 0;
  let skipped = 0;

  log(`\nDepartments (hrm_departments) — ${DEPARTMENTS.length}`);
  for (const name of DEPARTMENTS) {
    const { created: isNew } = await findOrCreate('hrm_departments', { name });
    log(`  ${isNew ? '✓ +' : '=  '} ${name}`);
    if (isNew) created += 1;
    else skipped += 1;
  }

  log(`\nDesignations (hrm_designations) — ${DESIGNATIONS.length}`);
  for (const name of DESIGNATIONS) {
    const { created: isNew } = await findOrCreate('hrm_designations', { name });
    log(`  ${isNew ? '✓ +' : '=  '} ${name}`);
    if (isNew) created += 1;
    else skipped += 1;
  }

  log(`\nShifts (hrm_shifts) — ${SHIFTS.length}`);
  for (const [name, time_in, working_hours, in_grace_period, out_grace_period] of SHIFTS) {
    const { created: isNew } = await findOrCreate('hrm_shifts', {
      name,
      time_in,
      working_hours,
      in_grace_period,
      out_grace_period,
    });
    log(`  ${isNew ? '✓ +' : '=  '} ${name} · ${time_in} · ${working_hours}h · in-grace ${in_grace_period} · out-grace ${out_grace_period}`);
    if (isNew) created += 1;
    else skipped += 1;
  }

  log(`\n✅ Done — ${created} created, ${skipped} already present.`);
}

seedMasters();
