import type { ComponentType } from 'react';

/** Schema for one editable widget prop (the Studio inspector). */
export type WidgetPropType = 'text' | 'number' | 'boolean' | 'select' | 'collection' | 'field' | 'expression' | 'color' | 'icon' | 'code';

export interface WidgetPropDef {
	label: string;
	type: WidgetPropType;
	/** Default value applied to new widget blocks. */
	default?: unknown;
	/** Options for `select` — value/label pairs. */
	options?: Array<{ value: string; label: string }>;
	/** Visual grouping in the inspector (props render grouped by this). */
	group?: string;
	hint?: string;
}

/**
 * A code widget — a real React component, composed ONLY from design-system
 * components, registered in the palette and rendered anywhere at runtime
 * (builder == runtime). Widgets live as one file per widget under
 * `src/components/widgets/<name>.tsx` — no database involved.
 */
export interface WidgetDef {
	/** Block type used on the canvas — must start with `widget:` and be unique. */
	type: string;
	label: string;
	group: string;
	/** Lucide icon name for the palette (the studio maps it). */
	icon?: string;
	/** Default grid span when dropped onto the 12-column canvas. */
	defaultColSpan?: number;
	/** Default config props — merged when the widget block is created. */
	defaultProps: Record<string, unknown>;
	/** Props schema — drives the Studio inspector fields. */
	props: Record<string, WidgetPropDef>;
	/** The real component — rendered with the block's config as props. */
	Component: ComponentType<Record<string, unknown>>;
	/** Exported function name of the widget (the code view inlines it). */
	exportName?: string;
}
