export { D1Client } from './db/d1-client';
export { setD1ExecutorResolver, resolveD1Executor, type D1ExecutorResolver } from './db/d1-executor';
export { QueryBuilder } from './db/query-builder';
export { SchemaBuilder, type TableBuilder } from './db/schema-builder';
export { SelfTuningIndexAdvisor, getIndexAdvisor } from './db/auto-indexer';
export type { FilterSignature, AutoIndexEntry } from './db/auto-indexer';

export { resolvePolicy, policyFeatures, DEFAULT_POLICY } from './policy/policy-resolver';
export type {
	ResolvedPolicy,
	PolicyInput,
	PolicyDefaults,
	AutoIndexPolicy,
	CachePolicy,
	OfflineReadsPolicy,
	WritesPolicy,
	SearchPolicy,
} from './policy/policy-resolver';
export { MigrationRunner, MIGRATION_NAMES } from './db/migrations';
export { configureDbLiveness, dbVerifiedWithin, invalidateDbLiveness, markDbVerified } from './db/db-liveness';
export { Repository, constraintViolation } from './db/repository';
export { EntityMigrator } from './db/entity-migrator';
export * from './entity/field-utils';
export * from './entity/relation-resolver';
export { R2Client } from './storage/r2-client';
export { CacheLayer, cache } from './cache/cache-layer';
export {
	readCacheKey,
	readCached,
	storeCached,
	invalidateCollectionReads,
	setReadInvalidationObserver,
	fnv1a,
} from './cache/response-cache';
// ─── v0.7: Field Validation Engine ─────────────────────
export { FieldValidator } from './entity/validator';

// ─── v0.7: Default Value Resolver ──────────────────────
export { DefaultResolver } from './entity/defaults';
export type { DefaultContext } from './entity/defaults';

// ─── v0.7: Field Linkage Engine ────────────────────────
export { LinkageEngine } from './entity/linkage-engine';

// ─── v0.11: Computed fields (formula store/result_type + lookups) ──
export {
	extractLookupRefs,
	buildLookupScope,
	topoSortStoredFormulas,
	formulaResultType,
	coerceComputedValue,
	validateFormulaReferences,
	applyFormulaPrecision,
	formulaRounding,
	roundTo,
	DEFAULT_FORMULA_RESULT_TYPE,
	FORMULA_RESULT_TYPES,
	FORMULA_ROUNDING_MODES,
} from './entity/computed';
export type { FormulaResultType, RoundingMode } from './entity/computed';

// v0.11: Callable-function introspection (save-time reference validation)
export { isCallableFunction } from './entity/expression';
// v0.11: formula dependency resolution (virtual formulas auto-select their sources)
export { extractFieldRefs, resolveFormulaDependencies } from './entity/computed';

// ─── v0.7: Schema Snapshot Differ ──────────────────────
export { SchemaDiffer } from './entity/schema-differ';

// ─── v0.7: Safe Expression Evaluator (workerd-safe) ────
export { evaluateExpression, evaluateBoolean } from './entity/expression';
// v0.10: Extensible function registry — @mmbix/compute registers NPV/PMT/…
export { registerFunction, listRegisteredFunctions, type EvalFunction } from './entity/expression';
// v0.10: Complexity guard — rule-save surfaces fail fast on pathological expressions
export { validateExpressionComplexity, MAX_EXPRESSION_LENGTH, MAX_EXPRESSION_TOKENS } from './entity/expression';

// ─── v0.8: QueryBuilder enhancements ────────────────────
// CTE (with/withRecursive), upsert (onConflict), multi-row insert (toInsertMany),
// window functions, expression builder (selectFn/selectRawWith/fn/caseWhen),
// sql template tag, whereNotExists/orWhereExists variants, whereBetween/whereNotBetween,
// json_each IN-list optimization, explain(), orWhereRaw/orCond/andCond.
// D1Client: onQuery hook + transient-error retry. Repository: constraint mapping + createMany.

// ─── v0.9: Resilience ────────────────────────────────────
// Removed in the data-integrity audit: CircuitBreaker + OutboxService had no
// backing `_outbox` migration and zero in-repo consumers (grep confirmed),
// so the module and its exports were deleted.
