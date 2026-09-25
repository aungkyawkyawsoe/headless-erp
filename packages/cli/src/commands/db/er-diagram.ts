import type { Command } from 'commander';
import pc from 'picocolors';
import * as fs from 'node:fs';
import { isConnectionError } from '../../utils/api.js';
import { apiFetch, startSpinner, stopSpinner } from './shared.js';

// ── ER Diagram ────────────────────────────────────────────────

/** Collection shape consumed by the ER-diagram generator. */
interface ErCollectionLike {
	name: string;
	slug: string;
	table_name?: string;
	fields?: Array<{ name: string; type: string; required?: boolean }>;
}

interface ErRelation {
	source: string;
	field: string;
	target: string;
	type: string;
}

function cardinalityMarker(relType: string, isSource: boolean): string {
	// Mermaid ER diagram markers
	// ||--o{ = one-to-many
	// }o--|| = many-to-one
	// ||--|| = one-to-one
	// }o--o{ = many-to-many
	switch (relType) {
		case 'm2o':
			return isSource ? '}o--||' : '||--o{';
		case 'o2m':
			return isSource ? '||--o{' : '}o--||';
		case 'm2m':
			return '}o--o{';
		default:
			return '||--o{';
	}
}

function relationLabel(relType: string): string {
	switch (relType) {
		case 'm2o':
			return '"belongs to"';
		case 'o2m':
			return '"has many"';
		case 'm2m':
			return '"many-to-many"';
		default:
			return '"related"';
	}
}

function mermaidSafeId(s: string): string {
	return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
}

