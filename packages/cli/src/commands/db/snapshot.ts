import type { Command } from 'commander';
import pc from 'picocolors';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getApiDir } from '../../utils/file.js';
import { getFormatContext } from '../../utils/format.js';
import { isConnectionError } from '../../utils/api.js';
import { apiFetch, startSpinner, stopSpinner, type EntityLike, type FieldLike } from './shared.js';

// ── schemaDiff ───────────────────────────────────────────

async function schemaDiff(snapshotFile?: string): Promise<void> {
	const ctx = getFormatContext();

	// Fetch current schema from API
	const spinner = startSpinner('Computing diff');
	let current: Record<string, unknown>;
	try {
		const currentResp = await apiFetch('/api/snapshot/export');
		current = (currentResp.data ?? currentResp) as Record<string, unknown>;
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
		return;
	}

	// Load snapshot (from file or auto-detect)
	let snapshot: Record<string, unknown>;
	if (snapshotFile) {
		try {
			snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf-8'));
		} catch {
			stopSpinner(spinner);
			console.error(pc.red(`Cannot read snapshot file: ${snapshotFile}`));
			process.exitCode = 1;
			return;
		}
	} else {
		// Auto-detect last saved snapshot in api dir
		const apiDir = getApiDir();
		let snapshotFiles: string[] = [];
		try {
			snapshotFiles = fs
				.readdirSync(apiDir)
				.filter((f) => f.startsWith('snapshot-') && f.endsWith('.json'))
				.sort()
				.reverse();
		} catch {
			/* no files */
		}
		if (snapshotFiles.length > 0) {
			snapshot = JSON.parse(fs.readFileSync(path.join(apiDir, snapshotFiles[0]), 'utf-8'));
		} else {
			stopSpinner(spinner);
			console.error(pc.red('No snapshot file found and no file specified.'));
			console.log(pc.dim('  Run "db schema:export" first to create a snapshot, or specify a file.'));
			process.exitCode = 1;
			return;
		}
	}

	stopSpinner(spinner);

	// Normalize entities from current and snapshot
	const currentEntities: Array<{ name: string; slug: string; fields: unknown[] }> = (
		(current.entities || current.schemas || current.collections || []) as unknown[]
	).map((e) => {
		const ent = e as EntityLike;
		return {
			name: (ent.name || ent.slug || '') as string,
			slug: (ent.slug || ent.name || '') as string,
			fields: (ent.fields || ent.schema?.fields || ent.schema_json?.fields || []) as unknown[],
		};
	});

	const snapshotEntities: Array<{ name: string; slug: string; fields: unknown[] }> = (
		(snapshot.entities || snapshot.schemas || snapshot.collections || []) as unknown[]
	).map((e) => {
		const ent = e as EntityLike;
		return {
			name: (ent.name || ent.slug || '') as string,
			slug: (ent.slug || ent.name || '') as string,
			fields: (ent.fields || ent.schema?.fields || ent.schema_json?.fields || []) as unknown[],
		};
	});

	const currentSlugs = new Set(currentEntities.map((e) => e.slug));
	const snapshotSlugs = new Set(snapshotEntities.map((e) => e.slug));

	const added = currentEntities.filter((e) => !snapshotSlugs.has(e.slug));
	const removed = snapshotEntities.filter((e) => !currentSlugs.has(e.slug));

	// Compute modified (field-level changes)
	const modified: Array<{
		slug: string;
		name: string;
		added: string[];
		removed: string[];
		changed: string[];
	}> = [];

	for (const curr of currentEntities) {
		const snap = snapshotEntities.find((s) => s.slug === curr.slug);
		if (!snap) continue;

		const currFieldNames = new Set((curr.fields || []).map((f) => (f as FieldLike).name));
		const snapFieldNames = new Set((snap.fields || []).map((f) => (f as FieldLike).name));

		const fieldsAdded = (curr.fields || [])
			.filter((f) => !snapFieldNames.has((f as FieldLike).name))
			.map((f) => (f as FieldLike).name as string);

		const fieldsRemoved = (snap.fields || [])
			.filter((f) => !currFieldNames.has((f as FieldLike).name))
			.map((f) => (f as FieldLike).name as string);

		// Fields with same name but different type
		const fieldsChanged: string[] = [];
		for (const cfRaw of curr.fields || []) {
			const cf = cfRaw as FieldLike;
			const sf = (snap.fields || []).find((f) => (f as FieldLike).name === cf.name);
			if (sf && cf.type !== (sf as FieldLike).type) {
				fieldsChanged.push(`${cf.name}: ${(sf as FieldLike).type} → ${cf.type}`);
			}
		}

		if (fieldsAdded.length > 0 || fieldsRemoved.length > 0 || fieldsChanged.length > 0) {
			modified.push({
				slug: curr.slug,
				name: curr.name,
				added: fieldsAdded,
				removed: fieldsRemoved,
				changed: fieldsChanged,
			});
		}
	}

	const hasChanges = added.length > 0 || removed.length > 0 || modified.length > 0;

	if (ctx.json) {
		console.log(
			JSON.stringify(
				{
					has_changes: hasChanges,
					added: added.map((e) => e.slug),
					removed: removed.map((e) => e.slug),
					modified,
				},
				null,
				2,
			),
		);
		return;
	}

	if (!hasChanges) {
		console.log(pc.green('✔ No changes detected — schema is in sync.'));
		console.log('');
		return;
	}

	console.log(pc.cyan('\n◆ Schema Diff\n'));

	// Added collections: green
	if (added.length > 0) {
		console.log(pc.green('  + Added collections:'));
		for (const e of added) {
			console.log(pc.green(`    + ${e.name} (${e.slug})`));
		}
		console.log('');
	}

	// Removed collections: red bold (breaking)
	if (removed.length > 0) {
		console.log(pc.bold(pc.red('  - Removed collections (BREAKING):')));
		for (const e of removed) {
			console.log(pc.bold(pc.red(`    - ${e.name} (${e.slug})`)));
		}
		console.log('');
	}

	// Modified collections: yellow
	if (modified.length > 0) {
		console.log(pc.yellow('  ~ Modified collections:'));
		for (const m of modified) {
			console.log(pc.yellow(`    ~ ${m.name} (${m.slug})`));
			for (const fa of m.added) {
				console.log(pc.green(`      + ${fa}`));
			}
			for (const fr of m.removed) {
				console.log(pc.bold(pc.red(`      - ${fr}`)));
			}
			for (const fc of m.changed) {
				console.log(pc.yellow(`      ~ ${fc}`));
			}
		}
		console.log('');
	}

	console.log(
		pc.dim(
			`  ${currentEntities.length} collections total | ${added.length} added | ${removed.length} removed | ${modified.length} modified`,
		),
	);
	console.log('');
}

