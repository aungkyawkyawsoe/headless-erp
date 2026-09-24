import { useCallback, useRef, useState } from 'react';

/**
 * useSnapshotHistory — generic undo/redo stack (single source of truth for the
 * form-layout and page-builder editors).
 *
 * The caller keeps a mutable ref pointing at its current snapshot (`currentRef`),
 * which the hook deep-clones when pushing and returns (cloned) when undoing/
 * redoing. Keeps the current state fresh without stale closures, and avoids
 * JSON round-trips on every render (only on push/undo/redo).
 *
 * Returns `canUndo`/`canRedo` refreshed via a version counter — re-render to
 * read them after any mutation.
 */
export function useSnapshotHistory<T>(currentRef: { current: T }, cap = 60) {
	const pastRef = useRef<T[]>([]);
	const futureRef = useRef<T[]>([]);
	const [version, setVersion] = useState(0);

	const clone = <U>(v: U): U => structuredClone(v);

	/** Record the current snapshot as a past state (call before a mutation). */
	const push = useCallback(() => {
		pastRef.current.push(clone(currentRef.current));
		if (pastRef.current.length > cap) pastRef.current.shift();
		futureRef.current = [];
		setVersion((v) => v + 1);
	}, [currentRef, cap]);

	/** Pop the last past snapshot — returns it cloned, or null when empty. */
	const undo = useCallback((): T | null => {
		const prev = pastRef.current.pop();
		if (!prev) return null;
		futureRef.current.push(clone(currentRef.current));
		setVersion((v) => v + 1);
		return clone(prev);
	}, [currentRef]);

	/** Pop the next redo snapshot — returns it cloned, or null when empty. */
	const redo = useCallback((): T | null => {
		const next = futureRef.current.pop();
		if (!next) return null;
		pastRef.current.push(clone(currentRef.current));
		setVersion((v) => v + 1);
		return clone(next);
	}, [currentRef]);

	/** Clear both stacks (new document / page switch). */
	const reset = useCallback(() => {
		pastRef.current = [];
		futureRef.current = [];
		setVersion((v) => v + 1);
	}, []);

	return { push, undo, redo, reset, canUndo: pastRef.current.length > 0, canRedo: futureRef.current.length > 0, version };
}
