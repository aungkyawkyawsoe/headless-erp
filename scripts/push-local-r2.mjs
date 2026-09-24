/**
 * Push the LOCAL wrangler dev R2 state → the REMOTE production bucket.
 * The reverse of scripts/sync-r2-to-local.mjs: after working on media locally
 * (uploading files through the local API), this mirrors the local objects up so
 * production serves the same bytes.
 *
 * Local source: the miniflare R2 store — metadata in
 * `.wrangler/state/v3/r2/miniflare-R2BucketObject/<hash>.sqlite` (`_mf_objects`
 * table: key, blob_id, size, http_metadata), payloads in
 * `.wrangler/state/v3/r2/<bucket>/blobs/<blob_id>`. The database that belongs to
 * the bucket is resolved by blob_id overlap (no hardcoded hash).
 *
 * Uploads via `wrangler r2 object put --remote` (works with the plain wrangler
 * OAuth login). Push is ADDITIVE/upsert — remote objects that do not exist
 * locally are left alone; use --verify to see the delta. Non-fatal caveat:
 * miniflare `custom_metadata` (e.g. `originalName`) has no wrangler-put flag and
 * is not transferred; `contentType`/`cacheControl`/`contentLanguage`/
 * `contentDisposition` are.
 *
 * Resume: completed objects are recorded in `.wrangler/r2-push-state-<bucket>.json`
 * (key → size); re-runs skip them, so an interrupted push picks up where it left
 * off. Force a full re-push with --force.
 *
 * Usage:  node scripts/push-local-r2.mjs [--bucket <name>] [--dry-run] [--verify] [--force]
 *         (default bucket comes from infra/env.prod R2_BUCKET)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const BUCKET = process.argv.includes('--bucket')
	? process.argv[process.argv.indexOf('--bucket') + 1]
	: process.env.R2_BUCKET || INFRA.R2_BUCKET;
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const FORCE = process.argv.includes('--force');
// wrangler dev state root (apps/api/.wrangler/state)
const API_DIR = path.resolve(process.cwd().endsWith('apps/api') ? process.cwd() : path.join(process.cwd(), 'apps/api'));
const STORE = path.join(API_DIR, '.wrangler', 'state', 'v3');
const BLOBS_DIR = path.join(STORE, 'r2', BUCKET, 'blobs');
const OBJ_DB_DIR = path.join(STORE, 'r2', 'miniflare-R2BucketObject');
const BASE = 'https://api.cloudflare.com/client/v4';
const STATE_FILE = path.join(API_DIR, '.wrangler', `r2-push-state-${BUCKET}.json`);

/** wrangler binary — direct spawn skips npx resolution overhead. */
function wranglerBin() {
	const candidates = [path.join(API_DIR, 'node_modules/.bin/wrangler'), path.join(API_DIR, '..', '..', 'node_modules/.bin/wrangler')];
	return candidates.find((p) => fs.existsSync(p)) ?? 'npx';
}

/** List every object in the remote bucket via the Cloudflare REST API. */
async function listAllObjects(token) {
	const objects = [];
	let cursor;
	for (;;) {
		// R2 List Objects API: paginate with `per_page` (max 1000) + `result_info.cursor`.
		const url = new URL(`${BASE}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects`);
		url.searchParams.set('per_page', '1000');
		if (cursor) url.searchParams.set('cursor', cursor);
		const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
		if (res.status === 401) throw new Error('UNAUTHORIZED');
		const json = await res.json();
		if (!json.success) throw new Error(`Remote list failed: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
		objects.push(...(json.result ?? []));
		cursor = json.result_info?.cursor;
		if (!json.result_info?.is_truncated || !cursor) break;
	}
	return objects;
}

/** Read the bucket's objects from the miniflare store: a `_mf_objects` row
 * belongs to this bucket when its blob payload exists under
 * `r2/<bucket>/blobs/`. Checks every bucket database — no hardcoded hashes. */
function readLocalObjects() {
	if (!fs.existsSync(BLOBS_DIR)) {
		throw new Error(`No local R2 blobs at ${BLOBS_DIR} — upload something locally first (wrangler dev).`);
	}
	const blobNames = new Set(fs.readdirSync(BLOBS_DIR));
	const dbs = fs
		.readdirSync(OBJ_DB_DIR)
		.filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
		.map((f) => path.join(OBJ_DB_DIR, f));
	const found = new Map(); // key → {blobId, size, etag, uploaded, http, custom}
	for (const dbFile of dbs) {
		try {
			const db = new DatabaseSync(dbFile, { readOnly: true });
			const rows = db.prepare('SELECT key, blob_id, size, etag, uploaded, http_metadata, custom_metadata FROM _mf_objects').all();
			db.close();
			for (const r of rows) {
				if (r.blob_id && blobNames.has(r.blob_id) && !found.has(r.key)) {
					found.set(r.key, {
						blobId: r.blob_id,
						size: Number(r.size),
						etag: r.etag,
						uploaded: Number(r.uploaded),
						http: JSON.parse(r.http_metadata || '{}'),
						custom: JSON.parse(r.custom_metadata || '{}'),
					});
				}
			}
		} catch {
			// not a bucket database / locked — skip
		}
	}
	return found;
}

/** Upload one object to the remote bucket (wrangler r2 object put --remote). */
function runWranglerPut(key, blobPath, meta) {
	const bin = wranglerBin();
	const args = bin === 'npx' ? ['wrangler', 'r2', 'object', 'put'] : ['r2', 'object', 'put'];
	args.push(`${BUCKET}/${key}`, '--file', blobPath, '--remote', '-y');
	const http = meta.http ?? {};
	if (http.contentType) args.push('--content-type', String(http.contentType));
	if (http.cacheControl) args.push('--cache-control', String(http.cacheControl));
	if (http.contentLanguage) args.push('--content-language', String(http.contentLanguage));
	if (http.contentDisposition) args.push('--content-disposition', String(http.contentDisposition));
	if (http.contentEncoding) args.push('--content-encoding', String(http.contentEncoding));
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler put failed (${code}): ${out.slice(0, 500)}`))));
	});
}