async function generateErDiagram(options: { output?: string; format?: string; collections?: string }): Promise<void> {
	const outputFormat = options.format || 'mermaid';
	const filterSlugs = options.collections ? options.collections.split(',').map((s) => s.trim()) : [];

	const spinner = startSpinner('Fetching schema');

	let collections: ErCollectionLike[] = [];
	let relations: ErRelation[] = [];

	try {
		const resp = await apiFetch('/api/snapshot/export');
		const data = (resp.data ?? resp) as Record<string, unknown>;
		collections = (data.collections || data.entities || []) as ErCollectionLike[];
		relations = (data.relations || []) as ErRelation[];
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

	stopSpinner(spinner);

	// Filter collections if specified
	if (filterSlugs.length > 0) {
		const slugSet = new Set(filterSlugs);
		collections = collections.filter((c) => slugSet.has(c.slug));
		relations = relations.filter((r) => slugSet.has(r.source) && slugSet.has(r.target));
	}

	if (collections.length === 0) {
		console.log(pc.yellow('No collections found.'));
		return;
	}

	const slugSet = new Set(collections.map((c) => c.slug));
	const filteredRelations = relations.filter((r) => slugSet.has(r.source) && slugSet.has(r.target));

	if (outputFormat === 'json') {
		const output: {
			entities: Array<{
				name: string;
				slug: string;
				table_name?: string;
				fields: Array<{ name: string; type: string; required: boolean }>;
			}>;
			relations: ErRelation[];
		} = {
			entities: collections.map((c) => ({
				name: c.name,
				slug: c.slug,
				table_name: c.table_name,
				fields: (c.fields || []).map((f) => ({
					name: f.name,
					type: f.type,
					required: f.required || false,
				})),
			})),
			relations: filteredRelations,
		};
		const jsonOutput = JSON.stringify(output, null, 2);
		if (options.output) {
			fs.writeFileSync(options.output, jsonOutput, 'utf-8');
			console.log(pc.green(`✔ ER diagram (JSON) saved to ${options.output}`));
		} else {
			console.log(jsonOutput);
		}
		return;
	}

	if (outputFormat === 'ascii') {
		const lines: string[] = [];
		lines.push('');
		lines.push(pc.cyan('◆ ER Diagram (ASCII)'));
		lines.push('');

		for (const col of collections) {
			const fields = col.fields || [];
			const maxNameLen = Math.max('Column'.length, ...fields.map((f) => f.name.length));
			const maxTypeLen = Math.max('Type'.length, ...fields.map((f) => f.type.length));
			const totalWidth = maxNameLen + maxTypeLen + 5;

			lines.push(`  ┌${'─'.repeat(totalWidth)}┐`);
			lines.push(`  │ ${pc.bold(col.name.padEnd(totalWidth - 2))} │`);
			lines.push(`  ├${'─'.repeat(maxNameLen + 1)}┬${'─'.repeat(maxTypeLen + 1)}┤`);
			lines.push(`  │ ${'Column'.padEnd(maxNameLen)} │ ${'Type'.padEnd(maxTypeLen)} │`);
			lines.push(`  ├${'─'.repeat(maxNameLen + 1)}┼${'─'.repeat(maxTypeLen + 1)}┤`);
			for (const f of fields) {
				const rq = f.required ? '*' : ' ';
				lines.push(`  │ ${rq}${f.name.padEnd(maxNameLen - 1)} │ ${f.type.padEnd(maxTypeLen)} │`);
			}
			lines.push(`  └${'─'.repeat(maxNameLen + 1)}┴${'─'.repeat(maxTypeLen + 1)}┘`);
			lines.push('');
		}

		if (filteredRelations.length > 0) {
			lines.push(pc.cyan('  Relations:'));
			for (const r of filteredRelations) {
				lines.push(`    ${r.source}.${r.field} → ${r.target}  [${r.type}]`);
			}
			lines.push('');
		}

		const asciiOutput = lines.join('\n');
		if (options.output) {
			// Strip ANSI for file output
			fs.writeFileSync(options.output, asciiOutput.replace(/\x1b\[[0-9;]*m/g, ''), 'utf-8');
			console.log(pc.green(`✔ ER diagram (ASCII) saved to ${options.output}`));
		} else {
			console.log(asciiOutput);
		}
		return;
	}

	// Mermaid format
	const mermaidLines: string[] = [];
	mermaidLines.push('```mermaid');
	mermaidLines.push('erDiagram');

	const drawnRels = new Set<string>();

	for (const r of filteredRelations) {
		const key = [r.source, r.target].sort().join('|');
		if (drawnRels.has(key)) continue;
		drawnRels.add(key);

		const sourceId = mermaidSafeId(r.source);
		const targetId = mermaidSafeId(r.target);
		const marker = cardinalityMarker(r.type, true);
		const label = relationLabel(r.type);
		mermaidLines.push(`  ${sourceId} ${marker} ${targetId} : ${label}`);
	}

	// Definitions for each entity
	for (const col of collections) {
		const id = mermaidSafeId(col.slug);
		const fields = col.fields || [];
		mermaidLines.push(`  ${id} {`);
		for (const f of fields) {
			const type = f.type || 'string';
			mermaidLines.push(`    ${type} ${f.name}${f.required ? ' PK' : ''}`);
		}
		mermaidLines.push(`  }`);
	}

	mermaidLines.push('```');

	const mermaidOutput = mermaidLines.join('\n');

	if (options.output) {
		fs.writeFileSync(options.output, mermaidOutput, 'utf-8');
		console.log(pc.green(`✔ ER diagram saved to ${options.output}`));
		console.log(pc.dim(`  ${collections.length} entities, ${drawnRels.size} relations`));
	} else {
		console.log('');
		console.log(pc.cyan('◆ ER Diagram (Mermaid)'));
		console.log(pc.dim(`  ${collections.length} entities, ${drawnRels.size} relations`));
		console.log('');
		console.log(mermaidOutput);
	}
}

// ── Register Subcommands ──────────────────────────────────

export function registerErDiagramCommands(db: Command): void {
	// ── ER Diagram ─────────────────────────────────────

	db.command('er-diagram')
		.description('Generate Mermaid ER diagram from database schema')
		.option('--output <file>', 'Save to file (default: stdout)')
		.option('--format <type>', 'Output format: mermaid, ascii, or json', 'mermaid')
		.option('--collections <slugs>', 'Filter specific collections (comma-separated)')
		.action(async (options: { output?: string; format?: string; collections?: string }) => {
			try {
				await generateErDiagram(options);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
