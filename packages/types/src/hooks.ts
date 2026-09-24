/**
 * Lifecycle event catalog — the SINGLE source of truth for the events the
 * entity pipeline emits, shared by the code-hook registry
 * (`apps/api/src/core/plugin-hooks.ts`), the declarative server-function rules,
 * the plugin manifest contract, and Studio tooling.
 *
 * The catalog is deliberately TWO sets:
 *
 *   LIFECYCLE_EVENTS            — every event the pipeline dispatches to code
 *                                 hooks. The registry's own `event` parameter
 *                                 stays open (the outbox replays event names
 *                                 from the database) but this is the canonical
 *                                 set those names come from.
 *   DECLARATIVE_TRIGGER_EVENTS  — the subset a declarative rule may target,
 *                                 i.e. the events whose RESULT the pipeline can
 *                                 still act on (abort the write, or mutate the
 *                                 document that is about to be written).
 *
 * `after_delete` / `after_restore` are code-hook-only on purpose: they fire
 * AFTER the row has left (or re-entered) the live set, so a rule's only actions
 * — abort, `set` / `clear` / `calculate` — are already moot. A rule editor must
 * therefore never offer them, and the `_server_functions.trigger_event` CHECK
 * constraint is built from `DECLARATIVE_TRIGGER_EVENTS` so that stays true.
 *
 * Before this module the declarative list was spelled out five times across
 * `plugins/server-functions/{types,plugin,service}.ts` and their CHECK
 * constraints; deriving every copy from here is what stops the drift.
 */

/** Every lifecycle event the entity pipeline dispatches to code hooks. */
export const LIFECYCLE_EVENTS = [
	'validate',
	'before_insert',
	'after_insert',
	'before_update',
	'after_update',
	'before_delete',
	'after_delete',
	'after_restore',
	'on_change',
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/**
 * The events a declarative server-function rule may be registered on — the
 * lifecycle events whose result the pipeline can act on. A strict subset of
 * `LIFECYCLE_EVENTS` (see the module doc for why the two after-lifecycle
 * events are excluded).
 */
export const DECLARATIVE_TRIGGER_EVENTS = [
	'validate',
	'before_insert',
	'after_insert',
	'before_update',
	'after_update',
	'before_delete',
	'on_change',
] as const satisfies readonly LifecycleEvent[];

export type TriggerEvent = (typeof DECLARATIVE_TRIGGER_EVENTS)[number];
