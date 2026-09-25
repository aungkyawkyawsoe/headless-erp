import pc from 'picocolors';
import { spawnSync } from 'node:child_process';
import { getApiDir } from '../../utils/file.js';
import { guideSelect, isInteractive } from '../../utils/prompt.js';
import { baseUrl, token } from '../../utils/api.js';

// ── Shared types ─────────────────────────────────────────

/** A collection/entity as returned by the API (fields may be nested in schema_json). */
export interface EntityLike {
	name?: unknown;
	slug?: unknown;
	table_name?: unknown;
	updated_at?: unknown;
	fields?: unknown;
	schema?: { fields?: unknown };
	schema_json?: { fields?: unknown };
}

/** A field definition inside a schema — untyped JSON, access props via casts. */
export interface FieldLike {
	name?: string;
	type?: string;
	foreign_key?: string;
}

// ── Config ────────────────────────────────────────────────

// Resolve API base from the shared single source of truth (utils/api.ts).
export const API_BASE = baseUrl();

export async function apiFetch(path: string, init?: RequestInit): Promise<{ success: boolean; data?: unknown; error?: string }> {
	const bearer = await token();
	const resp = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${bearer}`,
			...(init?.body ? { 'Content-Type': 'application/json' } : {}),
			...(init?.headers as Record<string, string> | undefined),
		},
	});
	const body = (await resp.json().catch(() => ({}))) as { success: boolean; data?: unknown; error?: string };
	if (!resp.ok) {
		throw new Error(`API error ${resp.status}: ${body?.error || resp.statusText}`);
	}
	return body;
}

export async function apiPost(urlPath: string, body?: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
	const bearer = await token();
	const resp = await fetch(`${API_BASE}${urlPath}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${bearer}`,
			'Content-Type': 'application/json',
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const respBody = (await resp.json().catch(() => ({}))) as { success: boolean; data?: unknown; error?: string };
	if (!resp.ok) {
		throw new Error(`API error ${resp.status}: ${respBody?.error || resp.statusText}`);
	}
	return respBody;
}

export function wranglerD1(sql: string, remote = false): { results?: Array<{ columns: string[]; rows: unknown[][] }> } | null {
	const args = ['wrangler', 'd1', 'execute', 'DB', '--command', sql, '--json'];
	// Local dev targets the miniflare state that `wrangler dev` uses; pass
	// --remote to run against the deployed D1 database instead.
	if (!remote) args.push('--local');
	const result = spawnSync('npx', args, {
		cwd: getApiDir(),
		encoding: 'utf-8',
		timeout: 15000,
	});
	if (result.error) {
		console.error(pc.yellow('  wrangler not available — some stats may be missing'));
		return null;
	}
	try {
		const parsed = JSON.parse(result.stdout);
		// wrangler d1 execute --json returns an array of statement results:
		//   [{ results: [{col: val, ...}], success, meta }]
		const arr = Array.isArray(parsed) ? parsed : [parsed];
		const normalized = arr
			.filter((stmt: { success?: boolean }) => stmt && stmt.success !== false)
			.map((stmt: { success?: boolean; results?: Record<string, unknown>[] }) => {
				const rowsArr: Record<string, unknown>[] = stmt.results ?? [];
				const columns = rowsArr.length > 0 ? Object.keys(rowsArr[0]) : [];
				const rows = rowsArr.map((r) => columns.map((c) => r[c]));
				return { columns, rows };
			})
			.filter((s) => s.rows.length > 0);
		return normalized.length > 0 ? { results: normalized } : { results: [] };
	} catch {
		return null;
	}
}

export function formatRows(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
	return rows.map((row) => {
		const obj: Record<string, unknown> = {};
		columns.forEach((col, i) => {
			obj[col] = row[i];
		});
		return obj;
	});
}

export function formatDate(v: unknown): string {
	if (!v) return '-';
	const d = new Date(v as string | number | Date);
	return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── Guided pickers ────────────────────────────────────────

/** Fetch collection slugs (via API) and guide the user to pick one. */
export async function pickCollection(message = 'Which collection?'): Promise<string | null> {
	const resp = await apiFetch('/api/collections');
	const collections = (resp.data ?? []) as EntityLike[];
	if (collections.length === 0) {
		console.log(pc.yellow('  No collections found. Create one first: headless collection create <name> --template blog'));
		return null;
	}
	// Non-interactive: pick the first (deterministic), matching the documented CI behavior.
	if (!isInteractive()) {
		return String(collections[0].slug ?? collections[0].name ?? '');
	}
	const picked = await guideSelect(
		message,
		collections.map((c) => ({ value: String(c.slug ?? c.name ?? ''), label: String(c.name ?? c.slug ?? '') })),
	);
	return picked ?? null;
}

// ── Spinner & formatting helpers ─────────────────────────

export function startSpinner(text: string): ReturnType<typeof setInterval> {
	let dots = 0;
	const spinner = setInterval(() => {
		dots = (dots + 1) % 4;
		process.stdout.write(`\r  ${pc.cyan('⏳')} ${text}${'.'.repeat(dots)}   `);
	}, 300);
	return spinner;
}

export function stopSpinner(spinner: ReturnType<typeof setInterval>): void {
	clearInterval(spinner);
	process.stdout.write('\r\x1b[K');
}

export function fileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
