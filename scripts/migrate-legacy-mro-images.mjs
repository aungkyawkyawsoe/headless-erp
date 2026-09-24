#!/usr/bin/env node
/**
 * MIGRATE the legacy Directus SKU images → R2 + `mro_item_model.image`.
 *
 * Companion to `scripts/migrate-legacy-mro-catalog.mjs` (run that FIRST — the
 * SKU rows must exist and keep their legacy UUIDs). For every legacy
 * `consumable_item_model` that carries a `images` junction:
 *
 *   1. download the file bytes from Directus (`GET /assets/<file-id>`),
 *   2. upload ONE object to the remote R2 bucket (new-pipeline shapes are:
 *      `mro_item_model.image` = `/api/media/<key>`,
 *      `_media` = the asset registry row,
 *      `_media_refs` = the reference registry the GC reads),
 *   3. set `mro_item_model.image` when it is still NULL.
 *
 * The engine's own media pipeline maintains those three tables on an API write;
 * a raw migration bypasses it, so this script writes them together and exactly
 * in the engine's format (`media-ref.service.ts` `extractMediaKeys` → `/api/media/<key>`).
 *
 * IDENTITY / IDEMPOTENCY:
 *   - R2 key = `detUuid('mro_media:<legacy-model-uuid>') + <ext>` — the SAME
 *     model always maps to the SAME object, so a re-run finds the `_media` row
 *     and does not re-upload; the model image is only filled when NULL.
 *   - Downloaded bytes are cached under `<cache>/assets/` and file metadata in
 *     `<cache>/files.json`, so an interrupted run resumes without re-downloading.
 *
 * Legacy origin is flaky (Cloudflare 530 from time to time) — every Directus call
 * is retried with backoff, and `--cache` (sharing the catalog snapshot dir) lets
 * a re-run finish the R2/D1 half without the origin.
 *
 * Credentials: LEGACY_DIRECTUS_EMAIL / LEGACY_DIRECTUS_PASSWORD, plus the
 * Cloudflare OAuth login wrangler already holds (for `wrangler r2 object put`).
 *
 * Usage:
 *   node scripts/migrate-legacy-mro-images.mjs                       (dry-run)
 *   node scripts/migrate-legacy-mro-images.mjs --apply
 *   node scripts/migrate-legacy-mro-images.mjs --cache <dir>         (reuse snapshot)
 *   node scripts/migrate-legacy-mro-images.mjs --limit 5             (smoke)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
const CACHE = process.argv.includes('--cache') ? process.argv[process.argv.indexOf('--cache') + 1] : null;
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
/** Wait up to N seconds for the legacy Directus tunnel (Cloudflare error 1033)
 *  to come back before starting. */
const WAIT = process.argv.includes('--wait') ? Number(process.argv[process.argv.indexOf('--wait') + 1]) : 0;

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BUCKET = process.env.R2_BUCKET || INFRA.R2_BUCKET;
const BASE = 'https://api.cloudflare.com/client/v4';

const DIRECTUS = (process.env.LEGACY_DIRECTUS_URL ?? 'https://mex-svr.mfflogistics.com').replace(/\/$/, '');
const EMAIL = process.env.LEGACY_DIRECTUS_EMAIL;
const PASSWORD = process.env.LEGACY_DIRECTUS_PASSWORD;

const API_DIR = path.resolve(fileURLToPath(new URL('../apps/api', import.meta.url)));
const TMP_DIR = path.join(API_DIR, '.wrangler', 'legacy-mro-images');
const ASSET_CACHE = CACHE ? path.join(CACHE, 'assets') : path.join(TMP_DIR, 'assets');
const FILE_META_CACHE = CACHE ? path.join(CACHE, 'files.json') : path.join(TMP_DIR, 'files.json');

const RETRYABLE = /account is not valid|not authorized|too many requests|error 429|5\d\d|fetch failed|ECONN|ETIMEDOUT|socket|HTTP 5\d\d/i;

// ─── helpers ─────────────────────────────────────────────────────────────────

function detUuid(key) {
	const h = crypto.createHash('sha1').update(key).digest();
	const b = Buffer.from(h.subarray(0, 16));
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const hex = b.toString('hex');
	const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
		throw new Error(`detUuid produced a non-v4 id: ${id}`);
	}
	return id;
}

const sqlQuote = (value) => {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
};

/** Lowercased extension WITH the dot — identical to `R2Client._extractExt`. */
function extOf(filename) {
	const dot = String(filename ?? '').lastIndexOf('.');
	if (dot <= 0) return '';
	return filename.slice(dot).toLowerCase();
}

