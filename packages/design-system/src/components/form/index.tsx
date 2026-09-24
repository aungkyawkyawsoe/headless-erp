import * as React from 'react';

import type { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn } from '@/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';

/**
 * Whether the form is embedded in a padded container (e.g. an `AppShell`
 * content area) instead of rendered standalone as a full page. Set by `Form`
 * via the `embedded` prop and consumed by `FormHeader` / `FormTabs` so the
 * full-bleed header strips are scoped to the container instead of the
 * viewport.
 */
const FormLayoutContext = React.createContext({ embedded: false });

/**
 * `Form` is a page-level form layout. It composes a full-width header bar
 * (breadcrumbs on the left, custom action slots on the right) with a
 * responsive multi-column grid of form fields.
 *
 * The header spans the full screen width, while `FormContent` renders the
 * field area in a centered max-width container (default `4xl`). Compose
 * with `FormHeader` + `FormBreadcrumbs` + `FormActions` for the top bar,
 * and `FormContent` (optionally grouped with `FormSection`) for the
 * fields below. `FormTabs` renders the body as a tabbed view from a
 * data-driven `FormTabConfig[]`.
 *
 * Pass `embedded` when the form is placed inside a padded container such as
 * an `AppShell` content area: the header strips then span that container
 * (assuming `p-4` padding) instead of breaking out to the viewport, so the
 * form fits its parent.
 */
function Form({
	embedded = false,
	className,
	...props
}: React.ComponentProps<'form'> & {
	/**
	 * Render the header strips inside the parent container instead of
	 * full-bleed. Use when the form is embedded in a `p-4` container (e.g. an
	 * `AppShell` content area). Defaults to `false`.
	 */
	embedded?: boolean;
}) {
	return (
		<FormLayoutContext.Provider value={{ embedded }}>
			<form
				data-slot="form"
				data-embedded={embedded || undefined}
				className={cn(
					'-mx-4 flex flex-col gap-4',
					// Break out of the container's top padding only when standalone —
					// an embedded form keeps the container's own top spacing (the
					// AppShell content area is `p-4` when no shell header is shown).
					!embedded && '-my-4',
					className,
				)}
				{...props}
			/>
		</FormLayoutContext.Provider>
	);
}

/**
 * The top bar of the form. Place a `FormBreadcrumbs` on the left and a
 * `FormActions` on the right; the bar wraps on narrow viewports.
 *
 * Full-bleed by default; when the form is `embedded`, the bar spans the
 * container's `p-4` padding (`-mx-4`) instead of the viewport.
 */
function FormHeader({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot="form-header"
			className={cn('flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2', className)}
			{...props}
		/>
	);
}

/** Left slot of the form header — typically a breadcrumb trail. */
function FormBreadcrumbs({ className, ...props }: React.ComponentProps<'div'>) {
	return <div data-slot="form-breadcrumbs" className={cn('flex min-w-0 flex-1 items-center', className)} {...props} />;
}

/**
 * Right slot of the form header — a flexible group for action buttons
 * (`Save`, `Download`, …) or any custom controls.
 *
 * Buttons render at `xs` size with `rounded-sm` corners by default so the
 * header stays compact. Icon-only buttons (`size-6` … `size-9`) keep their
 * square shape.
 */

function FormActions({ className, ...props }: React.ComponentProps<'div'>) {
	return <div data-slot="form-actions" role="group" className={cn('ml-auto flex shrink-0 items-center gap-2', className)} {...props} />;
}

/**
 * The form body — a responsive field grid rendered inside a centered
 * max-width container (the header stays full-width).
 *
 * - `columns={2}` (default): single column on mobile, two columns from `md`
 *   up. Fields can span the full width with `className="md:col-span-2"`.
 * - `columns={1}`: always a single column.
 * - `fullWidth`: render full-width without the centered container (used
 *   internally by `FormSection`).
 * - `maxWidth`: container width, defaults to `4xl`.
 */