function loadState() {
	if (FORCE) return {};
	try {
		return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
	} catch {
		return {};
	}
}

async function saveState(state) {
	await fs.promises.mkdir(path.dirname(STATE_FILE), { recursive: true });
	await fs.promises.writeFile(STATE_FILE, JSON.stringify(state));
}

async function main() {
	const local = readLocalObjects();
	console.log(`Local: ${local.size} object(s) in "${BUCKET}" (${BLOBS_DIR})`);

	if (VERIFY) {
		let token = await loadCfToken({ force: true });
		let remote;
		try {
			remote = await listAllObjects(token);
		} catch {
			console.log('   list failed — refreshing auth and retrying…');
			token = await loadCfToken({ force: true });
			remote = await listAllObjects(token);
		}
		const remoteMap = new Map(remote.map((o) => [o.key, o.size ?? -1]));
		let diff = 0;
		for (const [key, meta] of local) {
			const r = remoteMap.get(key);
			if (Number(r ?? -1) !== Number(meta.size)) {
				console.log(`  DIFF ${key}: local=${meta.size} remote=${r ?? 'MISSING'}`);
				diff++;
			}
		}
		for (const key of remoteMap.keys()) {
			if (!local.has(key)) {
				console.log(`  REMOTE-ONLY ${key} (push is additive — left untouched)`);
				diff++;
			}
		}
		console.log(diff === 0 ? '✅ local ↔ remote identical' : `⚠️ ${diff} differences`);
		process.exit(diff === 0 ? 0 : 1);
	}

	const state = loadState();
	const pending = [...local.entries()].filter(([key, meta]) => state[key] !== meta.size);
	console.log(`   ${pending.length} to push${Object.keys(state).length ? ` (${Object.keys(state).length} already done)` : ''}`);
	if (pending.length === 0) {
		console.log('✅ Nothing to do. (Use --force to re-push, or --verify to compare.)');
		return;
	}
	if (DRY_RUN) {
		for (const [key, meta] of pending) console.log(`   - ${key} (${meta.size} bytes, ${meta.http?.contentType ?? 'no content-type'})`);
		return;
	}

	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'r2push-'));
	let ok = 0;
	let failed = 0;
	const PUT_RETRIES = 4;
	const concurrency = 3;
	const queue = [...pending];
	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			const [key, meta] = next;
			const tmp = path.join(tmpDir, key.replace(/[^a-zA-Z0-9_.-]/g, '_'));
			try {
				await fs.promises.copyFile(path.join(BLOBS_DIR, meta.blobId), tmp);
				let lastErr;
				for (let attempt = 1; attempt <= PUT_RETRIES; attempt++) {
					try {
						await runWranglerPut(key, tmp, meta);
						lastErr = null;
						break;
					} catch (err) {
						lastErr = err;
						if (attempt < PUT_RETRIES) await new Promise((r) => setTimeout(r, 700 * attempt));
					}
				}
				if (lastErr) throw lastErr;
				state[key] = meta.size;
				await saveState(state);
				ok++;
				console.log(`   ✓ ${key}`);
			} catch (err) {
				failed++;
				console.error(`   ✗ ${key}: ${err.message}`);
			} finally {
				await fs.promises.rm(tmp, { force: true });
			}
		}
	});
	await Promise.all(workers);
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
	console.log(`\n✅ Done: ${ok} pushed, ${failed} failed.`);
	process.exit(failed ? 1 : 0);
}

main().catch((err) => {
	console.error(`❌ ${err.message}`);
	process.exit(1);
});
