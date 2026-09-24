/**
 * Studio bundle budget — a CI guard against re-absorbing a heavy page into the
 * initial bundle.
 *
 * The authed pages are code-split (`React.lazy`), so the API-docs bundle
 * (`@scalar`, ~2.3 MB) and the IDP pages load ONLY when visited. The entry
 * `index-*.js` should therefore stay tiny; if someone statically imports a heavy
 * page again, the entry balloons and this check fails — the regression is caught
 * in CI, not by a user on a slow link.
 *
 * Usage: build the studio first (`pnpm --filter @mmbix/studio build`), then
 * `node scripts/check-bundle-size.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'apps', 'studio', 'dist', 'assets');

const CHUNK_BUDGET = 2_600_000; // a single lazy chunk (the scalar bundle is ~2.28 MB)
const ENTRY_BUDGET = 400_000; // the entry `index-*.js` (the shell only)
const TOTAL_BUDGET = 6_000_000; // every emitted JS file

const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;

if (!fs.existsSync(DIR)) {
	console.error(`✗ no studio build at ${DIR} — run \`pnpm --filter @mmbix/studio build\` first`);
	process.exit(1);
}

const sizes = fs
	.readdirSync(DIR)
	.filter((f) => f.endsWith('.js'))
	.map((f) => ({ f, bytes: fs.statSync(path.join(DIR, f)).size }));

const total = sizes.reduce((n, s) => n + s.bytes, 0);
const entries = sizes.filter((s) => /^index-.*\.js$/.test(s.f));
const largest = sizes.reduce((m, s) => (s.bytes > m.bytes ? s : m), { f: '—', bytes: 0 });

let failed = false;
for (const s of sizes) {
	if (s.bytes > CHUNK_BUDGET) {
		console.error(`✗ chunk ${s.f} = ${mb(s.bytes)} exceeds ${mb(CHUNK_BUDGET)}`);
		failed = true;
	}
}
for (const s of entries) {
	if (s.bytes > ENTRY_BUDGET) {
		console.error(`✗ entry ${s.f} = ${mb(s.bytes)} exceeds ${mb(ENTRY_BUDGET)} — a heavy page was statically imported?`);
		failed = true;
	}
}
if (total > TOTAL_BUDGET) {
	console.error(`✗ total JS ${mb(total)} exceeds ${mb(TOTAL_BUDGET)}`);
	failed = true;
}
if (failed) process.exit(1);

console.log(`✓ studio bundle within budget — total ${mb(total)}, largest chunk ${largest.f} ${mb(largest.bytes)}, entry ${mb(entries[0]?.bytes ?? 0)}`);