const formMaxWidths = {
	sm: 'max-w-sm',
	md: 'max-w-md',
	lg: 'max-w-lg',
	xl: 'max-w-xl',
	'2xl': 'max-w-2xl',
	'3xl': 'max-w-3xl',
	'4xl': 'max-w-4xl',
	'5xl': 'max-w-5xl',
	'6xl': 'max-w-6xl',
	full: 'max-w-full',
} as const;

function FormContent({
	className,
	columns = 2,
	fullWidth = false,
	maxWidth = '4xl',
	...props
}: React.ComponentProps<'div'> & {
	columns?: 1 | 2;
	/** Render full-width instead of the centered max-width container. */
	fullWidth?: boolean;
	/** Container width when not `fullWidth`. Defaults to `4xl`. */
	maxWidth?: keyof typeof formMaxWidths;
}) {
	return (
		<div
			data-slot="form-content"
			data-columns={columns}
			className={cn(
				'mt-4 grid gap-x-4 gap-y-5',
				columns === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1',
				!fullWidth && cn('mx-auto w-full', formMaxWidths[maxWidth]),
				className,
			)}
			{...props}
		/>
	);
}

/**
 * A full-width grouping inside a two-column `FormContent`, with an optional
 * title and description. Fields render in their own grid — pass the same
 * `columns` as the parent form for aligned columns.
 */
function FormSection({
	className,
	title,
	description,
	columns,
	children,
	...props
}: React.ComponentProps<'section'> & {
	title?: React.ReactNode;
	description?: React.ReactNode;
	columns?: 1 | 2;
}) {
	return (
		<section data-slot="form-section" className={cn('md:col-span-2', className)} {...props}>
			{(title || description) && (
				<div data-slot="form-section-heading" className="mb-3">
					{title ? <div className="cn-font-heading text-base leading-snug font-medium">{title}</div> : null}
					{description ? <div className="mt-0.5 text-sm text-muted-foreground">{description}</div> : null}
				</div>
			)}
			<FormContent columns={columns} fullWidth>
				{children}
			</FormContent>
		</section>
	);
}

/**
 * Configuration for a single tab in a `FormTabs` view.
 *
 * Tabs are plain data — add, remove, or hide entries to change the tabbed
 * view without touching `FormTabs`. Field layouts are injected by the
 * consumer through `content` (static) or `render` (derived per tab), so
 * `FormTabs` never depends on concrete field components.
 */
export interface FormTabConfig {
	/** Stable, unique identifier for the tab. */
	value: string;
	/** Text shown on the tab trigger. */
	label: React.ReactNode;
	/** Optional leading icon on the trigger. */
	icon?: React.ReactNode;
	/** Visible but not selectable. */
	disabled?: boolean;
	/** Removes the tab from the bar and its panel (e.g. permission-gated sections). */
	hidden?: boolean;
	/** Static panel content. Ignored when `render` is provided. */
	content?: React.ReactNode;
	/** Panel content derived from the tab value. Takes precedence over `content`. */
	render?: (context: { value: string }) => React.ReactNode;
}

export interface FormTabsProps extends Omit<
	TabsPrimitive.Root.Props,
	'value' | 'defaultValue' | 'onValueChange' | 'orientation' | 'className'
> {
	/** Tabs to render, in display order. */
	tabs: FormTabConfig[];
	/**
	 * Controlled active tab. When the value no longer exists (e.g. the tab
	 * was removed or hidden), the first tab is shown instead of a blank panel.
	 */
	value?: string;
	/** Uncontrolled initial tab. Defaults to the first tab. */
	defaultValue?: string;
	/** Called when the active tab changes. */
	onValueChange?: (value: string) => void;
	/** `TabsList` variant. Defaults to `line` — an underline fits form headers. */
	variant?: 'default' | 'line';
	/** Horizontal (bar above panels) or vertical (bar beside panels). */
	orientation?: 'horizontal' | 'vertical';
	/** Allow the tab bar to scroll horizontally when it overflows (many tabs). */
	scrollable?: boolean;
	/**
	 * Keep inactive panels mounted so field state survives tab switches.
	 * Defaults to `true` — uncontrolled inputs lose their values otherwise.
	 * Set to `false` to lazy-mount panels on large forms.
	 */
	keepMounted?: boolean;
	/** Classes for the wrapping `Tabs` root. */
	className?: string;
	/** Classes for the tab bar (`TabsList`). */
	tabsListClassName?: string;
}

