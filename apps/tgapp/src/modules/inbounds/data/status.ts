import type { MroDocStatus } from '@/shared/mro';

/**
 * Normalize a row's `doc_status` — the engine treats `''` / missing as draft,
 * so the card pill and the draft-only confirm action must too.
 */
export function inboundDocStatusOf(value: unknown): MroDocStatus {
	return value === 'confirmed' || value === 'cancelled' ? value : 'draft';
}
