import { useQuery } from '@tanstack/react-query';
import type { FieldTypeDef } from './api';
import { fieldTypesQuery } from './queries';

/** The backend field-type catalog payload (`/api/field-types`). */
export interface FieldTypeCatalog {
	types: FieldTypeDef[];
	groups: Record<string, FieldTypeDef[]>;
}

/**
 * `GET /api/field-types` through TanStack Query.
 *
 * The catalog is a STATIC module on the API — it only changes on redeploy — so
 * `fieldTypesQuery` gives it `staleTime: Infinity`: one request per session, no
 * refetch, and every mount after the first (palette, field inspector, form-layout
 * inspector, add-field dialog) reads the same cache entry. This replaces the
 * hand-rolled `loadFieldTypes` promise cache with the app's one caching layer.
 */
export function useFieldTypeCatalog(token: string) {
	return useQuery(fieldTypesQuery(token));
}

/**
 * `useFieldTypes(token)` — the 40-type catalog as a flat list. Empty until the
 * first request resolves (or when the backend is unreachable).
 */
export function useFieldTypes(token: string): FieldTypeDef[] {
	return useFieldTypeCatalog(token).data?.types ?? [];
}
