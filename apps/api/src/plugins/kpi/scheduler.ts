/**
 * KPI materialization scheduler — called from the worker's scheduled handler
 * (cron 30 3 * * *). Recomputes every enabled KPI with schedule='daily' so
 * dashboards always read fresh materialized values.
 */

import { D1Client } from '@mmbix/core';
import { KpiService } from './service';

export async function runKpiMaterialization(env: Record<string, unknown>): Promise<{ computed: number; failed: number; errors: string[] }> {
	const db = new D1Client(env.DB as D1Database);
	const svc = new KpiService(db);
	const all = await svc.list();
	const due = all.filter((k) => k.enabled === 1 && k.definition.schedule === 'daily');
	let computed = 0;
	let failed = 0;
	const errors: string[] = [];
	for (const kpi of due) {
		try {
			await svc.compute(kpi);
			computed++;
		} catch (err) {
			failed++;
			errors.push(`${kpi.name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	return { computed, failed, errors };
}
