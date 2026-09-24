/**
 * FlagService — tenant-scoped feature flags with percentage rollouts (D1).
 *
 *   flags.set('checkout.v2', { tenant: 'acme', enabled: true, rolloutPct: 25 })
 *   flags.evaluate('checkout.v2', { tenant: 'acme' }) → { enabled, config }
 *
 * Lookup order: exact (key, tenant) → global (key, ''). Rollouts are stable
 * per (seed, key) — a tenant never flips in and out mid-window.
 */

import { D1Client } from '@mmbix/core';

export interface FlagSetInput {
	key: string;
	/** Tenant scope — omit or '' for a global flag. */
	tenant?: string;
	enabled?: boolean;
	/** 0-100 — percentage of (seed, key) hashes that get the flag. */
	rolloutPct?: number;
	/** Arbitrary JSON config delivered with the evaluation. */
	config?: unknown;
}

export interface FlagEntry {
	key: string;
	tenant: string;
	enabled: number;
	rollout_pct: number;
	config_json: string | null;
	updated_at: string;
}

export interface FlagEvaluation {
	enabled: boolean;
	config: unknown;
}

const TABLE = `CREATE TABLE IF NOT EXISTS _feature_flags (key TEXT NOT NULL, tenant TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, rollout_pct INTEGER NOT NULL DEFAULT 100, config_json TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (key, tenant))`;

/** FNV-1a 32-bit — stable, cheap, dependency-free hash for rollouts. */
export function fnv1a(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export class FlagService {
	constructor(private readonly db: D1Client) {}

	async set(input: FlagSetInput): Promise<FlagEntry> {
		const key = input.key.trim();
		const tenant = (input.tenant ?? '').trim();
		if (!key) throw new Error('flag key is required');
		const rolloutPct = Math.min(Math.max(0, input.rolloutPct ?? 100), 100);
		await this.ensure();
		await this.db.run({
			sql: `INSERT INTO _feature_flags (key, tenant, enabled, rollout_pct, config_json, updated_at)
				VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT(key, tenant) DO UPDATE SET
					enabled = excluded.enabled, rollout_pct = excluded.rollout_pct,
					config_json = excluded.config_json, updated_at = excluded.updated_at`,
			bindings: [
				key,
				tenant,
				input.enabled === false ? 0 : 1,
				rolloutPct,
				input.config === undefined ? null : JSON.stringify(input.config),
				new Date().toISOString(),
			],
		});
		return (await this.get(key, tenant)) as FlagEntry;
	}

	async get(key: string, tenant?: string): Promise<FlagEntry | null> {
		await this.ensure();
		return this.db.first<FlagEntry>({
			sql: `SELECT * FROM _feature_flags WHERE key = ? AND tenant = ?`,
			bindings: [key.trim(), (tenant ?? '').trim()],
		});
	}

	/** Evaluate with tenant → global fallback and rollout hashing. */
	async evaluate(
		key: string,
		ctx: { tenant?: string; seed?: string } = {},
		defaults: { enabled?: boolean; config?: unknown } = {},
	): Promise<FlagEvaluation> {
		const tenant = (ctx.tenant ?? '').trim();
		const row = (await this.get(key, tenant)) ?? (await this.get(key, ''));
		if (!row) return { enabled: defaults.enabled ?? false, config: defaults.config ?? null };

		const pct = Number(row.rollout_pct ?? 100);
		const inRollout = pct >= 100 || fnv1a(`${ctx.seed ?? tenant}:${key}`) % 100 < pct;
		return {
			enabled: row.enabled === 1 && inRollout,
			config: row.config_json ? JSON.parse(row.config_json) : null,
		};
	}

	async list(tenant?: string): Promise<FlagEntry[]> {
		await this.ensure();
		return this.db.all<FlagEntry>({
			sql: tenant?.trim()
				? `SELECT * FROM _feature_flags WHERE tenant = ? ORDER BY key`
				: `SELECT * FROM _feature_flags ORDER BY tenant, key`,
			bindings: tenant?.trim() ? [tenant.trim()] : [],
		});
	}

	async remove(key: string, tenant?: string): Promise<boolean> {
		const result = await this.db.run({
			sql: `DELETE FROM _feature_flags WHERE key = ? AND tenant = ?`,
			bindings: [key.trim(), (tenant ?? '').trim()],
		});
		return (result.meta?.changes ?? 0) > 0;
	}

	private async ensure(): Promise<void> {
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__FLAGS_TABLE__) return;
		await this.db.exec(TABLE);
		g.__FLAGS_TABLE__ = true;
	}
}
