#!/usr/bin/env node
/**
 * Idempotent demo seed for `hrm_employees` — ~10 staff rows wired to the HRM
 * master lookups seeded by `seed-hr-masters.mjs` (`hrm_departments` /
 * `hrm_designations` / `hrm_shifts`).
 *
 * Each employee links:
 *   department   — m2o → `hrm_departments.id` (matched by name below)
 *   designation  — m2o → `hrm_designations.id` (matched by name below)
 *   shifts       — m2m → `hrm_shifts.id` (matched by name below)
 *
 * After the roster, the `REPORTING` table below is written as
 * `hrm_employee_links` edges (superior → subordinate, matched by `eid`).
 * That collection is the reporting graph behind `hrm_employees.superiors` /
 * `.subordinates` (o2m reverse-reads over the link rows) and the tgapp
 * approval center's subordinate routing.
 *
 * Usage:
 *   node scripts/seed-hr-masters.mjs     # run once first (master lookups)
 *   node scripts/seed-hr-employees.mjs
 *
 * Env overrides: PROVISION_API (default http://127.0.0.1:8788),
 *                PROVISION_TOKEN (default dev-token)
 *
 * Idempotent: employees are matched by their unique `eid` and link edges by
 * their (superior, subordinate) pair — re-running only creates what's missing.
 *
 * Demo Telegram links: `etg_id` values (`demo-tg-01` …) are placeholders —
 * point one at a real Telegram account (set `etg_id` to that account's numeric
 * id) to exercise the punch/attendance flow end-to-end as that employee.
 */

const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error(`✗ ${m}`);
  process.exitCode = 1;
};

/* ── demo roster ─────────────────────────────────────────────────────────
 * Master names are matched against the seeded lookup rows; `shifts` are the
 * location-scoped shift names from seed-hr-masters.mjs. */

const EMPLOYEES = [
  {
    etg_id: 'demo-tg-01',
    eid: 'MFF-001',
    name_en: 'U Myint Aung',
    name_mm: 'ဦးမြင့်အောင်',
    gender: 'male',
    dob: '1970-03-15',
    doj: '2010-06-01',
    department: 'Board Of Director',
    designation: 'Managing Director',
    shifts: ['Shift for BOD'],
  },
  {
    etg_id: 'demo-tg-02',
    eid: 'MFF-002',
    name_en: 'Daw Su Su Hlaing',
    name_mm: 'ဒေါ်စုစုလှိုင်',
    gender: 'female',
    dob: '1978-08-22',
    doj: '2015-01-15',
    department: 'Board Of Director',
    designation: 'Executive Director',
    shifts: ['Shift for BOD'],
  },
  {
    etg_id: 'demo-tg-03',
    eid: 'MFF-003',
    name_en: 'U Aung Kyaw Moe',
    name_mm: 'ဦးအောင်ကျော်မိုး',
    gender: 'male',
    dob: '1982-11-05',
    doj: '2012-04-01',
    department: 'Operation (Branch)',
    designation: 'Operation Manager',
    shifts: ['Shift for MDY'],
  },
  {
    etg_id: 'demo-tg-04',
    eid: 'MFF-004',
    name_en: 'U Kyaw Zayar',
    name_mm: 'ဦးကျော်ဇေယျ',
    gender: 'male',
    dob: '1988-02-14',
    doj: '2016-07-18',
    department: 'Operation (YGN)',
    designation: 'Senior Operation Executive',
    shifts: ['Shift for YGN,NPT,TGI,BGO'],
  },
  {
    etg_id: 'demo-tg-05',
    eid: 'MFF-005',
    name_en: 'Daw Nilar Kyaw',
    name_mm: 'ဒေါ်နီလာကျော်',
    gender: 'female',
    dob: '1985-09-30',
    doj: '2014-03-10',
    department: 'Finance',
    designation: 'Finance Manager',
    shifts: ['Shift for YGN,NPT,TGI,BGO'],
  },
  {
    etg_id: 'demo-tg-06',
    eid: 'MFF-006',
    name_en: 'U Zaw Lin',
    name_mm: 'ဦးဇော်လင်း',
    gender: 'male',
    dob: '1990-05-21',
    doj: '2017-09-01',
    department: 'Finance',
    designation: 'Senior Accountant',
    shifts: ['Shift for YGN,NPT,TGI,BGO'],
  },
  {
    etg_id: 'demo-tg-07',
    eid: 'MFF-007',
    name_en: 'Ma Ei Mon',
    name_mm: 'မအိမွန်',
    gender: 'female',
    dob: '1996-12-08',
    doj: '2021-11-01',
    department: 'HR & Admin',
    designation: 'HR & Admin Assistant Executive',
    shifts: ['Shift for YGN,NPT,TGI,BGO'],
  },
  {
    etg_id: 'demo-tg-08',
    eid: 'MFF-008',
    name_en: 'U Ye Naing',
    name_mm: 'ဦးရဲနိုင်',
    gender: 'male',
    dob: '1992-06-27',
    doj: '2019-02-04',
    department: 'Business Development',
    designation: 'Business Development Executive',
    shifts: ['Shift for YGN,NPT,TGI,BGO'],
  },
  {
    etg_id: 'demo-tg-09',
    eid: 'MFF-009',
    name_en: 'U Hla Tun',
    name_mm: 'ဦးလှထွန်း',
    gender: 'male',
    dob: '1986-01-19',
    doj: '2013-08-15',
    department: 'Safety & Store',
    designation: 'Safety Supervisor',
    shifts: ['Shift for Safety'],
  },
  {
    etg_id: 'demo-tg-10',
    eid: 'MFF-010',
    name_en: 'U Soe Naing',
    name_mm: 'ဦးစိုးနိုင်း',
    gender: 'male',
    dob: '1984-07-07',
    doj: '2011-05-20',
    department: 'Vehicle',
    designation: 'Vehicle Manager',
    shifts: ['Shift for YGN,NPT,TGI,BGO'],
  },
];

