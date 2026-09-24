/**
 * Shared page-block renderer — how a block renders at runtime (the client app)
 * and in the builder (apps/studio). One implementation, so "what you design is
 * what you get".
 *
 * Handles every block type in the registry, applies the Studio's style config
 * (`config.style`) as CSS, executes click actions (`config.events`), and honors
 * `config.hidden`. Data-bound blocks (list/table/kpi) delegate to an injected
 * renderer so this module stays free of app-specific data fetching.
 */
import type { CSSProperties, ReactNode } from 'react';
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	AspectRatio,
	Attachment,
	AttachmentContent,
	AttachmentDescription,
	AttachmentTitle,
	Avatar,
	AvatarImage,
	AvatarFallback,
	Badge,
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
	Button,
	ButtonGroup,
	Card,
	CardContent,
	Checkbox,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	ColorPicker,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
	CounterChip,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	Field,
	Frame,
	Input,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
	InfoRow,
	Item,
	ItemContent,
	Bubble,
	Kbd,
	Label,
	Menubar,
	MenubarContent,
	MenubarMenu,
	MenubarTrigger,
	MediaPanel,
	Message,
	NativeSelect,
	NativeSelectOption,
	NavigationMenu,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	Pagination,
	PaginationContent,
	PaginationSummary,
	Progress,
	RadioGroup,
	RadioGroupItem,
	Rating,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	ScrollArea,
	SearchBox,
	Separator,
	Skeleton,
	Slider,
	Spinner,
	Switch,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
	TagsInput,
	Toggle,
	ToggleGroup,
	ToggleGroupItem,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '@mmbix/design-system';
import {
	Phone,
	CalendarDays,
	MapPin,
	Mail,
	Clock,
	DollarSign,
	Briefcase,
	Star,
	Check,
	X,
	Info,
	Building2,
	Users,
	type LucideIcon,
} from 'lucide-react';
import { DatePicker } from '@mmbix/design-system/datepicker';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@mmbix/design-system/carousel';
import { Command, CommandInput, CommandItem, CommandList } from '@mmbix/design-system/command';
import { isContainerType, blockColSpan } from './block-registry';
import { widgetDefOf, type WidgetDef } from '@mmbix/design-system/widgets';
import { useBinding, type BindingSpec, type DataSource } from './use-binding';

export interface PageBlockLike {
	id: string;
	type: string;
	label?: string;
	config: Record<string, unknown>;
	/** Layout hints — grid span/position (design == runtime; studio sets these). */
	layout?: { order?: number; colSpan?: number; colStart?: number; alignY?: 'start' | 'end' };
	/** Nested children (containers: row/column/tabs/accordion). */
	children?: PageBlockLike[];
}

export interface BlockAction {
	action: string;
	params: Record<string, unknown>;
}
export interface BlockEvents {
	[eventName: string]: BlockAction[];
}

/** Map the Studio style config (`config.style`, css_values) onto React CSS. */
export function styleToCss(style: Record<string, unknown>): CSSProperties {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(style)) {
		if (v === undefined || v === null || v === '') continue;
		const s = String(v);
		switch (k) {
			case 'bg':
				out.background = s;
				break;
			case 'radius':
				out.borderRadius = s;
				break;
			case 'fontSize':
				out.fontSize = s;
				break;
			default:
				out[k] = s; // margin, padding, width, color, textAlign, background, …
		}
	}
	return out;
}

/** Run a block's click actions (navigate / toast / dialog) at runtime. */
export function executeBlockEvents(events: unknown, notify: (msg: string) => void): void {
	if (!events || typeof events !== 'object') return;
	const list = (events as BlockEvents).onClick;
	if (!Array.isArray(list)) return;
	for (const ev of list) {
		const target = String(ev.params?.target ?? '');
		switch (ev.action) {
			case 'navigate':
				if (target) window.location.hash = target.startsWith('#') ? target : `#/${target.replace(/^\//, '')}`;
				break;
			case 'toast':
			case 'dialog':
				notify(String(ev.params?.message ?? ev.params?.title ?? ''));
				break;
		}
	}
}

/** Icon names used by info-row blocks — small inline map (design-system-agnostic).
 *  Unknown names fall back to Phone (a generic contact glyph). */
const INFO_ICONS: Record<string, LucideIcon> = {
	phone: Phone,
	'calendar-days': CalendarDays,
	calendar: CalendarDays,
	'map-pin': MapPin,
	map: MapPin,
	mail: Mail,
	clock: Clock,
	'dollar-sign': DollarSign,
	briefcase: Briefcase,
	star: Star,
	check: Check,
	x: X,
	info: Info,
	'building-2': Building2,
	users: Users,
};

