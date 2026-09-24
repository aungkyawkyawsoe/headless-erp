import type { FieldCondition } from '../../lib/api';

/** Shared state shapes for the form layout engine (tabs → groups → fields). */

export interface FormGroup {
	id: string;
	title: string;
	columns: number;
	fieldNames: string[];
	/** Per-field grid width inside the group's columns — 'full' spans all columns (half = default). */
	fieldWidths?: Record<string, 'half' | 'full'>;
	/** Per-field grid span (1..group.columns) — how many columns this field occupies (Studio 1/2/3/4 shortcut). */
	fieldSpans?: Record<string, number>;
	/** Optional Lucide icon name shown next to the group label (see GROUP_ICONS in @mmbix/ui-views). */
	icon?: string;
	/** Conditional visibility (linkage rule) — the whole group renders only when the condition holds. */
	visible_when?: FieldCondition;
	/** Nested sub-groups (group → sub-group → fields). Optional — enterprise layout depth. */
	groups?: FormGroup[];
}

export interface FormTab {
	id: string;
	label: string;
	groups: FormGroup[];
}

/** The persisted (serialized) shape — ids are runtime-only, never written to the schema. */
export interface SerializedFormGroup {
	title: string;
	columns: number;
	fieldNames: string[];
	fieldWidths?: Record<string, 'half' | 'full'>;
	fieldSpans?: Record<string, number>;
	icon?: string;
	visible_when?: FieldCondition;
	groups?: SerializedFormGroup[];
}

export interface SerializedFormLayout {
	tabs: Array<{ key: string; label: string; groups: SerializedFormGroup[] }>;
	/** Tab key opened by default when the form renders (form-level property). */
	default_tab?: string;
}
