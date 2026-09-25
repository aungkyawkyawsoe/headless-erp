/**
 * API Worker bundle budget — a CI guard against the Worker script silently
 * ballooning (a heavy dependency pulled into the worker, a front-end page bundle
 * imported by mistake, …). The Studio has an equivalent check for its front-end
 * bundle (`check-bundle-size.mjs`); this is the API-side twin.
 *
 * The API worker is built with `wrangler deploy --dry-run --outdir dist`
 * (`pnpm --filter @mmbix/api build`), which emits the single bundled Worker
 * script `dist/index.js` plus its source map. Wrangler's "Total Upload" is the
 * Worker script alone — the source map is a local debugging aid and is NOT part
 * of the uploaded artifact — so the budget gates the emitted `.js` size, raw and
 * gzipped (gzip is the number closest to the platform's script-size limit and to
 * real cold-start transfer cost).
 *
 * Usage: `pnpm --filter @mmbix/api build` first (CI runs it via
 * `pnpm turbo run build`), then `node scripts/check-api-bundle-size.mjs`. If no
 * build output exists the script runs the dry-run build itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'apps', 'api', 'dist');

// Budgets are set ~20–25% above the measured bundle so a normal feature lands
// freely but a large regression fails. Measured at the time of writing:
//   raw 1,172,353 B (1144.9 KiB) · gzip 313,827 B (306.5 KiB)
// Bump deliberately (and re-measure) when a legitimate feature grows the worker.
const RAW_BUDGET = 1_450_000; // bytes of emitted Worker .js
const GZIP_BUDGET = 390_000; // bytes of the same, gzipped

const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

function buildScripts() {
	return fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.js')) : [];
}

if (buildScripts().length === 0) {
	console.log('… no API build found — running `pnpm --filter @mmbix/api build` (wrangler dry-run)');
	const res = spawnSync('pnpm', ['--filter', '@mmbix/api', 'build'], { cwd: ROOT, stdio: 'inherit' });
	if (res.status !== 0) {
		console.error('✗ API build failed — cannot measure the bundle');
		process.exit(1);
	}
}

const scripts = buildScripts();
if (scripts.length === 0) {
	console.error(`✗ no API build at ${DIR} — run \`pnpm --filter @mmbix/api build\` first`);
	process.exit(1);
}

const measured = scripts.map((f) => {
	const bytes = fs.readFileSync(path.join(DIR, f));
	return { f, bytes: bytes.length, gzip: zlib.gzipSync(bytes).length };
});

const raw = measured.reduce((n, s) => n + s.bytes, 0);
const gzip = measured.reduce((n, s) => n + s.gzip, 0);
const largest = measured.reduce((m, s) => (s.bytes > m.bytes ? s : m), { f: '—', bytes: 0 });
const sourceMap = fs.existsSync(path.join(DIR, 'index.js.map')) ? fs.statSync(path.join(DIR, 'index.js.map')).size : 0;

let failed = false;
if (raw > RAW_BUDGET) {
	console.error(`✗ API worker ${mb(raw)} (${kib(raw)}) exceeds the raw budget ${mb(RAW_BUDGET)} (${kib(RAW_BUDGET)})`);
	failed = true;
}
if (gzip > GZIP_BUDGET) {
	console.error(`✗ API worker ${mb(gzip)} (${kib(gzip)}) gzip exceeds the gzip budget ${mb(GZIP_BUDGET)} (${kib(GZIP_BUDGET)})`);
	failed = true;
}
if (failed) {
	console.error(`  largest emitted file: ${largest.f} ${kib(largest.bytes)} — did a heavy dependency get pulled into the worker?`);
	process.exit(1);
}

console.log(
	`✓ API bundle within budget — ${scripts.length} file(s), raw ${kib(raw)} (${Math.round((raw / RAW_BUDGET) * 100)}% of budget), ` +
		`gzip ${kib(gzip)} (${Math.round((gzip / GZIP_BUDGET) * 100)}% of budget), largest ${largest.f} ${kib(largest.bytes)}` +
		(sourceMap ? `, source map ${mb(sourceMap)} (not uploaded)` : ''),
);
