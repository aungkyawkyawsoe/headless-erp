/**
 * Sync remote R2 bucket → local wrangler dev state.
 *
 * Lists every object in the remote bucket via the Cloudflare REST API and writes
 * it into the LOCAL miniflare R2 store (`.wrangler/state/v3/r2/<bucket>/…`) using
 * `wrangler r2 object put --local`, so `wrangler dev` serves the same files as
 * production.
 *
 * Auth: uses CLOUDFLARE_API_TOKEN if set, otherwise the wrangler OAuth token
 * (read from the wrangler config file). The OAuth token expires — run any
 * wrangler command first (e.g. `npx wrangler whoami`) to refresh it if the list
 * starts 401ing.
 *
 * Resume: completed objects are recorded in `.wrangler/r2-sync-state-<bucket>.json`
 * (key → size); re-runs skip them, so an interrupted sync picks up where it left off.
 *
 * Usage:  node scripts/sync-r2-to-local.mjs [--bucket <name>] [--dry-run]
 *         (default bucket comes from infra/env.prod R2_BUCKET)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const BUCKET = process.argv.includes('--bucket')
	? process.argv[process.argv.indexOf('--bucket') + 1]
	: process.env.R2_BUCKET || INFRA.R2_BUCKET;
const DRY_RUN = process.argv.includes('--dry-run');
// wrangler dev state root (apps/api/.wrangler/state)
const API_DIR = path.resolve(process.cwd().endsWith('apps/api') ? process.cwd() : path.join(process.cwd(), 'apps/api'));
const BASE = 'https://api.cloudflare.com/client/v4';
const STATE_FILE = path.join(API_DIR, '.wrangler', `r2-sync-state-${BUCKET}.json`);

/** wrangler binary — direct spawn skips npx resolution overhead. */
function wranglerBin() {
	const candidates = [path.join(API_DIR, 'node_modules/.bin/wrangler'), path.join(API_DIR, '..', '..', 'node_modules/.bin/wrangler')];
	return candidates.find((p) => fs.existsSync(p)) ?? 'npx';
}

/** Live token (refreshed if the OAuth grant lapsed) — see scripts/lib/cf-token.mjs. */
async function getToken() {
	return loadCfToken();
}

async function listAllObjects(token) {
	const objects = [];
	let cursor;
	for (;;) {
		// R2 List Objects API: paginate with `per_page` (max 1000) + `result_info.cursor`/
		// `is_truncated`. The API ignores other param names and defaults to 20/page.
		const url = `${BASE}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
		const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
		const json = await res.json();
		const result = json.result ?? json;
		if (Array.isArray(result)) {
			objects.push(...result);
			const info = json.result_info;
			if (info?.is_truncated && info.cursor) {
				cursor = info.cursor;
				continue;
			}
			break;
		}
		objects.push(...(result.objects ?? []));
		if (!result.truncated || !result.cursor) break;
		cursor = result.cursor;
	}
	return objects;
}

/** Retry transient failures (flaky network + aggressive R2 REST rate limiting).
 *  401 → throw immediately: the OAuth token expired, callers refresh and retry.
 *  429 / 5xx → back off and retry (the account is limited to 1200 req / 5 min). */
async function fetchWithRetry(url, init) {
	let lastErr;
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			const res = await fetch(url, init);
			if (res.ok) return res;
			if (res.status === 401) throw new Error(`HTTP 401 (token expired — refresh)`);
			if (res.status === 429 || res.status >= 500) {
				lastErr = new Error(`HTTP ${res.status}`);
				const wait = 3000 * attempt;
				console.error(`   ⚠️ list retry ${attempt}/4 after HTTP ${res.status} (waiting ${wait / 1000}s)`);
				await new Promise((r) => setTimeout(r, wait));
				continue;
			}
			return res;
		} catch (err) {
			if (err.message?.startsWith('HTTP 401')) throw err;
			lastErr = err;
			await new Promise((r) => setTimeout(r, 3000 * attempt));
		}
	}
	throw lastErr;
}

async function downloadObject(auth, key, dest) {
	for (let attempt = 1; attempt <= 3; attempt++) {
		const url = `${BASE}/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
		const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });
		if (res.ok) {
			const buf = Buffer.from(await res.arrayBuffer());
			await fs.promises.writeFile(dest, buf);
			return {
				contentType: res.headers.get('content-type') ?? undefined,
				cacheControl: res.headers.get('cache-control') ?? undefined,
			};
		}
		if (res.status === 401 && attempt < 3) {
			console.error('   ⚠️ token expired mid-sync — refreshing…');
			auth.token = await loadCfToken({ force: true });
			continue;
		}
		throw new Error(`get object "${key}" failed: HTTP ${res.status} ${await res.text()}`);
	}
}