/** Widget with a `bind` spec — resolve live data and pass it as `data`. */
function BoundWidget({
	def,
	config,
	bind,
	dataSource,
}: {
	def: WidgetDef;
	config: Record<string, unknown>;
	bind: BindingSpec;
	dataSource: DataSource;
}) {
	const { data, error, loading } = useBinding(bind, dataSource);
	if (error)
		return (
			<div
				style={{
					border: '1px solid var(--mmbix-status-error,#fecaca)',
					borderRadius: 8,
					padding: '0.5rem 0.7rem',
					fontSize: '0.72rem',
					color: 'var(--mmbix-status-error,#b91c1c)',
					background: 'color-mix(in oklab, var(--mmbix-status-error,#b91c1c) 8%, transparent)',
				}}
			>
				Data binding failed: {error}
			</div>
		);
	if (loading)
		return (
			<div
				style={{
					border: '1px dashed var(--mmbix-border, #d1d5db)',
					borderRadius: 8,
					padding: '0.5rem 0.7rem',
					fontSize: '0.72rem',
					color: '#9ca3af',
				}}
			>
				Loading data…
			</div>
		);
	return <def.Component {...config} data={data} />;
}

/** Render one page block. Data blocks (list/table/kpi) use the injected renderer.
 *  Containers (row/column/tabs/accordion) render their `children` recursively.
 *  Custom blocks (extension API) use the optional custom renderer. */
