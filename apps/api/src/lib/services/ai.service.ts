/**
 * AI Service — prompt → block JSON metadata generation.
 *
 * The AI NEVER emits code. It emits block-tree JSON that maps directly onto
 * the shared block registry (@mmbix/ui-views), which the existing BlockView
 * runtime renders. This is the "AI-to-metadata" pipeline: no compiler, no
 * eval, no raw source code — workerd-safe by construction.
 *
 * Providers (env-switched):
 *   - workers-ai   → env.AI.run('@cf/...')  (no external key)
 *   - openai       → AI_API_URL + AI_API_KEY (OpenAI-compatible chat completions)
 *   - mock         → deterministic response for tests / offline dev
 */

import { BLOCK_REGISTRY } from '@mmbix/ui-views/block-registry';

export type AIProviderName = 'workers-ai' | 'openai' | 'mock';

export interface AIEnv {
	AI?: {
		run(model: string, input: unknown): Promise<unknown>;
	};
	AI_PROVIDER?: string;
	AI_MODEL?: string;
	AI_API_URL?: string;
	AI_API_KEY?: string;
}

export interface AIResult {
	/** Parsed block JSON (already validated against the registry). */
	blocks: Array<Record<string, unknown>>;
	/** Raw LLM text (before parsing) — useful for debugging/audit. */
	raw: string;
	warnings?: string[];
}

const DEFAULT_MODEL = '@cf/meta/llama-4-maverick-17b-128e-instruct-fp8';

/** Compact registry context — the ONLY component vocabulary the AI may use. */
function registryContext(): string {
	const groups = new Map<string, string[]>();
	for (const r of BLOCK_REGISTRY) {
		const list = groups.get(r.group) ?? [];
		list.push(`${r.type} (${r.label})`);
		groups.set(r.group, list);
	}
	const lines = [...groups.entries()].map(([g, types]) => `  ${g}: ${types.join(', ')}`);
	return lines.join('\n');
}

/** System prompt that constrains the LLM to valid block JSON. */
export function buildSystemPrompt(): string {
	return [
		'You are an expert enterprise UX architect for a headless CMS page builder.',
		'Your job is to transform user business requirements into a valid page block tree.',
		'',
		'AVAILABLE BLOCK TYPES (use ONLY these):',
		registryContext(),
		'',
		'BLOCK JSON SHAPE:',
		'[',
		'  {',
		'    "type": "<one of the block types above>",',
		'    "label": "human-readable name",',
		'    "layout": { "order": 0, "colSpan": 4 },',
		'    "config": { <block-specific props — use common sense keys like title, content, collection, label, text, placeholder> },',
		'    "children": [ <nested blocks for containers: row, column, tabs, accordion, grid, card> ]',
		'  }',
		']',
		'',
		'RULES:',
		'1. Respond with RAW JSON only. No markdown fences, no explanations, no code blocks.',
		'2. Only use block types from the AVAILABLE list above.',
		'3. Layout blocks: use row/column/grid for structure, card to group content.',
		'4. Data blocks (list, table, kpi, chart) take a "collection" prop in config.',
		'5. colSpan must be 1-4 (4 = full width).',
		'6. Never output code, scripts, or HTML — text goes in config content/text/label fields.',
		'7. A dashboard typically starts with a row of KPI cards, then a table or chart.',
	].join('\n');
}

/** Strip markdown fences and surrounding noise, then parse JSON. */
export function parseAIBlocks(raw: string): Array<Record<string, unknown>> {
	let text = raw.trim();
	// Strip ```json ... ``` fences
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) text = fence[1].trim();
	// Find first [ ... ] array
	const start = text.indexOf('[');
	const end = text.lastIndexOf(']');
	if (start >= 0 && end > start) {
		text = text.slice(start, end + 1);
	}
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
		if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { blocks?: unknown }).blocks)) {
			return (parsed as { blocks: Array<Record<string, unknown>> }).blocks;
		}
	} catch {
		/* fall through */
	}
	throw new Error('AI returned non-JSON output');
}

