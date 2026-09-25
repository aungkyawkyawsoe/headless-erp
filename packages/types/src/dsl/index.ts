/**
 * The DSL — ONE codec and ONE vocabulary for every seam that moves factory
 * metadata (design DNA, schema proposals, block patches, the studio snapshot).
 *
 * Import from `@mmbix/types/dsl`; never re-implement an encoder.
 */
// Explicit `.ts` extensions: this barrel is the ONE package entry Node's native
// ESM loader reads directly (the Studio's vite.config imports the metadata codec
// at config-load time), and Node requires extensions on relative specifiers
// where a bundler would infer them. `allowImportingTsExtensions` permits it in
// tsc; every bundler (vite/esbuild/wrangler) accepts it too.
export { unionColumns, encodeColumns, decodeColumns, type ColumnarTable } from './codec.ts';
export { META_WIRE_VERSION, encodeMeta, decodeMeta, type WireTable, type WireMeta, type MetaSnapshot } from './meta-codec.ts';
export type {
	DesignProvider,
	DesignSourceRef,
	DesignHint,
	DesignComponent,
	DesignRelation,
	DesignScreen,
	DesignDNA,
	FieldInference,
	FieldProposal,
	RelationProposal,
	ProposalWarning,
	SchemaProposal,
	ProposalStatus,
} from './design.ts';
export { applyOps, type BlockNode, type PatchOp } from './patch.ts';
