/**
 * ChartView — dependency-free SVG chart for the `chart` page block.
 * Renders aggregate rows (`[{ labelKey: '2026-01', valueKey: 1234 }, …]`)
 * as a line, bar, or pie chart — Frappe-workspace style.
 *
 * Colors resolve the design-system theme tokens (`--chart-1..5`, `--mmbix-*`)
 * with hex fallbacks, so charts stay readable in light AND dark mode.
 */

export interface ChartRow {
	[key: string]: unknown;
}

export type ChartType = 'line' | 'bar' | 'pie';

/** Series colors — design-system chart tokens (theme-aware) with hex fallbacks. */
const ACCENTS = [
	'var(--chart-1, #3b82f6)',
	'var(--chart-2, #f59e0b)',
	'var(--chart-3, #10b981)',
	'var(--chart-4, #ef4444)',
	'var(--chart-5, #8b5cf6)',
	'var(--chart-1, #06b6d4)',
	'var(--chart-2, #ec4899)',
	'var(--chart-3, #84cc16)',
];

const MUTED = 'var(--mmbix-muted-foreground, #9ca3af)';
const BORDER = 'var(--mmbix-border, #e5e7eb)';

function num(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

/** Simple line/area chart with x labels and a y grid (Frappe-chart look). */
function LineChart({ labels, values }: { labels: string[]; values: number[] }) {
	const w = 480;
	const h = 200;
	const pad = { top: 12, right: 12, bottom: 28, left: 34 };
	const innerW = w - pad.left - pad.right;
	const innerH = h - pad.top - pad.bottom;
	const max = Math.max(1, ...values);
	// A single data point renders centered (not wedged into the left corner),
	// so a one-month chart still reads as a chart with one value.
	const stepX = labels.length > 1 ? innerW / (labels.length - 1) : innerW / 2;
	const pts = values.map((v, i) => `${pad.left + i * stepX},${pad.top + innerH - (v / max) * innerH}`);
	// Gridlines: 5 rows with rounded labels.
	const grid: number[] = [];
	for (let i = 0; i <= 4; i++) grid.push(pad.top + (innerH / 4) * i);
	return (
		<svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
			{grid.map((y, i) => (
				<g key={i}>
					<line x1={pad.left} x2={w - pad.right} y1={y} y2={y} strokeWidth={1} style={{ stroke: BORDER }} />
					<text x={pad.left - 6} y={y + 3} fontSize={9} textAnchor="end" style={{ fill: MUTED }}>
						{Math.round(max - (max / 4) * i)}
					</text>
				</g>
			))}
			{values.length > 1 && (
				<polyline
					points={pts.join(' ')}
					fill="none"
					strokeWidth={2}
					strokeLinejoin="round"
					strokeLinecap="round"
					style={{ stroke: ACCENTS[0] }}
				/>
			)}
			{values.length === 1 && (
				<circle cx={pad.left} cy={pad.top + innerH - (values[0] / max) * innerH} r={3} style={{ fill: ACCENTS[0] }} />
			)}
			{labels.map((label, i) => (
				<text
					key={i}
					x={pad.left + i * stepX}
					y={h - 8}
					fontSize={9}
					textAnchor={labels.length === 1 ? 'middle' : i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
					style={{ fill: MUTED }}
				>
					{label}
				</text>
			))}
		</svg>
	);
}

/** Vertical bars with value labels. */
function BarChart({ labels, values }: { labels: string[]; values: number[] }) {
	const w = 480;
	const h = 200;
	const pad = { top: 18, right: 12, bottom: 28, left: 34 };
	const innerW = w - pad.left - pad.right;
	const innerH = h - pad.top - pad.bottom;
	const max = Math.max(1, ...values);
	const slot = values.length > 0 ? innerW / values.length : innerW;
	const barW = Math.max(6, Math.min(38, slot * 0.6));
	return (
		<svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
			{values.map((v, i) => {
				const barH = (v / max) * innerH;
				const x = pad.left + i * slot + (slot - barW) / 2;
				const y = pad.top + innerH - barH;
				return (
					<g key={i}>
						<rect x={x} y={y} width={barW} height={Math.max(barH, 1)} rx={2} style={{ fill: ACCENTS[i % ACCENTS.length] }} />
						<text x={x + barW / 2} y={y - 4} fontSize={9} textAnchor="middle" style={{ fill: 'var(--mmbix-muted-foreground, #6b7280)' }}>
							{v}
						</text>
						<text x={x + barW / 2} y={h - 8} fontSize={9} textAnchor="middle" style={{ fill: MUTED }}>
							{labels[i]}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

/** Donut-style pie. */
function PieChart({ labels, values }: { labels: string[]; values: number[] }) {
	const total = values.reduce((s, v) => s + v, 0);
	if (total <= 0) return <p style={{ color: MUTED, fontSize: '0.8rem' }}>No Data</p>;
	const cx = 100;
	const cy = 100;
	const r = 74;
	let angle = -Math.PI / 2;
	const arcs = values.map((v, i) => {
		const frac = v / total;
		const start = angle;
		const end = angle + frac * Math.PI * 2;
		angle = end;
		const x1 = cx + r * Math.cos(start);
		const y1 = cy + r * Math.sin(start);
		const x2 = cx + r * Math.cos(end);
		const y2 = cy + r * Math.sin(end);
		const large = frac > 0.5 ? 1 : 0;
		return { key: i, d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, color: ACCENTS[i % ACCENTS.length] };
	});
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
			<svg width={140} height={140} viewBox="0 0 200 200" style={{ flexShrink: 0 }}>
				{arcs.map((a) => (
					<path key={a.key} d={a.d} strokeWidth={1.5} style={{ fill: a.color, stroke: 'var(--mmbix-card, #fff)' }} />
				))}
			</svg>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
				{labels.map((label, i) => (
					<span
						key={i}
						style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--mmbix-foreground, #374151)' }}
					>
						<span style={{ width: 9, height: 9, borderRadius: 3, display: 'inline-block', background: ACCENTS[i % ACCENTS.length] }} />
						{label} — {values[i]}
					</span>
				))}
			</div>
		</div>
	);
}

/** Empty chart — the frame (gridlines + axis) stays visible so a chart widget
 *  never looks broken; the message renders INSIDE the chart area. */
function EmptyChart() {
	const w = 480;
	const h = 200;
	const pad = { top: 12, right: 12, bottom: 28, left: 34 };
	const innerH = h - pad.top - pad.bottom;
	const grid: number[] = [];
	for (let i = 0; i <= 4; i++) grid.push(pad.top + (innerH / 4) * i);
	return (
		<svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
			{grid.map((y, i) => (
				<g key={i}>
					<line x1={pad.left} x2={w - pad.right} y1={y} y2={y} strokeWidth={1} style={{ stroke: BORDER }} />
					<text x={pad.left - 6} y={y + 3} fontSize={9} textAnchor="end" style={{ fill: MUTED }}>
						{4 - i}
					</text>
				</g>
			))}
			<text
				x={pad.left + (w - pad.left - pad.right) / 2}
				y={pad.top + innerH / 2}
				fontSize={11}
				textAnchor="middle"
				style={{ fill: MUTED }}
			>
				No data yet
			</text>
		</svg>
	);
}

/**
 * Render aggregate rows as a chart. `labelKey`/`valueKey` default to the row's
 * first key (the group-by alias) and the first numeric column respectively.
 */
export function ChartView({
	rows,
	type,
	labelKey,
	valueKey,
}: {
	rows: ChartRow[];
	type?: ChartType;
	labelKey?: string;
	valueKey?: string;
	/** Accepted for API stability — charts currently size to their content. */
	height?: number;
}) {
	const labels = rows.map((r) => {
		const k = labelKey ?? Object.keys(r)[0] ?? '';
		return String(r[k] ?? '');
	});
	const values = rows.map((r) => {
		const k = valueKey ?? Object.keys(r).find((key) => key !== labelKey && typeof r[key] === 'number') ?? '';
		return num(r[k]);
	});
	if (rows.length === 0 || values.every((v) => v === 0)) {
		return <EmptyChart />;
	}
	return (
		<div style={{ width: '100%' }}>
			{type === 'pie' ? (
				<PieChart labels={labels} values={values} />
			) : type === 'bar' ? (
				<BarChart labels={labels} values={values} />
			) : (
				<LineChart labels={labels} values={values} />
			)}
		</div>
	);
}
