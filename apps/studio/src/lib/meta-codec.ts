/**
 * Studio metadata wire codec — a thin re-export of the canonical DSL codec.
 *
 * The implementation lives in `@mmbix/types/dsl` (packages/types/src/dsl/) so the
 * Worker, the Vite dev plugin and the browser share exactly ONE encoder. This
 * shim keeps the existing relative imports working without a second
 * implementation; new code should import from `@mmbix/types/dsl` directly.
 */
export { META_WIRE_VERSION, encodeMeta, decodeMeta } from '@mmbix/types/dsl';
export type { WireTable, WireMeta, MetaSnapshot } from '@mmbix/types/dsl';
