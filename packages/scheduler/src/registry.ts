/**
 * Handler registry — the CODE side of the hybrid model.
 *
 * Handlers are real functions registered at worker startup (like widgets in the
 * design-system): `registerHandler('meeting.remind', async (payload, ctx) => …)`.
 * Schedules reference handlers by `type` (data). The Durable Object alarm
 * handler looks the type up here when it fires.
 */

import type { TaskHandler } from './types';

export class HandlerRegistry {
	private handlers = new Map<string, TaskHandler>();

	/** Register (or replace) a handler for `type`. */
	register(type: string, handler: TaskHandler): void {
		const t = type.trim();
		if (!t) throw new Error('handler type is required');
		if (typeof handler !== 'function') throw new Error(`handler for "${t}" must be a function`);
		this.handlers.set(t, handler);
	}

	get(type: string): TaskHandler | undefined {
		return this.handlers.get(type);
	}

	has(type: string): boolean {
		return this.handlers.has(type);
	}

	list(): string[] {
		return [...this.handlers.keys()].sort();
	}

	/** Test hook — clears every registration. */
	clear(): void {
		this.handlers.clear();
	}
}

/** Process-wide registry — shared by the worker (registrations) and the DO (lookups). */
export const schedulerRegistry = new HandlerRegistry();

export const registerHandler = (type: string, handler: TaskHandler): void => schedulerRegistry.register(type, handler);
export const getHandler = (type: string): TaskHandler | undefined => schedulerRegistry.get(type);
export const hasHandler = (type: string): boolean => schedulerRegistry.has(type);
export const listHandlers = (): string[] => schedulerRegistry.list();
export const clearHandlers = (): void => schedulerRegistry.clear();