/**
 * `FormTabs` renders a tabbed form body from a `FormTabConfig[]`. Tabs are
 * data — adding one is just appending an entry — so the component is open
 * for extension and closed for modification, and the same `FormTabs` serves
 * any form. Panels stay mounted by default so field values survive tab
 * switches; set `keepMounted={false}` to lazy-mount panels on large forms.
 *
 * Place `FormTabs` directly below `FormHeader`: it offsets the form's `gap-4`
 * so the tab bar sits flush against the header's bottom border. The tab bar
 * renders as a full-width strip (like a Flutter `AppBar` tab bar) — it spans
 * the viewport with `px-4` so the triggers stay left-aligned with the
 * breadcrumbs, and closes with a bottom border. Each panel owns its layout —
 * use `FormContent` for a centered, containerized field area. In contexts
 * without a `gap-4` parent, pass `className="mt-4"` (or similar) to restore
 * spacing. When the parent form is `embedded`, the strip spans the
 * container's padding instead of the viewport.
 */
function FormTabs({
	tabs,
	value,
	defaultValue,
	onValueChange,
	variant = 'line',
	orientation = 'horizontal',
	scrollable = false,
	keepMounted = true,
	className,
	tabsListClassName,
	...rootProps
}: FormTabsProps) {
	const { embedded } = React.useContext(FormLayoutContext);
	const visibleTabs = React.useMemo(() => tabs.filter((tab) => !tab.hidden), [tabs]);
	const values = React.useMemo(() => visibleTabs.map((tab) => tab.value), [visibleTabs]);
	const fallback = values[0];

	if (!fallback) return null;

	// A controlled `value` may point at a tab that was removed or hidden — show
	// the first tab instead of a blank panel (uncontrolled roots already
	// auto-fallback, so this keeps both modes consistent).
	const resolvedValue = value !== undefined ? (values.includes(value) ? value : fallback) : undefined;
	const resolvedDefault = defaultValue !== undefined && values.includes(defaultValue) ? defaultValue : fallback;

	return (
		<Tabs
			{...rootProps}
			value={resolvedValue}
			defaultValue={value !== undefined ? undefined : resolvedDefault}
			onValueChange={(next) => onValueChange?.(next == null ? '' : String(next))}
			orientation={orientation}
			className={cn('-mt-4', className)}
		>
			<div
				data-slot="form-tabs-strip"
				className={cn(orientation === 'horizontal' && (embedded ? 'border-b px-4' : 'mx-[calc(50%-50vw)] border-b px-3.5'))}
			>
				<TabsList
					variant={variant}
					className={cn(
						'px-0',
						// Keep the first trigger's content flush with the breadcrumb
						// trail above it — the trigger's own left padding (and the
						// line indicator's matching inset) would otherwise indent the
						// tab bar by a few pixels.
						'[&>[data-slot=tabs-trigger]:first-child]:pl-0',
						'[&>[data-slot=tabs-trigger]:first-child]:after:left-0',
						scrollable && 'max-w-full overflow-x-auto',
						tabsListClassName,
					)}
				>
					{visibleTabs.map((tab) => (
						<TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled}>
							{tab.icon ? <span data-icon="inline-start">{tab.icon}</span> : null}
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
			{visibleTabs.map((tab) => (
				<TabsContent key={tab.value} value={tab.value} keepMounted={keepMounted}>
					{tab.render ? tab.render({ value: tab.value }) : tab.content}
				</TabsContent>
			))}
		</Tabs>
	);
}

export { Form, FormHeader, FormBreadcrumbs, FormActions, FormContent, FormSection, FormTabs };