/** Validate AI output against the registry — reject unknown types. */
export function validateAIBlocks(blocks: Array<Record<string, unknown>>): { valid: boolean; warnings: string[] } {
	const allowed = new Set(BLOCK_REGISTRY.map((r) => r.type));
	const warnings: string[] = [];
	const walk = (list: Array<Record<string, unknown>>) => {
		for (const b of list) {
			const type = String(b.type ?? '');
			if (!allowed.has(type)) {
				warnings.push(`Unknown block type "${type}" dropped`);
				continue;
			}
			const children = b.children as Array<Record<string, unknown>> | undefined;
			if (Array.isArray(children)) walk(children);
		}
	};
	walk(blocks);
	return { valid: warnings.length === 0, warnings };
}

/** Recursively assign stable ids + per-parent orders to a generated block tree. */
export function normalizeBlocks(blocks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const walk = (list: Array<Record<string, unknown>>, start: number): Array<Record<string, unknown>> =>
		list.map((b, i) => {
			const children = Array.isArray(b.children) ? walk(b.children as Array<Record<string, unknown>>, 0) : undefined;
			const out: Record<string, unknown> = {
				...b,
				id: crypto.randomUUID(),
				layout: { ...((b.layout as Record<string, unknown>) ?? {}), order: start + i },
			};
			if (children) out.children = children;
			return out;
		});
	return walk(blocks, 0);
}

/** Call the configured provider. */
export async function generateBlocks(prompt: string, env: AIEnv): Promise<AIResult> {
	const provider = (env.AI_PROVIDER ?? 'workers-ai') as AIProviderName;
	const system = buildSystemPrompt();

	if (provider === 'mock') {
		// Deterministic smoke-test scaffold: a KPI row + table based on prompt words.
		const collection = prompt.match(/for ([a-z_]+)/i)?.[1] ?? 'products';
		const raw = JSON.stringify([
			{
				type: 'row',
				label: 'Summary row',
				layout: { order: 0, colSpan: 4 },
				config: { gap: 12 },
				children: [
					{ type: 'kpi', label: 'Total records', layout: { order: 0, colSpan: 1 }, config: { label: 'Records', collection } },
					{ type: 'kpi', label: 'Active', layout: { order: 1, colSpan: 1 }, config: { label: 'Active', collection } },
					{ type: 'kpi', label: 'New this month', layout: { order: 2, colSpan: 1 }, config: { label: 'New', collection } },
					{ type: 'kpi', label: 'Flagged', layout: { order: 3, colSpan: 1 }, config: { label: 'Flagged', collection } },
				],
			},
			{
				type: 'table',
				label: `${collection} list`,
				layout: { order: 1, colSpan: 4 },
				config: { title: collection, collection, limit: 10 },
			},
		]);
		return { blocks: normalizeBlocks(JSON.parse(raw) as Array<Record<string, unknown>>), raw };
	}

	if (provider === 'workers-ai' && env.AI) {
		const model = env.AI_MODEL ?? DEFAULT_MODEL;
		const out = (await env.AI.run(model, {
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: prompt },
			],
			temperature: 0.4,
		})) as { response?: string; result?: string };
		const text = String(out?.response ?? out?.result ?? '');
		const parsed = parseAIBlocks(text);
		const { warnings } = validateAIBlocks(parsed);
		return { blocks: normalizeBlocks(parsed), raw: text, warnings };
	}

	if (provider === 'openai' && env.AI_API_URL && env.AI_API_KEY) {
		const res = await fetch(env.AI_API_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
			body: JSON.stringify({
				model: env.AI_MODEL ?? 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: prompt },
				],
				temperature: 0.4,
				response_format: { type: 'json_object' },
			}),
		});
		if (!res.ok) throw new Error(`AI provider error ${res.status}`);
		const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
		const text = String(data.choices?.[0]?.message?.content ?? '');
		const parsed = parseAIBlocks(text);
		const { warnings } = validateAIBlocks(parsed);
		return { blocks: normalizeBlocks(parsed), raw: text, warnings };
	}

	throw new Error('AI provider not configured (set AI_PROVIDER / AI_API_URL / AI_API_KEY, or bind Workers AI)');
}