let directusToken = null;
async function ensureDirectusToken() {
	if (directusToken) return directusToken;
	if (!EMAIL || !PASSWORD) throw new Error('LEGACY_DIRECTUS_EMAIL / LEGACY_DIRECTUS_PASSWORD are required');
	const res = await fetchWithRetry(`${DIRECTUS}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	});
	const json = JSON.parse(await res.text());
	if (!json?.data?.access_token) throw new Error(`Directus login failed: ${JSON.stringify(json).slice(0, 200)}`);
	directusToken = json.data.access_token;
	return directusToken;
}

async function fetchWithRetry(url, options = {}, attempts = 6) {
	let lastErr;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const res = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers ?? {}) } });
			if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
			return res;
		} catch (err) {
			lastErr = err;
			if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
		}
	}
	throw new Error(`legacy request failed after ${attempts} attempts: ${lastErr?.message}`);
}

async function d1(sql) {
	const res = await fetchWithRetry(
		`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`,
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ sql }),
		},
		8,
	);
	const json = await res.json();
	if (!json.success) throw new Error(`D1 request failed: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
	const first = json.result?.[0];
	if (first?.success === false) throw new Error(`D1 statement errored: ${JSON.stringify(first.error ?? first).slice(0, 300)}`);
	return first?.results ?? [];
}

function wranglerBin() {
	const candidates = [path.join(API_DIR, 'node_modules/.bin/wrangler'), path.resolve(API_DIR, '../..', 'node_modules/.bin/wrangler')];
	return candidates.find((p) => fs.existsSync(p)) ?? 'npx';
}

function r2Put(key, filePath, contentType) {
	const bin = wranglerBin();
	const args = bin === 'npx' ? ['wrangler', 'r2', 'object', 'put'] : ['r2', 'object', 'put'];
	args.push(`${BUCKET}/${key}`, '--file', filePath, '--remote', '-y');
	if (contentType) args.push('--content-type', contentType);
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler put failed (${code}): ${out.slice(0, 400)}`))));
	});
}

const readJson = (file, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
};

/** Poll the legacy origin until it answers, or the deadline passes. Returns true
 *  when reachable. The tunnel drops with Cloudflare error 1033 (origin down). */
async function waitForOrigin(maxSeconds) {
	const deadline = Date.now() + maxSeconds * 1000;
	for (;;) {
		try {
			const res = await fetch(`${DIRECTUS}/server/ping`, { signal: AbortSignal.timeout(8000) });
			if (res.status < 500) return true;
		} catch {
			/* unreachable — keep waiting */
		}
		if (Date.now() >= deadline) return false;
		process.stdout.write('.');
		await new Promise((r) => setTimeout(r, 10_000));
	}
}

// ─── legacy load ─────────────────────────────────────────────────────────────

async function loadLegacyImageMap() {
	let models;
	let junction;
	if (CACHE && fs.existsSync(path.join(CACHE, 'model.json'))) {
		models = readJson(path.join(CACHE, 'model.json'), { data: [] }).data;
		junction = readJson(path.join(CACHE, 'junction.json'), { data: [] }).data;
	} else {
		const token = await ensureDirectusToken();
		const auth = { Authorization: `Bearer ${token}` };
		models = JSON.parse(await (await fetchWithRetry(`${DIRECTUS}/items/consumable_item_model?limit=-1`, { headers: auth })).text()).data;
		junction = JSON.parse(await (await fetchWithRetry(`${DIRECTUS}/items/consumable_item_model_files?limit=-1`, { headers: auth })).text()).data;
	}
	const fileByJunction = new Map(junction.map((r) => [Number(r.id), r.directus_files_id]).filter(([, f]) => f));
	const map = new Map();
	for (const m of models) {
		const ids = (Array.isArray(m.images) ? m.images : [])
			.map((v) => (v && typeof v === 'object' ? v.directus_files_id : fileByJunction.get(Number(v))))
			.filter(Boolean);
		if (ids.length > 0) map.set(String(m.id), ids[0]);
	}
	return map;
}

async function fileMetadata(fileId, attempts = 3) {
	const cache = readJson(FILE_META_CACHE, {});
	if (cache[fileId]) return cache[fileId];
	const token = await ensureDirectusToken();
	const res = await fetchWithRetry(`${DIRECTUS}/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } }, attempts);
	const json = JSON.parse(await res.text());
	if (!json?.data) throw new Error(`file ${fileId}: ${JSON.stringify(json).slice(0, 200)}`);
	cache[fileId] = json.data;
	fs.mkdirSync(path.dirname(FILE_META_CACHE), { recursive: true });
	fs.writeFileSync(FILE_META_CACHE, JSON.stringify(cache));
	return json.data;
}

