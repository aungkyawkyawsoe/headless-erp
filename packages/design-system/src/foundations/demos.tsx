// Reusable demo components for the Foundations MDX pages.
// Kept in a separate file so the MDX stays clean and the demos remain
// consistent with the actual design tokens.
import * as React from 'react';

import { Button } from '@/button';
import { Input } from '@/input';

const swatches = [
	{ name: 'Background', var: '--background' },
	{ name: 'Foreground', var: '--foreground' },
	{ name: 'Card', var: '--card' },
	{ name: 'Card Foreground', var: '--card-foreground' },
	{ name: 'Popover', var: '--popover' },
	{ name: 'Popover Foreground', var: '--popover-foreground' },
	{ name: 'Primary', var: '--primary' },
	{ name: 'Primary Foreground', var: '--primary-foreground' },
	{ name: 'Secondary', var: '--secondary' },
	{ name: 'Secondary Foreground', var: '--secondary-foreground' },
	{ name: 'Muted', var: '--muted' },
	{ name: 'Muted Foreground', var: '--muted-foreground' },
	{ name: 'Accent', var: '--accent' },
	{ name: 'Accent Foreground', var: '--accent-foreground' },
	{ name: 'Destructive', var: '--destructive' },
	{ name: 'Border', var: '--border' },
	{ name: 'Input', var: '--input' },
	{ name: 'Ring', var: '--ring' },
	{ name: 'Surface Floating', var: '--surface-floating' },
	{ name: 'Overlay Hover', var: '--overlay-hover' },
	{ name: 'Overlay Active', var: '--overlay-active' },
];

const statusColors = [
	{ name: 'Success', var: '--status-success' },
	{ name: 'Warning', var: '--status-warning' },
	{ name: 'Error', var: '--status-error' },
	{ name: 'Info', var: '--status-info' },
];

const chartColors = [
	{ name: 'Chart 1', var: '--chart-1' },
	{ name: 'Chart 2', var: '--chart-2' },
	{ name: 'Chart 3', var: '--chart-3' },
	{ name: 'Chart 4', var: '--chart-4' },
	{ name: 'Chart 5', var: '--chart-5' },
];

const shadows = [
	{ name: 'Sm', className: 'shadow-sm' },
	{ name: 'Default', className: 'shadow' },
	{ name: 'Md', className: 'shadow-md' },
	{ name: 'Lg', className: 'shadow-lg' },
	{ name: 'Xl', className: 'shadow-xl' },
	{ name: '2xl', className: 'shadow-2xl' },
];

const radii = [
	{ name: '4xl', var: '--radius-4xl', size: 24 },
	{ name: '3xl', var: '--radius-3xl', size: 20 },
	{ name: '2xl', var: '--radius-2xl', size: 16 },
	{ name: 'xl', var: '--radius-xl', size: 12 },
	{ name: 'lg', var: '--radius-lg', size: 10 },
	{ name: 'md', var: '--radius-md', size: 8 },
	{ name: 'sm', var: '--radius-sm', size: 3 },
];

function SwatchCard({ name, varName, size = 80 }: { name: string; varName: string; size?: number }) {
	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				gap: 8,
			}}
		>
			<div
				style={{
					width: size,
					height: size,
					borderRadius: 8,
					background: `var(${varName})`,
					border: '1px solid var(--border)',
				}}
			/>
			<span style={{ fontSize: 12, fontFamily: 'monospace' }}>{varName}</span>
			<span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{name}</span>
		</div>
	);
}

export function ColorSwatches() {
	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
			{swatches.map((s) => (
				<SwatchCard key={s.var} name={s.name} varName={s.var} />
			))}
		</div>
	);
}

export function StatusColors() {
	return (
		<div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
			{statusColors.map((s) => (
				<SwatchCard key={s.var} name={s.name} varName={s.var} size={64} />
			))}
		</div>
	);
}

export function ChartColorDots() {
	return (
		<div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
			{chartColors.map((c) => (
				<div
					key={c.var}
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 8,
					}}
				>
					<div
						style={{
							width: 64,
							height: 64,
							borderRadius: '50%',
							background: `var(${c.var})`,
						}}
					/>
					<span style={{ fontSize: 11, fontFamily: 'monospace' }}>{c.var}</span>
				</div>
			))}
		</div>
	);
}