function runWranglerPut(key, file, meta) {
	const bin = wranglerBin();
	const args =
		bin === 'npx'
			? ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--local', '-f', file, '-y']
			: ['r2', 'object', 'put', `${BUCKET}/${key}`, '--local', '-f', file, '-y'];
	if (meta.contentType) args.push('--content-type', meta.contentType);
	if (meta.cacheControl) args.push('--cache-control', meta.cacheControl);
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { cwd: API_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler put failed (${code}): ${out.slice(0, 500)}`))));
	});
}

function loadState() {
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
	// Force a refresh so a long sync never starts on a token that is about to lapse.
	const auth = { token: await loadCfToken({ force: true }) };
	const state = loadState();
	console.log(`📦 Syncing R2 bucket "${BUCKET}" (account ${ACCOUNT}) → local (${API_DIR}/.wrangler/state)`);
	let objects;
	try {
		objects = await listAllObjects(auth.token);
	} catch {
		console.error('   ⚠️ list failed — refreshing auth and retrying…');
		auth.token = await loadCfToken({ force: true });
		objects = await listAllObjects(auth.token);
	}
	console.log(`   ${objects.length} remote object(s), ${Object.keys(state).length} already synced`);
	if (DRY_RUN) {
		for (const o of objects) console.log(`   - ${o.key} (${o.size} bytes)`);
		return;
	}

	const pending = objects.filter((o) => state[o.key] !== (o.size ?? -1));
	console.log(`   ${pending.length} to sync`);
	if (pending.length === 0) {
		console.log('✅ Nothing to do.');
		return;
	}

	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'r2sync-'));
	let ok = 0;
	let failed = 0;
	const skipped = objects.length - pending.length;
	// Modest parallelism: concurrent wrangler puts share one local miniflare
	// SQLite store; retries absorb the rare lock-contention failure.
	const concurrency = 3;
	const PUT_RETRIES = 4;
	const queue = [...pending];
	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		for (;;) {
			const obj = queue.shift();
			if (!obj) return;
			const tmp = path.join(tmpDir, obj.key.replace(/[^a-zA-Z0-9_.-]/g, '_'));
			try {
				const meta = await downloadObject(auth, obj.key, tmp);
				let lastErr;
				for (let attempt = 1; attempt <= PUT_RETRIES; attempt++) {
					try {
						await runWranglerPut(obj.key, tmp, meta);
						lastErr = null;
						break;
					} catch (err) {
						lastErr = err;
						if (attempt < PUT_RETRIES) await new Promise((r) => setTimeout(r, 700 * attempt));
					}
				}
				if (lastErr) throw lastErr;
				state[obj.key] = obj.size ?? -1;
				await saveState(state);
				ok++;
				console.log(`   ✓ ${obj.key}`);
			} catch (err) {
				failed++;
				console.error(`   ✗ ${obj.key}: ${err.message}`);
			} finally {
				await fs.promises.rm(tmp, { force: true });
			}
		}
	});
	await Promise.all(workers);
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
	console.log(`\n✅ Done: ${ok} synced (+${skipped} already done), ${failed} failed. Restart \`wrangler dev\` to pick them up.`);
	process.exit(failed ? 1 : 0);
}

main().catch((err) => {
	console.error(`❌ ${err.message}`);
	process.exit(1);
});
