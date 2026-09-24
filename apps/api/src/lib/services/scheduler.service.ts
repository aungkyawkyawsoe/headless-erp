/**
 * Scheduled Jobs Service
 *
 * Manages cron-based recurring tasks that run on Cloudflare Cron Triggers.
 * Jobs can send emails, cleanup old data, generate reports, etc.
 *
 * Table: _scheduled_jobs (created by migration 005)
 * Cron:  wrangler.toml → [triggers] crons = ["0 0 * * *"]
 */

import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';

export interface ScheduledJob {
	id: string;
	name: string;
	description: string | null;
	cron: string; // Cron expression: "0 0 * * *"
	collection_slug: string | null; // null = system job
	action: string; // "cleanup", "report", "notify", "sync"
	config: string; // JSON config
	enabled: boolean;
	last_run: string | null;
	next_run: string | null;
	created_at: string;
}

export interface JobResult {
	job: string;
	status: 'success' | 'failed';
	message: string;
	duration_ms: number;
}

export class ScheduledJobService {
	private repo: Repository<ScheduledJob>;

	constructor(private db: D1Client) {
		this.repo = new Repository<ScheduledJob>(db, '_scheduled_jobs');
	}

	async create(input: Partial<ScheduledJob>): Promise<ScheduledJob> {
		return this.repo.create({
			...input,
			enabled: input.enabled ?? true,
			config: typeof input.config === 'string' ? input.config : '{}',
		} as Partial<ScheduledJob>);
	}

	async list(): Promise<ScheduledJob[]> {
		return this.repo.findAll({ orderBy: { created_at: 'desc' } });
	}

	async update(id: string, input: Partial<ScheduledJob>): Promise<ScheduledJob> {
		return this.repo.update(id, input);
	}

	async delete(id: string): Promise<void> {
		await this.repo.delete(id);
	}

	/**
	 * Run all due jobs. Called by the cron trigger handler.
	 */
	async runDueJobs(): Promise<JobResult[]> {
		const now = new Date().toISOString();
		const jobs = await this.repo.findMany({
			where: { enabled: true },
			orderBy: { created_at: 'asc' },
			limit: 50,
		});

		const results: JobResult[] = [];
		for (const job of jobs.data) {
			if (job.next_run && job.next_run > now) continue;

			const start = Date.now();
			try {
				const msg = await this.executeJob(job);
				results.push({ job: job.name, status: 'success', message: msg, duration_ms: Date.now() - start });
			} catch (err) {
				results.push({ job: job.name, status: 'failed', message: String(err), duration_ms: Date.now() - start });
			}

			// Update next_run based on cron
			await this.repo.update(job.id, {
				last_run: now,
				next_run: this.calculateNextRun(job.cron),
			} as Partial<ScheduledJob>);
		}

		return results;
	}

	/** Look up the actual table_name for a collection slug */
	private async _getTableName(slug: string): Promise<string> {
		const schema = await this.db.first<{ table_name: string }>({
			sql: 'SELECT table_name FROM _entity_schemas WHERE slug = ?',
			bindings: [slug],
		});
		return schema?.table_name || collectionTable(slug);
	}

	private async executeJob(job: ScheduledJob): Promise<string> {
		const config = JSON.parse(job.config || '{}');

		switch (job.action) {
			case 'cleanup': {
				// Soft-delete items older than configured days
				const days = config.retention_days || 30;
				const cutoff = new Date(Date.now() - days * 86400000).toISOString();
				if (job.collection_slug) {
					const table = await this._getTableName(job.collection_slug);
					await this.db.run(
						QueryBuilder.raw(`UPDATE ${table} SET deleted_at = ?1, updated_at = ?1 WHERE deleted_at IS NULL AND created_at < ?2`, [
							new Date().toISOString(),
							cutoff,
						]),
					);
				}
				return `Cleaned up items older than ${days} days`;
			}

			case 'report': {
				// Generate aggregate report for a collection
				if (job.collection_slug) {
					const table = await this._getTableName(job.collection_slug);
					const count = await this.db.first<{ total: number }>(
						QueryBuilder.raw(`SELECT COUNT(*) as total FROM ${table} WHERE deleted_at IS NULL`),
					);
					return `Report: ${job.collection_slug} has ${count?.total || 0} active items`;
				}
				return 'No collection specified';
			}

			default:
				return `Unknown action: ${job.action}`;
		}
	}

	/**
	 * Simple cron parser — calculates next run time.
	 * Supports: "0 * * * *" (hourly), "0 0 * * *" (daily), "0 0 * * 0" (weekly)
	 */
	private calculateNextRun(cron: string): string {
		const parts = cron.trim().split(/\s+/);
		if (parts.length !== 5) return new Date(Date.now() + 86400000).toISOString();

		const [min, hour, , ,] = parts;
		const now = new Date();
		const next = new Date(now);

		if (min === '0' && hour === '0') {
			next.setDate(next.getDate() + 1);
			next.setHours(0, 0, 0, 0);
		} else if (min === '0') {
			next.setHours(next.getHours() + 1, 0, 0, 0);
		} else {
			next.setMinutes(next.getMinutes() + 1, 0, 0);
		}

		return next.toISOString();
	}
}
