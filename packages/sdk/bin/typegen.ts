/**
 * mmbix-typegen — generate typed client code from the live API or a schema
 * JSON file:
 *
 *   --target ts   (default) `schema.ts` — TS types + Zod (single source of truth)
 *   --target dart           `schema.dart` — plain-Dart models + field constants
 *                           + ApiErrorCodes (for Flutter/Dart apps)
 *
 *   mmbix-typegen --url http://localhost:8788/api --token dev-token --out ./src/generated
 *   mmbix-typegen --schema schema.json --out ./src/generated
 *   mmbix-typegen --schema schema.json --out ./lib/generated --target dart
 */
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { API_ERROR_CODES } from '@mmbix/types';
import { fetchCollections, fetchErrorCodes, generateDartModels, generateTypes } from '../src/typegen/index.js';
import type { TypegenSourceMeta } from '../src/typegen/index.js';

const { values } = parseArgs({
	options: {
		url: { type: 'string' },
		token: { type: 'string' },
		schema: { type: 'string' },
		out: { type: 'string', default: './src/generated' },
		name: { type: 'string' },
		target: { type: 'string' },
		help: { type: 'boolean', short: 'h' },
	},
});

const target = (values.target ?? 'ts').toLowerCase();
if (target !== 'ts' && target !== 'dart') {
	console.error(pc.red(`Unknown --target "${values.target}" — use "ts" (default) or "dart".`));
	process.exit(1);
}
// Per-target default file name — regenerating a Dart package without --name
// must not write a `.ts` file full of Dart.
const outName = values.name ?? (target === 'dart' ? 'schema.dart' : 'schema.ts');

if (values.help) {
	console.log(`mmbix-typegen — generate typed client code from the Mmbix entity schema.

Usage:
  --schema <path>  Canonical schema JSON file (array of collections) — OFFLINE,
                   no API needed; records source-hash in the generated header
  --url <base>     API base URL, e.g. http://localhost:8788/api (live mode)
  --token <token>  Admin/dev token (prefer the MMBIX_TOKEN env var — it is not visible in process listings)
  --target <lang>  Output language: "ts" (default) | "dart"
                   ts   → schema.ts — TS types + Zod (single source of truth)
                   dart → schema.dart — plain-Dart models (fromJson/toJson) + field
                          constants for the F.* factories + ApiErrorCodes
                          (GET /api/meta in live mode; bundled catalog offline)
  --out <dir>      Output directory (default ./src/generated)
  --name <file>    Output file name (default schema.ts — schema.dart for dart)

Examples:
  mmbix-typegen --schema ./schema.source.json --out ./src/generated   # offline (CI-safe)
  mmbix-typegen --url http://localhost:8788/api --token dev-token
  MMBIX_TOKEN=… mmbix-typegen --url https://api.example.com/api
  mmbix-typegen --schema ./schema.json --out ./lib/generated --target dart`);
	process.exit(0);
}

// Prefer the env var (not visible in `ps`/shell history); --token stays for
// backward compatibility but is called out because it leaks via argv.
const token = values.token ?? process.env.MMBIX_TOKEN;
if (values.token) {
	console.warn(pc.yellow('Warning: --token is visible in process listings (e.g. `ps aux`) — prefer the MMBIX_TOKEN environment variable.'));
}

try {
	const collections = await fetchCollections({ url: values.url, token, schemaFile: values.schema });

	// Provenance is ALWAYS recorded so staleness is machine-detectable — not
	// just in offline mode. Offline runs hash the source file bytes; live runs
	// hash the fetched schema payload (the exact revision consumed), so the
	// generated header pins which schema it came from either way.
	let meta: TypegenSourceMeta;
	if (values.schema) {
		const resolved = path.resolve(values.schema);
		meta = { source: values.schema, sourceHash: createHash('sha256').update(readFileSync(resolved)).digest('hex') };
	} else {
		meta = { source: values.url ?? 'live API', sourceHash: createHash('sha256').update(JSON.stringify(collections)).digest('hex') };
	}
	if (collections.length === 0) {
		console.error(pc.red('No collections found — is the API reachable / schema file valid?'));
		process.exit(1);
	}
	// Dart mode also emits the canonical API error codes. Live mode reads them
	// from the deployment (/api/meta — what THIS server actually emits); offline
	// mode uses the bundled @mmbix/types catalog (the same constant /api/meta
	// serves — pinned by apps/api/test/contract.spec.ts). The fetch is fail-soft:
	// a codes section must never block model generation.
	let errorCodes: readonly string[] | undefined;
	if (target === 'dart') {
		const live = values.schema ? null : await fetchErrorCodes({ url: values.url, token });
		if (live && live.length > 0) {
			errorCodes = live;
			if (JSON.stringify(live) !== JSON.stringify([...API_ERROR_CODES])) {
				console.warn(
					pc.dim(`note: the server advertises a different error-code set than this CLI build — emitted the server's ${live.length}.`),
				);
			}
		} else {
			errorCodes = API_ERROR_CODES;
			if (!values.schema) console.warn(pc.dim('note: /api/meta was unreachable — emitted the bundled @mmbix/types error catalog.'));
		}
	}
	const { content, summary } = target === 'dart' ? generateDartModels(collections, { meta, errorCodes }) : generateTypes(collections, meta);
	const outDir = values.out!;
	const outFile = path.join(outDir, outName);
	mkdirSync(outDir, { recursive: true });
	// Idempotent: an unchanged schema must not churn the file (which would
	// dirty git, retrigger format gates, and defeat `--check`-style use).
	let unchanged = false;
	try {
		unchanged = readFileSync(outFile, 'utf-8') === content;
	} catch {
		/* file does not exist yet */
	}
	if (unchanged) {
		console.log(pc.dim(`= ${summary} (unchanged, ${outFile})`));
	} else {
		writeFileSync(outFile, content, 'utf-8');
		console.log(pc.green(`✓ ${summary}`));
		console.log(pc.dim(`  wrote ${outFile}`));
	}
} catch (err) {
	console.error(pc.red(`Typegen failed: ${err instanceof Error ? err.message : String(err)}`));
	process.exit(1);
}