export function ShadowLevels() {
	return (
		<div
			style={{
				display: 'flex',
				gap: 24,
				flexWrap: 'wrap',
				alignItems: 'flex-start',
			}}
		>
			{shadows.map((s) => (
				<div
					key={s.name}
					className={s.className}
					style={{
						width: 120,
						height: 120,
						borderRadius: 12,
						background: 'var(--card)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						fontSize: 13,
						fontWeight: 500,
					}}
				>
					{s.name}
				</div>
			))}
		</div>
	);
}

export function RadiusScale() {
	return (
		<div
			style={{
				display: 'flex',
				gap: 16,
				alignItems: 'flex-end',
				flexWrap: 'wrap',
			}}
		>
			{radii.map((r) => (
				<div
					key={r.var}
					style={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 8,
					}}
				>
					<div
						style={{
							width: 64,
							height: 64,
							background: 'var(--primary)',
							borderRadius: `var(${r.var})`,
						}}
					/>
					<span style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.var}</span>
					<span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{r.name}</span>
				</div>
			))}
		</div>
	);
}

export function FocusRingDemo() {
	return (
		<div
			style={{
				display: 'flex',
				gap: 24,
				flexDirection: 'column',
				alignItems: 'center',
			}}
		>
			<p
				style={{
					fontSize: 14,
					color: 'var(--muted-foreground)',
					textAlign: 'center',
					margin: 0,
				}}
			>
				Tabbing to these elements will show the focus ring.
			</p>
			<div
				style={{
					display: 'flex',
					gap: 12,
					flexWrap: 'wrap',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<Button>Tab to focus</Button>
				<Button variant="outline">Outline button</Button>
				<Button variant="secondary">Secondary button</Button>
				<Button variant="ghost">Ghost button</Button>
			</div>
			<Input placeholder="Tab to focus input" style={{ width: 220 }} />
			<div
				tabIndex={0}
				className="focus-visible:ring-4 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:outline-none"
				style={{
					padding: '20px 40px',
					borderRadius: 'var(--radius-md)',
					border: '1px dashed var(--border)',
					fontSize: 13,
					color: 'var(--muted-foreground)',
					cursor: 'default',
				}}
			>
				Focusable div — ring-4 with 50% opacity
			</div>
		</div>
	);
}

export function TypeScale() {
	const styles: React.CSSProperties = {
		margin: 0,
		fontFamily: 'var(--font-sans)',
	};
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<p style={{ ...styles, fontSize: 48, fontWeight: 700, lineHeight: 1.1 }}>Display</p>
			<p style={{ ...styles, fontSize: 30, fontWeight: 600, lineHeight: 1.2 }}>Heading 1</p>
			<p style={{ ...styles, fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>Heading 2</p>
			<p style={{ ...styles, fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>Heading 3</p>
			<p style={{ ...styles, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>Heading 4</p>
			<p
				style={{
					...styles,
					fontSize: 14,
					lineHeight: 1.6,
					color: 'var(--foreground)',
				}}
			>
				Body paragraph — regular text used across the interface.
			</p>
			<p
				style={{
					...styles,
					fontSize: 16,
					lineHeight: 1.6,
					color: 'var(--muted-foreground)',
				}}
			>
				Lead text
			</p>
			<p style={{ ...styles, fontSize: 12, lineHeight: 1.5 }}>Small</p>
			<p style={{ ...styles, fontSize: 14, color: 'var(--muted-foreground)' }}>Muted text</p>
		</div>
	);
}

export function FontFamilyDemo() {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<p style={{ fontFamily: 'var(--font-sans)', fontSize: 18, margin: 0 }}>Sans — Inter Variable / Noto Sans Myanmar</p>
			<p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, margin: 0 }}>Mono — Geist Mono / Noto Sans Mono</p>
			<p style={{ fontFamily: 'var(--font-sans)', fontSize: 18, margin: 0 }}>
				မြန်မာစာ — ပြောစကား၊ နားစကား နှစ်မျိုးလုံးကို ပံ့ပိုးပေးပါသည်။
			</p>
		</div>
	);
}
