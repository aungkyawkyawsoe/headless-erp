/**
 * mmbix-typegen — generate `schema.ts` (types + Zod) from the live API or a
 * schema JSON file.
 *
 *   mmbix-typegen --url http://localhost:8788/api --token dev-token --out ./src/generated
 *   mmbix-typegen --schema schema.json --out ./src/generated
 */
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { fetchCollections, generateTypes } from '../src/typegen/index.js';
import type { TypegenSourceMeta } from '../src/typegen/index.js';

const { values } = parseArgs({
	options: {
		url: { type: 'string' },
		token: { type: 'string' },
		schema: { type: 'string' },
		out: { type: 'string', default: './src/generated' },
		name: { type: 'string', default: 'schema.ts' },
		help: { type: 'boolean', short: 'h' },
	},
});

if (values.help) {
	console.log(`mmbix-typegen — generate typed schema (TS types + Zod) from the Mmbix entity schema.

Usage:
  --schema <path>  Canonical schema JSON file (array of collections) — OFFLINE,
                   no API needed; records source-hash in the generated header
  --url <base>     API base URL, e.g. http://localhost:8788/api (live mode)
  --token <token>  Admin/dev token (prefer the MMBIX_TOKEN env var — it is not visible in process listings)
  --out <dir>      Output directory (default ./src/generated)
  --name <file>    Output file name (default schema.ts)

Examples:
  mmbix-typegen --schema ./schema.source.json --out ./src/generated   # offline (CI-safe)
  mmbix-typegen --url http://localhost:8788/api --token dev-token
  MMBIX_TOKEN=… mmbix-typegen --url https://api.example.com/api
  mmbix-typegen --schema ./schema.json --out ./src/generated`);
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

	// Offline runs record provenance (source path + SHA-256 of the source bytes)
	// in the generated header so staleness is machine-detectable.
	let meta: TypegenSourceMeta | undefined;
	if (values.schema) {
		const resolved = path.resolve(values.schema);
		meta = {
			source: values.schema,
			sourceHash: createHash('sha256').update(readFileSync(resolved)).digest('hex'),
		};
	}
	if (collections.length === 0) {
		console.error(pc.red('No collections found — is the API reachable / schema file valid?'));
		process.exit(1);
	}
	const { content, summary } = generateTypes(collections, meta);
	const outDir = values.out!;
	const outFile = path.join(outDir, values.name!);
	mkdirSync(outDir, { recursive: true });
	writeFileSync(outFile, content, 'utf-8');
	console.log(pc.green(`✓ ${summary}`));
	console.log(pc.dim(`  wrote ${outFile}`));
} catch (err) {
	console.error(pc.red(`Typegen failed: ${err instanceof Error ? err.message : String(err)}`));
	process.exit(1);
}