/** Download an asset once, cache the bytes next to the snapshot. */
async function fetchAsset(fileId, filename) {
	fs.mkdirSync(ASSET_CACHE, { recursive: true });
	const local = path.join(ASSET_CACHE, `${fileId}${extOf(filename)}`);
	if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;
	// The `/assets` endpoint is NOT public on this Directus — a bearer token is
	// required (without it every file answers 403).
	const token = await ensureDirectusToken();
	const res = await fetchWithRetry(`${DIRECTUS}/assets/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) throw new Error(`asset ${fileId}: HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length === 0) throw new Error(`asset ${fileId}: empty body`);
	fs.writeFileSync(local, buf);
	return local;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
	await loadCfToken();
	console.log(`\nMigrate legacy MRO SKU images → R2 "${BUCKET}" + ${DB_ID}${APPLY ? '' : '  [DRY-RUN]'}`);

	if (WAIT > 0) {
		process.stdout.write(`Waiting up to ${WAIT}s for ${DIRECTUS} `);
		const up = await waitForOrigin(WAIT);
		console.log(up ? ' up.' : ' still down.');
		if (!up) throw new Error(`legacy origin unreachable after ${WAIT}s (Cloudflare 1033 — the origin tunnel is down)`);
	}

	const legacyFileByModel = await loadLegacyImageMap();
	console.log(`Legacy SKUs with an image: ${legacyFileByModel.size}`);
	if (legacyFileByModel.size === 0) throw new Error('no legacy images resolved — check the cache snapshot');

	// Live SKUs that still lack an image, restricted to the legacy set.
	const rows = await d1(
		`SELECT id, name_en, image FROM cms_mro_item_model WHERE deleted_at IS NULL AND (image IS NULL OR image = '')`,
	);
	const targets = rows.filter((r) => legacyFileByModel.has(String(r.id))).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
	console.log(`D1 SKUs missing an image: ${rows.length} · in the legacy set: ${targets.length}`);

	const planned = [];
	for (const row of targets) {
		const fileId = legacyFileByModel.get(String(row.id));
		planned.push({ row, fileId });
	}
	console.log(`\n── Plan: ${planned.length} image(s) to migrate ──────────────`);
	if (CACHE) console.log(`  snapshot: ${CACHE}`);

	// Pre-flight: the legacy origin must be reachable (it 530s in waves) — fail
	// fast instead of burning a 30s backoff per file.
	if (planned.length > 0) {
		try {
			await fileMetadata(planned[0].fileId, 2);
		} catch (err) {
			throw new Error(`legacy origin unreachable (${err.message}) — retry when https://mex-svr.mfflogistics.com responds`);
		}
	}

	// Existing _media keys (skip re-upload). Keys are `<uuid><ext>`, so match on
	// the uuid prefix — the ext can only be resolved after a metadata read.
	const mediaRows = await d1('SELECT key FROM _media');
	const keyByBase = new Map(mediaRows.map((r) => [String(r.key).replace(/\.[^.]*$/, ''), String(r.key)]));

	let uploaded = 0;
	let linked = 0;
	let reused = 0;
	const failures = [];

	for (const [index, { row, fileId }] of planned.entries()) {
		const progress = `[${index + 1}/${planned.length}] ${row.name_en}`;
		try {
			const meta = await fileMetadata(fileId);
			const base = detUuid(`mro_media:${row.id}`);
			const key = `${base}${extOf(meta.filename_download ?? meta.filename_disk ?? '')}`;
			const mediaUrl = `/api/media/${key}`;
			const rowId = detUuid(`mro_media_row:${row.id}`);
			const existingKey = keyByBase.get(base);

			if (!APPLY) {
				console.log(`  ${row.name_en}  →  ${key} (${meta.type ?? '?'}, ${meta.filesize ?? '?'}B)${existingKey ? ' [exists]' : ''}`);
				continue;
			}

			if (existingKey) {
				reused++;
				console.log(`${progress}  reuse ${key}`);
			} else {
				const localPath = await fetchAsset(fileId, meta.filename_download ?? meta.filename_disk ?? '');
				await r2Put(key, localPath, meta.type ?? 'application/octet-stream');
				await d1(
					`INSERT OR IGNORE INTO _media (id, key, filename, size, mime_type, url) VALUES (` +
						`${sqlQuote(rowId)}, ${sqlQuote(key)}, ${sqlQuote(meta.filename_download ?? 'image')}, ` +
						`${sqlQuote(Number(meta.filesize ?? 0))}, ${sqlQuote(meta.type ?? 'application/octet-stream')}, ${sqlQuote(mediaUrl)})`,
				);
				keyByBase.set(base, key);
				uploaded++;
				console.log(`${progress}  upload ${key}`);
			}
			await d1(`UPDATE cms_mro_item_model SET image = ${sqlQuote(mediaUrl)}, updated_at = ${sqlQuote(new Date().toISOString())} WHERE id = ${sqlQuote(row.id)} AND (image IS NULL OR image = '')`);
			await d1(`INSERT OR IGNORE INTO _media_refs (media_key, collection, doc_id) VALUES (${sqlQuote(key)}, 'mro_item_model', ${sqlQuote(row.id)})`);
			linked++;
		} catch (err) {
			failures.push(`${row.name_en} (${row.id}): ${err.message}`);
			console.log(`${progress}  FAIL ${err.message}`);
		}
	}

	console.log('\n── Result ───────────────────────────────────────────────');
	if (!APPLY) {
		console.log(`  dry-run — re-run with --apply`);
	} else {
		console.log(`  uploaded ${uploaded} · reused ${reused} · linked ${linked} · failed ${failures.length}`);
		if (failures.length > 0) {
			console.log('  failures:');
			for (const f of failures) console.log(`    - ${f}`);
		}
	}
	console.log('');
}

main().catch((err) => {
	console.error(`\nIMAGE MIGRATION FAILED: ${err.message}\n`);
	process.exit(1);
});
