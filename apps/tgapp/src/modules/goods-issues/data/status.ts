import type { MroDocStatus } from '@/shared/mro';

/**
 * Normalize a row's `doc_status` — the engine treats `''` / missing as draft
 * (`COALESCE(doc_status,'') IN ('','draft')` on confirm), so the card pill and
 * the draft-only confirm action must too.
 */
export function outboundDocStatusOf(value: unknown): MroDocStatus {
	return value === 'confirmed' || value === 'cancelled' ? value : 'draft';
}
