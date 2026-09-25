import type { Command } from 'commander';
import pc from 'picocolors';
import * as fs from 'node:fs';
import { getFormatContext } from '../../utils/format.js';
import { isConnectionError } from '../../utils/api.js';
import { apiFetch, type EntityLike, type FieldLike } from './shared.js';

// ── Watch Mode ─────────────────────────────────────────────────

async function watchSchema(options: { snapshot?: string; interval?: string; once?: boolean }): Promise<void> {
	const ctx = getFormatContext();
	const intervalSec = parseInt(options.interval || '10', 10);
	const once = options.once || false;

	// Load snapshot if provided
	let snapshotEntities: Array<{ slug: string; name: string; fields: unknown[] }> = [];
	if (options.snapshot) {
		try {
			const raw = JSON.parse(fs.readFileSync(options.snapshot, 'utf-8'));
			snapshotEntities = (raw.entities || raw.schemas || raw.collections || []).map((e: EntityLike) => ({
				slug: (e.slug || e.name || '') as string,
				name: (e.name || e.slug || '') as string,
				fields: (e.fields || e.schema?.fields || e.schema_json?.fields || []) as unknown[],
			}));
		} catch {
			console.error(pc.red(`Cannot read snapshot file: ${options.snapshot}`));
			process.exit(1);
		}
	}

	// Fetch helper
	const fetchCollections = async (): Promise<Array<{ slug: string; name: string; fields: unknown[] }>> => {
		const resp = await apiFetch('/api/entities');
		const collections: unknown[] = (resp.data ?? []) as unknown[];
		return collections.map((c) => {
			const ent = c as EntityLike;
			return {
				slug: ent.slug as string,
				name: ent.name as string,
				fields: (ent.fields || ent.schema?.fields || ent.schema_json?.fields || []) as unknown[],
			};
		});
	};

	// Diff helper
	const computeDiff = (
		current: Array<{ slug: string; name: string; fields: unknown[] }>,
		snapshot: Array<{ slug: string; name: string; fields: unknown[] }>,
	) => {
		const curSlugs = new Set(current.map((e) => e.slug));
		const snapSlugs = new Set(snapshot.map((e) => e.slug));
		const added = current.filter((e) => !snapSlugs.has(e.slug));
		const removed = snapshot.filter((e) => !curSlugs.has(e.slug));
		const modified: Array<{ slug: string; name: string; added: string[]; removed: string[]; changed: string[] }> = [];
		for (const cur of current) {
			const snap = snapshot.find((s) => s.slug === cur.slug);
			if (!snap) continue;
			const curFields = new Set(cur.fields.map((f) => (f as FieldLike).name));
			const snapFields = new Set(snap.fields.map((f) => (f as FieldLike).name));
			const fa = cur.fields.filter((f) => !snapFields.has((f as FieldLike).name)).map((f) => (f as FieldLike).name as string);
			const fr = snap.fields.filter((f) => !curFields.has((f as FieldLike).name)).map((f) => (f as FieldLike).name as string);
			const fc: string[] = [];
			for (const cfRaw of cur.fields) {
				const cf = cfRaw as FieldLike;
				const sf = snap.fields.find((f) => (f as FieldLike).name === cf.name);
				if (sf && cf.type !== (sf as FieldLike).type) fc.push(`${cf.name}: ${(sf as FieldLike).type} → ${cf.type}`);
			}
			if (fa.length || fr.length || fc.length) modified.push({ slug: cur.slug, name: cur.name, added: fa, removed: fr, changed: fc });
		}
		return { added, removed, modified };
	};

	let previousState = snapshotEntities.length > 0 ? snapshotEntities : await fetchCollections();

	const check = async () => {
		try {
			const current = await fetchCollections();
			const diff = computeDiff(current, previousState);
			const hasChange = diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0;

			const ts = new Date().toLocaleTimeString();

			if (ctx.json) {
				console.log(JSON.stringify({ timestamp: new Date().toISOString(), changed: hasChange, ...diff }, null, 2));
			} else if (hasChange) {
				console.log(pc.yellow(`\n[${ts}] ⚠ Schema drift detected!`));
				for (const a of diff.added) console.log(pc.green(`  + ${a.name} (${a.slug})`));
				for (const r of diff.removed) console.log(pc.bold(pc.red(`  - ${r.name} (${r.slug})`)));
				for (const m of diff.modified) {
					console.log(pc.yellow(`  ~ ${m.name} (${m.slug})`));
					for (const fa of m.added) console.log(pc.green(`    + ${fa}`));
					for (const fr of m.removed) console.log(pc.bold(pc.red(`    - ${fr}`)));
					for (const fc of m.changed) console.log(pc.yellow(`    ~ ${fc}`));
				}
			} else {
				console.log(pc.green(`[${ts}] ✔ In sync — ${current.length} collections`));
			}

			previousState = current;
		} catch (err) {
			if (isConnectionError(err)) {
				console.log(pc.yellow(`[${new Date().toLocaleTimeString()}] ⚠ Connection lost — retrying...`));
			} else {
				console.error(pc.red(`[${new Date().toLocaleTimeString()}] Error: ${String(err)}`));
			}
		}
	};

	// First check
	await check();

	if (once) {
		process.exit(0);
	}

	// Watch loop
	const spinner: ReturnType<typeof setInterval> | null = null;
	console.log(pc.dim(`\nWatching for schema changes every ${intervalSec}s (Ctrl+C to stop)\n`));

	const timer = setInterval(check, intervalSec * 1000);

	const cleanup = () => {
		clearInterval(timer);
		if (spinner) clearInterval(spinner);
		console.log(pc.dim('\nWatch stopped.'));
		process.exit(0);
	};

	process.on('SIGINT', cleanup);
	process.on('SIGTERM', cleanup);
}

// ── Register Subcommands ──────────────────────────────────

export function registerWatchCommand(db: Command): void {
	// ── Watch Mode ──────────────────────────────────────

	db.command('watch')
		.description('Watch schema for changes and auto-detect drift')
		.option('--interval <seconds>', 'Polling interval in seconds', '10')
		.option('--snapshot <file>', 'Compare against a specific snapshot file')
		.option('--once', 'Check once and exit (for CI/CD)')
		.action(async (options: { interval?: string; snapshot?: string; once?: boolean }) => {
			try {
				await watchSchema(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