export function BlockView({
	block,
	renderDataBlock,
	renderCustomBlock,
	dataSource,
	notify,
}: {
	block: PageBlockLike;
	renderDataBlock?: (block: PageBlockLike) => ReactNode;
	renderCustomBlock?: (block: PageBlockLike) => ReactNode;
	/** Resolves widget `bind` specs to live data (frontend API / studio canvas). */
	dataSource?: DataSource | null;
	notify: (msg: string) => void;
}) {
	const c = block.config;
	if (c.hidden) return null;
	const style = styleToCss((c.style && typeof c.style === 'object' ? c.style : {}) as Record<string, unknown>);
	const children = (block.children ?? []).filter((child) => !child.config.hidden);
	// Nested blocks honor the 12-column grid when any child sets colSpan/colStart
	// (Studio width keys 1–6 / Shift+1–6 work at any depth). Children get a
	// span-wrapped grid cell; the parent switches flex → grid via childGridStyle.
	const hasChildSpan = children.some((c) => c.layout?.colSpan || c.layout?.colStart);
	const childNodes = children.map((child) =>
		hasChildSpan ? (
			<div
				key={child.id}
				style={{
					gridColumn: child.layout?.colStart ? `${child.layout.colStart} / span ${blockColSpan(child)}` : `span ${blockColSpan(child)}`,
					minWidth: 0,
				}}
			>
				<BlockView
					key={child.id}
					block={child}
					renderDataBlock={renderDataBlock}
					renderCustomBlock={renderCustomBlock}
					dataSource={dataSource}
					notify={notify}
				/>
			</div>
		) : (
			<BlockView
				key={child.id}
				block={child}
				renderDataBlock={renderDataBlock}
				renderCustomBlock={renderCustomBlock}
				dataSource={dataSource}
				notify={notify}
			/>
		),
	);
	// Column-style child container — flex by default, 12-column grid once any child has a span.
	const childGridStyle: Record<string, unknown> = hasChildSpan
		? { display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: Number(c.gap ?? 8) }
		: { display: 'flex', flexDirection: 'column', gap: Number(c.gap ?? 8) };

	if (isContainerType(block.type)) {
		const gap = Number(c.gap ?? 12);
		// Nested blocks honor the same 12-column grid when any child has an explicit
		// colSpan/colStart (Studio width keys 1–6 / Shift+1–6 work at any depth).
		const spanGrid = (cols: number) => (
			<div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, alignItems: 'flex-start', gap, ...style }}>
				{children.map((child) => (
					<div
						key={child.id}
						style={{
							gridColumn: child.layout?.colStart ? `${child.layout.colStart} / span ${blockColSpan(child)}` : `span ${blockColSpan(child)}`,
							minWidth: 0,
						}}
					>
						<BlockView
							key={child.id}
							block={child}
							renderDataBlock={renderDataBlock}
							renderCustomBlock={renderCustomBlock}
							dataSource={dataSource}
							notify={notify}
						/>
					</div>
				))}
			</div>
		);
		switch (block.type) {
			case 'row': {
				const hasSpan = children.some((c) => c.layout?.colSpan || c.layout?.colStart);
				if (hasSpan) return spanGrid(12);
				return (
					<div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap, flexWrap: 'wrap', ...style }}>
						{childNodes}
					</div>
				);
			}
			case 'column': {
				const hasSpan = children.some((c) => c.layout?.colSpan || c.layout?.colStart);
				if (hasSpan) return spanGrid(12);
				return <div style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>{childNodes}</div>;
			}
			case 'tabs': {
				const first = children[0]?.id ?? '';
				return (
					<Tabs defaultValue={first} className="w-full" style={style}>
						<TabsList variant="line">
							{children.map((child) => (
								<TabsTrigger key={child.id} value={child.id}>
									{String(child.config.label ?? child.label ?? 'Tab')}
								</TabsTrigger>
							))}
						</TabsList>
						{children.map((child) => (
							<TabsContent key={child.id} value={child.id}>
								<BlockView
									key={child.id}
									block={child}
									renderDataBlock={renderDataBlock}
									renderCustomBlock={renderCustomBlock}
									dataSource={dataSource}
									notify={notify}
								/>
							</TabsContent>
						))}
					</Tabs>
				);
			}
			case 'accordion':
				return (
					<Accordion style={style}>
						{children.map((child) => (
							<AccordionItem key={child.id} value={child.id}>
								<AccordionTrigger>{String(child.config.label ?? child.label ?? 'Section')}</AccordionTrigger>
								<AccordionContent>
									<BlockView
										key={child.id}
										block={child}
										renderDataBlock={renderDataBlock}
										renderCustomBlock={renderCustomBlock}
										dataSource={dataSource}
										notify={notify}
									/>
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				);
		}
	}

	if (
		block.type === 'list' ||
		block.type === 'table' ||
		block.type === 'kpi' ||
		block.type === 'chart' ||
		block.type === 'report' ||
		block.type === 'entity-card-grid' ||
		block.type === 'entity-form' ||
		block.type === 'kanban' ||
		block.type === 'calendar'
	) {
		return renderDataBlock ? renderDataBlock(block) : null;
	}

	// Code-first widgets — real React components from the shared registry
	// (type `widget:<name>`); the block config is spread as props. A `bind` spec
	// resolves live data through the host data source (reserved `data` prop).
	if (block.type.startsWith('widget:')) {
		const def = widgetDefOf(block.type);
		if (def) {
			const bind = (block.config as Record<string, unknown> | undefined)?.bind as BindingSpec | undefined;
			if (bind && dataSource) return <BoundWidget def={def} config={block.config} bind={bind} dataSource={dataSource} />;
			return <def.Component {...block.config} />;
		}
	}

	switch (block.type) {
		case 'section-header':
			return (
				<div style={{ ...style }}>
					<h3 style={{ margin: '0.25rem 0', fontSize: '1.05rem', fontWeight: 700, color: 'var(--mmbix-foreground, #1f2937)' }}>
						{String(c.text ?? '')}
					</h3>
				</div>
			);
		case 'links-card': {
			const links = Array.isArray(c.links) ? (c.links as Array<{ label?: string; target?: string }>) : [];
			return (
				<Card style={{ height: '100%', display: 'flex', flexDirection: 'column', ...style }}>
					<CardContent style={{ padding: '0.9rem 1.1rem', flex: 1 }}>
						<h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--mmbix-foreground, #1f2937)' }}>
							{String(c.title ?? 'Links')}
						</h4>
						<div style={{ display: 'flex', flexDirection: 'column' }}>
							{links.map((l, i) => {
								const t = String(l.target ?? '');
								const href = t.startsWith('#') ? t : `#/${t.replace(/^\//, '')}`;
								return (
									<a
										key={i}
										href={href}
										style={{
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: 8,
											padding: '0.28rem 0',
											color: 'var(--mmbix-primary, #2563eb)',
											textDecoration: 'none',
											fontSize: '0.85rem',
										}}
									>
										<span className="ellipsis" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
											{l.label ?? l.target}
										</span>
										<span style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)', flexShrink: 0 }}>↗</span>
									</a>
								);
							})}
							{links.length === 0 && (
								<span style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)', fontSize: '0.8rem' }}>No links configured.</span>
							)}
						</div>
					</CardContent>
				</Card>
			);
		}
		case 'text':
			return (
				<p style={{ margin: '0.25rem 0', color: 'var(--mmbix-muted-foreground, #374151)', lineHeight: 1.6, ...style }}>
					{String(c.content ?? '')}
				</p>
			);
		case 'heading': {
			const level = Math.min(Math.max(Number(c.level ?? 2), 1), 3) as 1 | 2 | 3;
			const sizes: Record<number, string> = { 1: '1.75rem', 2: '1.35rem', 3: '1.1rem' };
			const common = {
				fontSize: sizes[level] ?? '1.35rem',
				fontWeight: 700,
				color: 'var(--mmbix-foreground, #111827)',
				margin: '0.25rem 0',
				...style,
			};
			// Render the semantic heading element for the configured level (design ==
			// runtime: what the Studio preview shows is the tag the page renders).
			if (level === 1) return <h1 style={common}>{String(c.content ?? '')}</h1>;
			if (level === 3) return <h3 style={common}>{String(c.content ?? '')}</h3>;
			return <h2 style={common}>{String(c.content ?? '')}</h2>;
		}
		case 'button': {
			// A configured click action makes the button behave as an action (no link navigation).
			const clickList = (c.events && typeof c.events === 'object' ? (c.events as BlockEvents).onClick : undefined) ?? [];
			if (Array.isArray(clickList) && clickList.length > 0) {
				return (
					<span style={style}>
						<Button onClick={() => executeBlockEvents(c.events, notify)}>{String(c.label ?? 'Button')}</Button>
					</span>
				);
			}
			return (
				<a href={String(c.url ?? '#')} style={{ textDecoration: 'none', ...style }}>
					<Button>{String(c.label ?? 'Button')}</Button>
				</a>
			);
		}
		case 'card':
			return (
				<Card style={{ height: '100%', ...style }}>
					<CardContent style={{ padding: '1rem 1.25rem' }}>
						{c.title ? (
							<h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--mmbix-foreground, #1f2937)' }}>
								{String(c.title)}
							</h3>
						) : null}
						{childNodes.length > 0 ? <div style={{ ...childGridStyle, marginTop: c.title ? 10 : 0 }}>{childNodes}</div> : null}
					</CardContent>
				</Card>
			);
		case 'badge':
			return (
				<span style={style}>
					<Badge>{String(c.text ?? 'New')}</Badge>
				</span>
			);
		case 'alert':
			return (
				<div
					style={{
						padding: '0.5rem 0.7rem',
						borderRadius: 8,
						background: 'var(--mmbix-muted, #f3f4f6)',
						fontSize: '0.85rem',
						...style,
					}}
				>
					{String(c.text ?? '')}
				</div>
			);
		case 'image':
			return c.url ? (
				<img src={String(c.url)} alt={String(c.alt ?? '')} style={{ maxWidth: '100%', borderRadius: 6, ...style }} />
			) : (
				<div
					style={{
						padding: '1rem',
						border: '1px dashed var(--mmbix-border, #e5e7eb)',
						borderRadius: 6,
						color: 'var(--mmbix-muted-foreground, #9ca3af)',
						fontSize: '0.8rem',
						textAlign: 'center',
						...style,
					}}
				>
					Image
				</div>
			);
		case 'spacer':
			return <div style={{ height: Number(c.height ?? 24) }} />;
		case 'divider':
			return <div style={{ borderTop: '1px solid var(--mmbix-border, #e5e7eb)', ...style }} />;

		// ── New DS-component blocks (resolve layer) ──
		case 'grid': {
			const cols = Number(c.cols ?? 3);
			return (
				<div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: Number(c.gap ?? 16), ...style }}>
					{childNodes}
				</div>
			);
		}
		case 'avatar':
			return c.src ? (
				<Avatar size={(c.size as never) ?? 'default'}>
					<AvatarImage src={String(c.src)} alt={String(c.alt ?? 'User')} />
					<AvatarFallback>{String((c.fallback as string) ?? 'U')}</AvatarFallback>
				</Avatar>
			) : (
				<Avatar size={(c.size as never) ?? 'default'}>
					<AvatarFallback>{String((c.fallback as string) ?? 'U')}</AvatarFallback>
				</Avatar>
			);
		case 'skeleton':
			return <Skeleton style={{ width: String(c.width ?? '100%'), height: Number(c.height ?? 20), ...style }} />;
		case 'empty':
			return (
				<Empty style={style}>
					{c.media ? (
						<EmptyMedia>
							<img src={String(c.media)} alt="" style={{ maxWidth: '100%', height: 'auto' }} />
						</EmptyMedia>
					) : null}
					<EmptyHeader>
						<EmptyTitle>{String(c.title ?? 'No data')}</EmptyTitle>
						<EmptyDescription>{String(c.description ?? '')}</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>{childNodes}</EmptyContent>
				</Empty>
			);
		case 'progress':
			return <Progress value={Number(c.value ?? 50)} />;
		case 'choice-card': {
			// The renderer must honor the registry's own props — title + options
			// (click targets), not a bare div that ignores its config.
			const opts = Array.isArray(c.options) ? (c.options as Array<string | { value?: string; label?: string }>) : [];
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
					{c.title ? (
						<h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: 'var(--mmbix-foreground, #1f2937)' }}>{String(c.title)}</h4>
					) : null}
					{childNodes.length > 0 ? <div style={childGridStyle}>{childNodes}</div> : null}
					{opts.length > 0 ? (
						<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
							{opts.map((o, i) => {
								const value = typeof o === 'string' ? o : String(o.value ?? '');
								const label = typeof o === 'string' ? o : (o.label ?? value);
								return (
									<div
										key={i}
										style={{
											padding: '0.45rem 0.6rem',
											border: '1px solid var(--mmbix-border, #e5e7eb)',
											borderRadius: 8,
											fontSize: '0.8rem',
											cursor: 'pointer',
										}}
									>
										{label}
									</div>
								);
							})}
						</div>
					) : (
						<span style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
							Choice Card — add options in the inspector.
						</span>
					)}
				</div>
			);
		}
		case 'input':
			return <Input placeholder={String(c.placeholder ?? '')} disabled={c.disabled === true} style={style} />;
		case 'textarea':
			return <Textarea placeholder={String(c.placeholder ?? '')} rows={Number(c.rows ?? 3)} disabled={c.disabled === true} style={style} />;
		case 'checkbox':
			return (
				<Label style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
					<Checkbox checked={c.checked === true} />
					{String(c.label ?? 'Option')}
				</Label>
			);
		case 'switch':
			return (
				<Label style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
					<Switch checked={c.checked === true} />
					{String(c.label ?? 'Toggle')}
				</Label>
			);
		case 'toggle':
			return <Toggle pressed={c.pressed === true}>{String(c.label ?? 'Toggle')}</Toggle>;
		case 'radio-group': {
			const opts = Array.isArray(c.options) ? (c.options as Array<string | { value?: string; label?: string }>) : [];
			return (
				<RadioGroup value={String(c.value ?? '')} onValueChange={() => {}}>
					{opts.map((opt, i) => {
						const value = typeof opt === 'string' ? opt : String(opt.value ?? '');
						const label = typeof opt === 'string' ? opt : (opt.label ?? value);
						return (
							<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.1rem 0' }}>
								<RadioGroupItem value={value} id={`rg-${i}`} />
								<Label htmlFor={`rg-${i}`} style={{ fontSize: '0.8rem' }}>
									{label}
								</Label>
							</div>
						);
					})}
				</RadioGroup>
			);
		}
		case 'slider':
			return <Slider min={Number(c.min ?? 0)} max={Number(c.max ?? 100)} value={[Number(c.value ?? 50)]} />;
		case 'rating':
			return <Rating value={Number(c.value ?? 0)} stars={Number(c.max ?? 5)} />;
		case 'color-picker':
			return <ColorPicker value={String(c.value ?? '#3b82f6')} />;
		case 'search-box':
			return <SearchBox placeholder={String(c.placeholder ?? 'Search...')} />;
		case 'select': {
			const opts = Array.isArray(c.options) ? (c.options as Array<string | { value?: string; label?: string }>) : [];
			return (
				<NativeSelect defaultValue="" style={{ width: '100%', ...style }}>
					<NativeSelectOption value="" disabled>
						{String(c.placeholder ?? 'Select…')}
					</NativeSelectOption>
					{opts.map((o, i) => {
						const value = typeof o === 'string' ? o : String(o.value ?? '');
						const label = typeof o === 'string' ? o : (o.label ?? value);
						return (
							<NativeSelectOption key={i} value={value}>
								{label}
							</NativeSelectOption>
						);
					})}
				</NativeSelect>
			);
		}
		case 'combobox': {
			const opts = Array.isArray(c.options) ? (c.options as Array<string | { value?: string; label?: string }>) : [];
			const items = opts.map((o) => (typeof o === 'string' ? o : String(o.label ?? o.value ?? '')));
			return (
				<Combobox items={items} value={null} onValueChange={() => {}} onInputValueChange={() => {}} itemToStringLabel={(v) => String(v)}>
					<ComboboxInput showTrigger placeholder={String(c.placeholder ?? 'Search…')} style={{ width: '100%' }} />
					<ComboboxContent align="start" sideOffset={4} style={{ width: '100%' }}>
						<ComboboxList>
							{(item: string) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			);
		}
		case 'datepicker': {
			// Wire the config value (registry default { value: '' }) — a stored ISO
			// string becomes the Date the picker shows; empty stays uncontrolled.
			const raw = c.value;
			const date = typeof raw === 'string' && raw.trim() ? new Date(raw) : undefined;
			return (
				<DatePicker value={date && !Number.isNaN(date.getTime()) ? date : undefined} placeholder={String(c.placeholder ?? 'Pick a date')} />
			);
		}
		case 'tags-input':
			return (
				<TagsInput
					value={Array.isArray(c.tags) ? (c.tags as string[]) : []}
					onChange={() => {}}
					placeholder={String(c.placeholder ?? 'Add tag…')}
				/>
			);
		case 'breadcrumb':
			return (
				<Breadcrumb>
					<BreadcrumbList>
						{(Array.isArray(c.items) ? c.items : []).map((item, i) => {
							const it = item as { label?: string; target?: string };
							const isLast = i === (Array.isArray(c.items) ? c.items : []).length - 1;
							return (
								<div key={i} style={{ display: 'contents' }}>
									{i > 0 ? <BreadcrumbSeparator /> : null}
									<BreadcrumbItem>
										{isLast ? (
											<BreadcrumbPage>{it.label ?? ''}</BreadcrumbPage>
										) : (
											<BreadcrumbLink href={String(it.target ?? '#')}>{it.label ?? ''}</BreadcrumbLink>
										)}
									</BreadcrumbItem>
								</div>
							);
						})}
					</BreadcrumbList>
				</Breadcrumb>
			);
		case 'pagination': {
			const total = Number(c.total ?? 100);
			const pageSize = Number(c.pageSize ?? 10);
			return (
				<Pagination>
					<PaginationContent>
						<PaginationSummary from={1} to={Math.min(pageSize, total)} />
					</PaginationContent>
				</Pagination>
			);
		}
		case 'tooltip':
			return (
				<Tooltip>
					<TooltipTrigger>
						<span style={{ cursor: 'pointer', ...style }}>{String(c.label ?? 'Hover me')}</span>
					</TooltipTrigger>
					<TooltipContent>{String(c.content ?? 'Tooltip text')}</TooltipContent>
				</Tooltip>
			);
		case 'dialog':
		case 'drawer':
		case 'sheet':
		case 'popover':
		case 'hover-card':
		case 'toast':
			// Overlay blocks render as a static placeholder in the page flow; their
			// interactive shell is configured via events (open-dialog/toast etc.).
			return (
				<div style={{ ...style }}>
					{childNodes.length > 0 ? (
						<div style={childGridStyle}>{childNodes}</div>
					) : (
						<span style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
							{String(c.title ?? c.content ?? block.label ?? '')}
						</span>
					)}
				</div>
			);

		// ── New DS-component blocks (the full design-system catalog) ──
		case 'separator':
			return <Separator style={{ width: '100%', ...style }} />;
		case 'spinner':
			return <Spinner size={(c.size as number | string) ?? undefined} />;
		case 'kbd':
			return <Kbd>{String(c.text ?? 'Ctrl K')}</Kbd>;
		case 'aspect-ratio': {
			const [w, h] = String(c.ratio ?? '16/9').split('/');
			const ratio = Number(w) / Number(h) || 16 / 9;
			return (
				<AspectRatio ratio={ratio} style={{ width: '100%', maxWidth: 360, ...style }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							height: '100%',
							background: 'var(--mmbix-muted, #f3f4f6)',
							borderRadius: 8,
							fontSize: '0.78rem',
							color: 'var(--mmbix-muted-foreground, #9ca3af)',
						}}
					>
						{String(c.content ?? 'Aspect ratio')}
					</div>
				</AspectRatio>
			);
		}
		case 'button-group': {
			const buttons = Array.isArray(c.buttons) ? (c.buttons as string[]) : [];
			return (
				<ButtonGroup>
					{buttons.map((b, i) => (
						<Button key={i} size="sm" variant="outline">
							{b}
						</Button>
					))}
				</ButtonGroup>
			);
		}
		case 'input-group':
			return (
				<InputGroup>
					<InputGroupAddon align="inline-start">{String(c.addon ?? '@')}</InputGroupAddon>
					<InputGroupInput placeholder={String(c.placeholder ?? 'Input…')} />
				</InputGroup>
			);
		case 'field':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
					<Field>
						<Label style={{ fontSize: '0.78rem', fontWeight: 500 }}>{String(c.label ?? 'Label')}</Label>
					</Field>
					<Input placeholder={String(c.placeholder ?? 'Enter…')} />
				</div>
			);
		case 'input-otp': {
			const len = Math.min(Math.max(Number(c.length ?? 4), 2), 8);
			return (
				<InputOTP maxLength={len} value="" onChange={() => {}}>
					{Array.from({ length: len }).map((_, i) => (
						<InputOTPGroup key={i}>
							<InputOTPSlot index={i} />
						</InputOTPGroup>
					))}
				</InputOTP>
			);
		}
		case 'toggle-group': {
			const opts = Array.isArray(c.options) ? (c.options as string[]) : [];
			return (
				<ToggleGroup value={[]} onValueChange={() => {}}>
					{opts.map((o, i) => (
						<ToggleGroupItem key={i} value={o}>
							{o}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			);
		}
		case 'frame':
			return (
				<Frame title={String(c.title ?? '')} style={style}>
					<div style={{ fontSize: '0.82rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{String(c.content ?? '')}</div>
				</Frame>
			);
		case 'item':
			return (
				<Item>
					<ItemContent>
						<div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{String(c.title ?? 'Item')}</div>
						<div style={{ fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{String(c.description ?? '')}</div>
					</ItemContent>
				</Item>
			);
		case 'bubble':
			return <Bubble align={(c.side as 'start' | 'end') ?? 'start'}>{String(c.text ?? 'Hello!')}</Bubble>;
		case 'message':
			return <Message>{String(c.text ?? 'Message')}</Message>;
		case 'attachment':
			return (
				<Attachment>
					<AttachmentContent>
						<AttachmentTitle>{String(c.title ?? 'file.pdf')}</AttachmentTitle>
						<AttachmentDescription>{String(c.description ?? '')}</AttachmentDescription>
					</AttachmentContent>
				</Attachment>
			);
		case 'collapsible':
			return (
				<Collapsible style={style}>
					<CollapsibleTrigger>{String(c.title ?? 'More details')}</CollapsibleTrigger>
					<CollapsibleContent>{String(c.content ?? '')}</CollapsibleContent>
				</Collapsible>
			);
		case 'carousel': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<Carousel className="w-full max-w-md">
					<CarouselContent>
						{items.map((it, i) => (
							<CarouselItem key={i} className="basis-full">
								<div
									style={{
										padding: '1.5rem',
										background: 'var(--mmbix-muted, #f3f4f6)',
										borderRadius: 8,
										textAlign: 'center',
										fontSize: '0.85rem',
									}}
								>
									{it}
								</div>
							</CarouselItem>
						))}
					</CarouselContent>
					<CarouselPrevious />
					<CarouselNext />
				</Carousel>
			);
		}
		case 'command': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<Command style={{ maxWidth: 360, ...style }}>
					<CommandInput placeholder={String(c.placeholder ?? 'Type a command…')} />
					<CommandList>
						{items.map((it, i) => (
							<CommandItem key={i}>{it}</CommandItem>
						))}
					</CommandList>
				</Command>
			);
		}
		case 'message-scroller': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<ScrollArea style={{ maxHeight: 180, ...style }}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0.5rem' }}>
						{items.map((it, i) => (
							<Message key={i}>{it}</Message>
						))}
					</div>
				</ScrollArea>
			);
		}
		case 'alert-dialog':
			return (
				<AlertDialog>
					<AlertDialogTrigger render={<Button>{String(c.trigger ?? 'Open alert')}</Button>} />
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{String(c.title ?? 'Are you sure?')}</AlertDialogTitle>
							<AlertDialogDescription>{String(c.description ?? '')}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel variant="outline" size="sm">
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction variant="default" size="sm">
								Continue
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			);
		case 'dropdown-menu': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<DropdownMenu>
					<DropdownMenuTrigger render={<Button>{String(c.trigger ?? 'Open menu')}</Button>} />
					<DropdownMenuContent>
						<DropdownMenuLabel>{String(c.trigger ?? 'Menu')}</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{items.map((it, i) => (
							<DropdownMenuItem key={i}>{it}</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}
		case 'context-menu': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<ContextMenu>
					<ContextMenuTrigger>
						<span
							style={{
								display: 'inline-block',
								padding: '0.5rem 0.75rem',
								border: '1px dashed var(--mmbix-border, #d1d5db)',
								borderRadius: 8,
								fontSize: '0.8rem',
								color: 'var(--mmbix-muted-foreground, #6b7280)',
							}}
						>
							{String(c.trigger ?? 'Right-click here')}
						</span>
					</ContextMenuTrigger>
					<ContextMenuContent>
						{items.map((it, i) => (
							<ContextMenuItem key={i}>{it}</ContextMenuItem>
						))}
					</ContextMenuContent>
				</ContextMenu>
			);
		}
		case 'menubar': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<Menubar>
					{items.map((it, i) => (
						<MenubarMenu key={i}>
							<MenubarTrigger>{it}</MenubarTrigger>
							<MenubarContent>
								<div style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}>{it} action</div>
							</MenubarContent>
						</MenubarMenu>
					))}
				</Menubar>
			);
		}
		case 'navigation-menu': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<NavigationMenu>
					<NavigationMenuList>
						{items.map((it, i) => (
							<NavigationMenuItem key={i}>
								<NavigationMenuLink href="#">{it}</NavigationMenuLink>
							</NavigationMenuItem>
						))}
					</NavigationMenuList>
				</NavigationMenu>
			);
		}
		case 'resizable': {
			const panels = Array.isArray(c.panels) ? (c.panels as string[]) : ['Panel A', 'Panel B'];
			return (
				<ResizablePanelGroup orientation="horizontal" style={{ maxWidth: 480, ...style }}>
					{panels.map((p, i) => (
						<div key={i} style={{ display: 'contents' }}>
							{i > 0 && <ResizableHandle />}
							<ResizablePanel defaultSize={100 / panels.length}>
								<div
									style={{
										padding: '1rem',
										fontSize: '0.8rem',
										color: 'var(--mmbix-muted-foreground, #6b7280)',
										border: '1px solid var(--mmbix-border, #e5e7eb)',
										borderRadius: 8,
									}}
								>
									{p}
								</div>
							</ResizablePanel>
						</div>
					))}
				</ResizablePanelGroup>
			);
		}
		case 'scroll-area':
			return (
				<ScrollArea style={{ height: 140, ...style }}>
					<div style={{ padding: '0.6rem', fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
						{String(c.content ?? '')}
					</div>
				</ScrollArea>
			);
		case 'form':
			return (
				<div style={{ border: '1px solid var(--mmbix-border, #e5e7eb)', borderRadius: 10, padding: '0.9rem', ...style }}>
					{c.title ? <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', fontWeight: 600 }}>{String(c.title)}</h4> : null}
					<div style={childGridStyle}>
						{childNodes.length > 0 ? (
							childNodes
						) : (
							<span style={{ fontSize: '0.78rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
								{String(c.content ?? 'Form fields go here.')}
							</span>
						)}
					</div>
				</div>
			);
		case 'module-grid': {
			const modules = Array.isArray(c.modules) ? (c.modules as Array<Record<string, unknown>>) : [];
			return modules.length > 0 ? (
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, ...style }}>
					{modules.map((m, i) => (
						<div
							key={i}
							style={{
								padding: '0.6rem',
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								borderRadius: 8,
								textAlign: 'center',
								fontSize: '0.78rem',
								fontWeight: 500,
							}}
						>
							{String(m.name ?? m.title ?? 'Module')}
						</div>
					))}
				</div>
			) : (
				<span style={{ fontSize: '0.78rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
					Module grid — bind modules in the Data tab.
				</span>
			);
		}

		// ── App-level & special DS components ──
		case 'label':
			return <Label style={style}>{String(c.text ?? 'Label')}</Label>;
		case 'native-select': {
			const opts = Array.isArray(c.options) ? (c.options as Array<string | { value?: string; label?: string }>) : [];
			return (
				<NativeSelect defaultValue="" style={{ width: '100%', ...style }}>
					<NativeSelectOption value="" disabled>
						{String(c.placeholder ?? 'Select…')}
					</NativeSelectOption>
					{opts.map((o, i) => {
						const value = typeof o === 'string' ? o : String(o.value ?? '');
						const label = typeof o === 'string' ? o : (o.label ?? value);
						return (
							<NativeSelectOption key={i} value={value}>
								{label}
							</NativeSelectOption>
						);
					})}
				</NativeSelect>
			);
		}
		case 'marker':
			return (
				<div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
					<span
						style={{
							width: 12,
							height: 12,
							borderRadius: '50% 50% 50% 0',
							transform: 'rotate(-45deg)',
							background: 'var(--mmbix-primary, #2563eb)',
							flexShrink: 0,
						}}
					/>
					<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{String(c.title ?? 'Location')}</span>
				</div>
			);
		case 'sidebar': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<div style={{ display: 'flex', gap: 8, ...style }}>
					<div
						style={{
							width: 130,
							flexShrink: 0,
							borderRight: '1px solid var(--mmbix-border, #e5e7eb)',
							paddingRight: 8,
							display: 'flex',
							flexDirection: 'column',
							gap: 4,
						}}
					>
						{items.map((it, i) => (
							<span
								key={i}
								style={{
									fontSize: '0.76rem',
									fontWeight: i === 0 ? 600 : 400,
									color: i === 0 ? 'var(--mmbix-foreground, #111827)' : 'var(--mmbix-muted-foreground, #6b7280)',
								}}
							>
								{it}
							</span>
						))}
					</div>
					<div style={{ flex: 1, fontSize: '0.78rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>Sidebar content area</div>
				</div>
			);
		}
		case 'appshell': {
			const items = Array.isArray(c.items) ? (c.items as string[]) : [];
			return (
				<div style={{ border: '1px solid var(--mmbix-border, #e5e7eb)', borderRadius: 10, overflow: 'hidden', ...style }}>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							padding: '0.45rem 0.7rem',
							background: 'var(--mmbix-muted, #f3f4f6)',
							borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
						}}
					>
						<Badge variant="outline">{String(c.title ?? 'App')}</Badge>
						<span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>header</span>
					</div>
					<div style={{ display: 'flex', minHeight: 90 }}>
						<div
							style={{
								width: 110,
								flexShrink: 0,
								padding: '0.5rem',
								borderRight: '1px solid var(--mmbix-border, #e5e7eb)',
								display: 'flex',
								flexDirection: 'column',
								gap: 4,
							}}
						>
							{items.map((it, i) => (
								<span
									key={i}
									style={{
										fontSize: '0.7rem',
										fontWeight: i === 0 ? 600 : 400,
										color: i === 0 ? 'var(--mmbix-foreground, #111827)' : 'var(--mmbix-muted-foreground, #6b7280)',
									}}
								>
									{it}
								</span>
							))}
						</div>
						<div style={{ flex: 1, padding: '0.6rem', fontSize: '0.76rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
							Main content area
						</div>
					</div>
				</div>
			);
		}
		case 'datatable': {
			// Honest empty state — no hardcoded demo rows: this block is configured via
			// the registry defaults ({} — no collection bound), so render nothing until
			// a real data source is wired (see the Data tab in the Studio).
			return (
				<div
					style={{
						border: '1px dashed var(--mmbix-border, #d1d5db)',
						borderRadius: 8,
						padding: '0.75rem',
						fontSize: '0.78rem',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
						...style,
					}}
				>
					No collection bound — connect a data source in the Studio to see records.
				</div>
			);
		}
		case 'schema':
			return (
				<div
					style={{
						border: '1px dashed var(--mmbix-border, #d1d5db)',
						borderRadius: 8,
						padding: '0.75rem',
						fontSize: '0.78rem',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
						...style,
					}}
				>
					Schema-driven view — bind a collection in the Data tab to render a form/table from its schema.
				</div>
			);
		case 'locale-provider':
			return (
				<div
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 6,
						fontSize: '0.76rem',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
						...style,
					}}
				>
					<Badge variant="outline">Locale</Badge>
					<span>{String(c.locale ?? 'en-US')}</span>
				</div>
			);
		case 'theme-provider':
			return (
				<div
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 6,
						fontSize: '0.76rem',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
						...style,
					}}
				>
					<Badge variant="outline">Theme</Badge>
					<span>{String(c.theme ?? 'light')}</span>
				</div>
			);
		case 'media-panel':
			return (
				<MediaPanel
					initials={c.initials ? String(c.initials) : undefined}
					status={c.status ? String(c.status) : undefined}
					code={c.code ? String(c.code) : undefined}
					sub={c.sub ? String(c.sub) : undefined}
					style={style}
				/>
			);
		case 'info-row': {
			const Icon = INFO_ICONS[String(c.icon ?? '')] ?? Phone;
			return (
				<InfoRow
					icon={<Icon size={12} />}
					label={c.label ? String(c.label) : undefined}
					value={c.value ? String(c.value) : undefined}
					style={style}
				/>
			);
		}
		case 'counter-chip':
			return (
				<CounterChip
					label={c.label ? String(c.label) : undefined}
					count={Number(c.count ?? 0)}
					tone={c.tone ? String(c.tone) : 'neutral'}
					style={style}
				/>
			);
		default:
			// Extension API — unknown types delegate to the app's custom renderer.
			if (renderCustomBlock) return renderCustomBlock(block);
			return null;
	}
}