/* ── demo reporting lines (superior eid → subordinate eid) ──────────────────
 * One hrm_employee_links row per edge. MFF-003 reports to BOTH directors on
 * purpose — an employee with more than one superior exercises the many-side
 * of `superiors`; MFF-001 accumulates several `subordinates` for the other
 * direction. */
const REPORTING = [
  ['MFF-001', 'MFF-003'], // Managing Director ← Operation Manager
  ['MFF-002', 'MFF-003'], // Executive Director ← Operation Manager (2nd superior)
  ['MFF-003', 'MFF-004'], // Operation Manager ← Senior Operation Executive
  ['MFF-001', 'MFF-005'], // Managing Director ← Finance Manager
  ['MFF-005', 'MFF-006'], // Finance Manager ← Senior Accountant
  ['MFF-001', 'MFF-007'], // Managing Director ← HR & Admin Assistant Executive
  ['MFF-001', 'MFF-008'], // Managing Director ← Business Development Executive
  ['MFF-001', 'MFF-010'], // Managing Director ← Vehicle Manager
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
async function fetchAll(slug, sort = 'name', fields) {
  const rows = [];
  let cursor = undefined;
  do {
    const q = new URLSearchParams({ limit: '100', sort });
    if (fields) q.set('fields', fields);
    if (cursor) q.set('cursor', cursor);
    const body = await callRaw(`/api/entities/${slug}?${q}`);
    rows.push(...body.data);
    cursor = body.meta.has_more ? body.meta.next_cursor : undefined;
  } while (cursor);
  return rows;
}

/* ── run ───────────────────────────────────────────────────────────────── */

async function seedEmployees() {
  log(`Seeding HR demo employees against ${BASE} (token: ${TOKEN === 'dev-token' ? 'dev-token' : '***'})\n`);

  // Health first — a clear message beats a wall of fetch errors.
  try {
    const health = await call('/api/health');
    log(`  ✓ API reachable (${health && health.status ? health.status : 'ok'})`);
  } catch (err) {
    fail(`API not reachable at ${BASE} — start it first (cd apps/api && npx wrangler dev): ${err.message}`);
    return;
  }

  // Resolve the master lookups once — every employee links rows BY NAME so the
  // roster stays readable; missing masters fail loudly (run seed-hr-masters.mjs).
  const [departments, designations, shifts] = await Promise.all([
    fetchAll('hrm_departments'),
    fetchAll('hrm_designations'),
    fetchAll('hrm_shifts'),
  ]);
  const byName = (rows) => new Map(rows.map((r) => [r.name, r]));
  const deptByName = byName(departments);
  const desigByName = byName(designations);
  const shiftByName = byName(shifts);

  const missing = new Set();
  for (const e of EMPLOYEES) {
    if (!deptByName.has(e.department)) missing.add(`department: ${e.department}`);
    if (!desigByName.has(e.designation)) missing.add(`designation: ${e.designation}`);
    for (const s of e.shifts) if (!shiftByName.has(s)) missing.add(`shift: ${s}`);
  }
  if (missing.size > 0) {
    fail(`Master lookup rows missing (run node scripts/seed-hr-masters.mjs first):\n    ${[...missing].join('\n    ')}`);
    return;
  }

  // Idempotency key: `eid` (the unique employee code).
  const existing = await fetchAll('hrm_employees', 'eid');
  const byEid = new Map(existing.map((r) => [r.eid, r]));

  let created = 0;
  let skipped = 0;

  for (const e of EMPLOYEES) {
    const cur = byEid.get(e.eid);
    if (cur) {
      log(`  =   ${e.eid} ${e.name_en} — already present`);
      skipped += 1;
      continue;
    }
    const payload = {
      etg_id: e.etg_id,
      eid: e.eid,
      name_en: e.name_en,
      name_mm: e.name_mm,
      gender: e.gender,
      dob: e.dob,
      doj: e.doj,
      active: true,
      department: deptByName.get(e.department).id,
      designation: desigByName.get(e.designation).id,
      shifts: e.shifts.map((s) => shiftByName.get(s).id),
    };
    await call(`/api/entities/hrm_employees`, { method: 'POST', body: JSON.stringify(payload) });
    log(`  ✓ + ${e.eid} ${e.name_en} · ${e.department} · ${e.designation} · ${e.shifts.join(' + ')}`);
    created += 1;
  }

  // ── reporting lines (hrm_employee_links): one superior→subordinate edge ──
  // Idempotency key: the (superior, subordinate) uuid pair.
  const empByEid = new Map((await fetchAll('hrm_employees', 'eid')).map((r) => [r.eid, r]));
  // m2o sides may arrive lean (scalar uuid) or expanded ({ id, … }) depending on
  // the fetch — normalize both to the uuid before keying the pair.
  const idOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.id : '');
  const existingLinks = await fetchAll('hrm_employee_links', 'id', 'superior,subordinate');
  const have = new Set(existingLinks.map((l) => `${idOf(l.superior)}:${idOf(l.subordinate)}`));
  let linked = 0;
  for (const [supEid, subEid] of REPORTING) {
    const sup = empByEid.get(supEid);
    const sub = empByEid.get(subEid);
    if (!sup || !sub) {
      fail(`Reporting line ${supEid} → ${subEid}: employee row missing`);
      continue;
    }
    const key = `${sup.id}:${sub.id}`;
    if (have.has(key)) {
      log(`  =   ${supEid} → ${subEid} — already linked`);
      continue;
    }
    await call(`/api/entities/hrm_employee_links`, {
      method: 'POST',
      body: JSON.stringify({ superior: sup.id, subordinate: sub.id }),
    });
    log(`  ✓ + ${supEid} → ${subEid}`);
    linked += 1;
  }

  log(`\n✅ Done — ${created} created, ${skipped} already present, ${linked} reporting links added.`);
}

seedEmployees();
