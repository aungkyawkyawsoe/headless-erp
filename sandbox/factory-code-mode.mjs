/**
 * Factory code-mode reference — one script, many operations.
 *
 * This is the "code mode" pattern: instead of the agent calling one MCP tool
 * per action, it writes a small program that composes the factory's tools and
 * runs it inside the sandbox (or on the host). Token-cheap, loop-capable,
 * long-tail-friendly.
 *
 * Run INSIDE the AIO sandbox against the host's dev server:
 *   FACTORY_URL=http://host.docker.internal:8788 FACTORY_TOKEN=dev-token node factory-code-mode.mjs
 *
 * Run on the host:
 *   FACTORY_URL=http://localhost:8788 FACTORY_TOKEN=dev-token node factory-code-mode.mjs
 *
 * Uses only the Node 20+ built-ins (global fetch + crypto.randomUUID).
 */

const BASE = process.env.FACTORY_URL ?? 'http://localhost:8788';
const TOKEN = process.env.FACTORY_TOKEN ?? 'dev-token';

/** JSON-RPC over the factory's MCP endpoint. */
async function rpc(method, params) {
	const res = await fetch(`${BASE}/api/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
		body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
	});
	const body = await res.json();
	if (body.error) throw new Error(`MCP ${method} → ${body.error.code}: ${body.error.message}`);
	return body.result;
}

/** Call one MCP tool and parse its JSON payload. */
async function callTool(name, args) {
	const result = await rpc('tools/call', { name, arguments: args });
	const text = result?.content?.[0]?.text;
	if (result?.isError) throw new Error(text ?? `${name} failed`);
	return text ? JSON.parse(text) : result;
}

// The build, expressed as data — the Manifest primitive.
const manifest = {
	version: 1,
	collections: [
		{
			slug: 'sandbox_demo',
			name: 'Sandbox Demo',
			fields: [
				{ name: 'title', type: 'text', required: true },
				{ name: 'amount', type: 'currency' },
			],
		},
	],
};

// 1. Discover what the factory can do (no schema needed up front).
const { capabilities } = await callTool('search_capabilities', { available_only: true });
console.log(`factory capabilities available: ${capabilities.length}`);

// 2. PLAN — a diff; writes nothing.
const plan = await callTool('plan_manifest', { manifest });
console.log('plan:', plan.summary);

// 3. APPLY — the only write, idempotent, human-gated (admin + write key).
const applied = await callTool('apply_manifest', { manifest });
console.log(
	'applied:',
	applied.results.map((r) => `${r.target} ${r.ok ? 'ok' : `FAILED: ${r.error}`}`).join(', '),
);

// 4. QUERY back what was built.
const { results } = await callTool('query', { requests: [{ collection: 'sandbox_demo', params: { limit: 5 } }] });
console.log('query rows:', results[0]?.data?.length ?? 0);
