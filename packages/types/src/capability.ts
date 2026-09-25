/**
 * Capability registry contract — the factory's self-description.
 *
 * A capability is one thing the factory can do (create a collection, save a
 * page, add a role, run a report …). The registry is the SINGLE source of truth
 * an agent discovers through MCP — instead of a tool schema per action (which
 * costs standing context every turn), the catalog is a RESOURCE read on demand.
 *
 * `class` is the gate: `read` never writes; `plan` computes a diff and never
 * writes; `apply` is the only class that mutates, and it is human-gated.
 */
export type CapabilityDomain = 'meta' | 'schema' | 'pages' | 'data' | 'governance' | 'automation' | 'analytics' | 'ops' | 'generation';

export type CapabilityClass = 'read' | 'plan' | 'apply';

export interface CapabilityDescriptor {
	/** Stable dotted id, e.g. `schema.collections.create`. */
	id: string;
	domain: CapabilityDomain;
	class: CapabilityClass;
	/** One-line description. */
	summary: string;
	/** Short, human/agent-readable param hint — deliberately brief (token-cheap). */
	params?: string;
	/** True when a shipped verb/route implements it today. */
	available: boolean;
}

/** Filter accepted by `search_capabilities`. */
export interface CapabilityQuery {
	q?: string;
	domain?: CapabilityDomain;
	class?: CapabilityClass;
	availableOnly?: boolean;
}
