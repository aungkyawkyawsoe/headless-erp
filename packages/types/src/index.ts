export type {
	FieldType,
	DocStatus,
	ApprovalLevel,
	ApprovalWorkflow,
	ApprovalRecord,
	FieldDefinition,
	CompositeIndex,
	SystemFieldOptions,
	EntitySchema,
	MigrationRecord,
	UserRecord,
	RoleRecord,
	RolePermissionRecord,
	WebhookRecord,
	SqlStatement,
	MediaUploadResult,
	// v0.7 new types
	CollectionView,
	ViewConfig,
	SchemaSnapshot,
	SchemaDiff,
	FieldDiff,
	// v0.7 field linkage + validation — canonical definitions (single source;
	// consumers must import from here, never re-declare)
	FieldLinkage,
	LinkageCondition,
	ValidationRule,
	CollectionAction,
	CollectionNotification,
	// Standard API envelope
	ApiResponse,
} from './entity';
export { DEFAULT_SYSTEM_FIELDS, SYSTEM_FIELDS } from './entity';
export type { AuthContext } from './auth';
// Frontend ↔ API contract types (client apps import these).
export type {
	AuthUser,
	MyAccess,
	ApiModule,
	MenuNode,
	PageBlock,
	AppPage,
	AppManifest,
	FieldCondition,
	FieldDef,
	CollectionDetail,
	CollectionSummary,
	ColumnFilter,
	ListOptions,
	ListResult,
	SavedViewConfig,
	SavedView,
	AuditChanges,
	AuditAction,
	AuditEntry,
} from './frontend';
// v0.7: Auth provider types
export type { AuthProvider, VerifiedUser } from './auth';
export type {
	ReportType,
	ReportMeasureOp,
	ReportMeasure,
	ReportGranularity,
	ReportFilter,
	ReportLayout,
	ReportDefinition,
	ReportResult,
	SavedReportRecord,
} from './reports';
export { starterPivotDef } from './reports';
export type {
	PluginManifest,
	HookManifest,
	RouteManifest,
	MigrationManifest,
	ServiceManifest,
	PluginDependency,
	WorkerGroupManifest,
	ManifestValidationResult,
	ManifestValidationError,
	ManifestValidationWarning,
} from './manifest';
// MVE (Mobile View Engine) — module template contract (API ↔ BFF ↔ MiniApp)
export type {
	MveFieldKind,
	MveTone,
	MveFieldTemplate,
	MveGroupTemplate,
	MveFormTemplate,
	MveCardLineTemplate,
	MveActionTemplate,
	MveCardTemplate,
	MveTabTemplate,
	MveInfoFieldTemplate,
	MveDetailFieldTemplate,
	MveListTemplate,
	MveTemplate,
	MveTemplateRecord,
} from './mve';
// Canonical platform contract — error codes + meta contract (single source).
export { ERROR_CODES, API_ERROR_CODES, STATUS_TO_ERROR_CODE, errorCodeForStatus, isErrorCode, MAX_FIELD_SELECTIONS } from './contract';
export type {
	ErrorCode,
	ApiErrorCode,
	ApiErrorEnvelope,
	PaginationContract,
	AggregateContract,
	RateLimitTierContract,
	RateLimitsContract,
	PlatformContractData,
} from './contract';
// Launcher app → collection footprint (single source for both gates: the mini
// app's open-app predicate and the Studio's per-app read auto-grant).
export { APP_COLLECTIONS, appRequiredCollections } from './apps';
// Module manifest — the contract every business/vertical module declares. The
// factory core reads these; a disabled module mounts nothing.
export { modulePath, resolveAddons } from './module';
export type { ModuleManifest, ModuleRole, ModuleRoleGrant, ModuleIdentity, ModuleCollectionDef, AddonCatalogEntry } from './module';
// Lifecycle event catalog — single source for code hooks, declarative rules,
// the plugin manifest contract, and Studio tooling.
export { LIFECYCLE_EVENTS, DECLARATIVE_TRIGGER_EVENTS } from './hooks';
export type { LifecycleEvent, TriggerEvent } from './hooks';
// DSL — ONE codec + ONE vocabulary for the design → schema → page seams.
// Prefer the `@mmbix/types/dsl` subpath in Worker hot paths; this barrel export
// keeps the shared types one import away for consumers that already use it.
export { applyOps, unionColumns, encodeColumns, decodeColumns, META_WIRE_VERSION, encodeMeta, decodeMeta } from './dsl';
export type {
	ColumnarTable,
	WireTable,
	WireMeta,
	MetaSnapshot,
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
	BlockNode,
	PatchOp,
} from './dsl';
// MCP Factory Control Plane — capability registry + the Manifest write primitive.
export type { CapabilityDomain, CapabilityClass, CapabilityDescriptor, CapabilityQuery } from './capability';
export type {
	FactoryFieldSpec,
	FactoryCollectionSpec,
	FactoryPageSpec,
	FactoryRoleSpec,
	FactoryPermissionSpec,
	FactoryWorkflowSpec,
	FactoryMenuSpec,
	FactoryKpiSpec,
	FactoryServerFunctionSpec,
	FactoryApiKeySpec,
	FactoryManifest,
	ManifestActionKind,
	ManifestAction,
	ManifestPlan,
} from './factory';
