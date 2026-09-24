/**
 * Test fixture standing in for the `@mmbix/sdk` typegen output.
 *
 * A headless factory ships no built-in collections, so this fixture is a minimal
 * generic schema. Regenerate from a live dev schema with:
 *   mmbix-typegen --url http://localhost:8788/api --token dev-token --out test
 *
 * Single source of truth for the entity schema: TypeScript types (compile-time)
 * AND Zod schemas (runtime validation) — no drift.
 *
 * Usage:
 *   import type { Schema } from './schema';
 *   import { Schemas } from './schema';
 *   createClient<Schema>({ ... });
 *   Schemas.items.parse(response); // runtime purification
 */

import { z } from 'zod';

// ── Runtime validation (Zod) — the SINGLE source of truth ──
export const ItemsSchema = z.object({
	id: z.string(),
	name: z.string().optional().nullable(),
	status: z.string().optional().nullable(),
	created_at: z.string().optional().nullable(),
});

// ── Row types derived from Zod (zero drift) ──
export type Schema = {
	items: z.infer<typeof ItemsSchema>;
};

// ── Runtime registry (for purification) ──
export const Schemas = {
	items: ItemsSchema,
};