// ── exportSchema ─────────────────────────────────────────

async function exportSchema(outputFile?: string): Promise<void> {
	const spinner = startSpinner('Exporting schema');

	try {
		const resp = await apiFetch('/api/snapshot/export');
		const schema = (resp.data ?? resp) as Record<string, unknown>;

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const filename = outputFile || `snapshot-${timestamp}.json`;
		const content = JSON.stringify(schema, null, 2);
		fs.writeFileSync(filename, content, 'utf-8');

		const entities = (schema.entities || schema.schemas || schema.collections || []) as unknown[];
		const relations = (schema.relations || []) as unknown[];

		stopSpinner(spinner);

		console.log(pc.green('✔ Schema exported!'));
		console.log('');
		console.log(`  ${pc.bold('File:')}        ${filename}`);
		console.log(`  ${pc.bold('Collections:')} ${entities.length}`);
		console.log(`  ${pc.bold('Relations:')}  ${relations.length}`);
		console.log('');
	} catch (err) {
		stopSpinner(spinner);
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── Register Subcommands ──────────────────────────────────

export function registerSnapshotCommands(db: Command): void {
	// ── Schema Export / Diff ────────────────────────────

	db.command('schema:export')
		.description('Export current DB schema to a JSON snapshot file')
		.argument('[file]', 'Output filename (default: snapshot-<timestamp>.json)')
		.action(async (file?: string) => {
			try {
				await exportSchema(file);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	db.command('diff')
		.description('Compare current DB schema vs saved snapshot (colored output)')
		.argument('[snapshot-file]', 'Path to snapshot JSON file (auto-detects latest if omitted)')
		.action(async (snapshotFile?: string) => {
			try {
				await schemaDiff(snapshotFile);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
