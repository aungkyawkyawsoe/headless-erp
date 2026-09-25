import type { FieldDefinition } from '../../lib/api';
import type { FormGroup, FormTab } from './types';
import { flattenGroups, spanShortcut } from './serialize';

/** Everything the global shortcut handler reads — injected so the handler is a
 *  pure function of its inputs (no provider/DOM needed to reason about it). */
export interface FormLayoutKeyDeps {
	save: () => void;
	undo: () => void;
	redo: () => void;
	setHelpOpen: (updater: (open: boolean) => boolean) => void;
	selected: string | null;
	fields: FieldDefinition[];
	tabs: FormTab[];
	activeGroupId: string | null;
	setFieldSpan: (name: string, span: number) => void;
	patchGroup: (gid: string, patch: (g: FormGroup) => FormGroup) => void;
	removeFieldFromLayout: (name: string) => void;
}

/**
 * Build the window-level keyboard handler for the form-layout editor:
 * Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo, ? help,
 * 1–9 grid span, Delete. The `handledAt` dedupe map is created per handler (one
 * per effect run) so a normal keydown+keyup pair acts only once. Register in the
 * capture phase so no other listener can claim the key first.
 */
export function makeFormLayoutKeyHandler(deps: FormLayoutKeyDeps): (e: KeyboardEvent) => void {
	const { save, undo, redo, setHelpOpen, selected, fields, tabs, activeGroupId, setFieldSpan, patchGroup, removeFieldFromLayout } = deps;
	const handledAt = new Map<string, number>();
	return (e: KeyboardEvent) => {
		const mod = e.ctrlKey || e.metaKey;
		// Modifier combos (Ctrl/Cmd+…) act on keydown only — keyup would double-fire.
		if (e.type === 'keyup' && mod) return;
		// Save — handled before the input guard so Ctrl/Cmd+S works while typing.
		if (mod && (e.key === 's' || e.key === 'S')) {
			e.preventDefault();
			void save();
			return;
		}
		const t = e.target as HTMLElement | null;
		if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
		if (mod && (e.key === 'z' || e.key === 'Z')) {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
			return;
		}
		if (mod && (e.key === 'y' || e.key === 'Y')) {
			e.preventDefault();
			redo();
			return;
		}
		if (e.type === 'keydown' && e.key === '?') {
			e.preventDefault();
			setHelpOpen((v) => !v);
			return;
		}

		// Plain-key shortcuts below (span/WASD/arrows/Delete/Ctrl+D) — dedupe the
		// keydown+keyup pair; act on keyup when the IME swallowed the keydown.
		const code = e.code ?? '';
		const last = handledAt.get(code);
		if (e.type === 'keyup' && last !== undefined && Date.now() - last < 500) return;
		if (e.type === 'keydown') handledAt.set(code, Date.now());

		const selField = selected && fields.some((f) => f.name === selected) ? selected : null;
		const allGroups = tabs.flatMap((tb) => flattenGroups(tb.groups));
		const actGroup = activeGroupId ? (allGroups.find((g) => g.id === activeGroupId) ?? null) : null;

		// Ctrl+D — duplicate: owned by the canvas group's own key handler (so it never
		// double-fires with this capture-phase listener).
		if (mod && (e.key === 'd' || e.key === 'D')) return;

		// Width — mirror the block canvas semantics: plain N → span N,
		// Shift+N → 2N (doubled), Alt+Shift+N → N (single). Clamped to the
		// group's column count. Also handled on the field chip itself.
		const spanN = spanShortcut(e);
		if (spanN !== null) {
			e.preventDefault();
			const cols = selField ? (allGroups.find((g) => g.fieldNames.includes(selField))?.columns ?? 2) : (actGroup?.columns ?? 2);
			const clamped = Math.max(1, Math.min(cols, spanN));
			if (selField) {
				setFieldSpan(selField, clamped);
			} else if (actGroup) {
				patchGroup(actGroup.id, (g) => ({ ...g, columns: clamped }));
			}
			return;
		}
		if (!selField) return;

		// Delete / Backspace — remove the selected field from the layout.
		// (A/D/W/S movement + arrow-key navigation are handled by the canvas group's
		// own key handler — visual-neighbor based, so they never jump to another group.)
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			removeFieldFromLayout(selField);
		}
	};
}
