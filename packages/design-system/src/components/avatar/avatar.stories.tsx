import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount } from '.';
import { User, BadgeCheck } from 'lucide-react';

type AvatarArgs = {
	size: 'sm' | 'default' | 'lg';
	variant: 'circle' | 'square';
	src: string;
	alt: string;
	fallbackText: string;
	showBadge: boolean;
	badgeIcon: boolean;
};

const meta: Meta<AvatarArgs> = {
	title: 'Components/Avatar',
	component: Avatar,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'An image element with automatic fallback. Handles loading states, error recovery, and delayed fallback transitions. Supports sm, default (md), and lg sizes.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		size: {
			control: 'select',
			description: 'Avatar size preset',
			options: ['sm', 'default', 'lg'],
			table: { defaultValue: { summary: 'default' } },
		},
		variant: {
			control: 'select',
			description: 'Avatar shape variant',
			options: ['circle', 'square'],
			table: { defaultValue: { summary: 'circle' } },
		},
		src: {
			control: 'text',
			description: 'Image source URL',
			table: { category: 'Image' },
		},
		alt: {
			control: 'text',
			description: 'Image alt text',
			table: { category: 'Image' },
		},
		fallbackText: {
			control: 'text',
			description: 'Fallback initials or text',
			table: { category: 'Fallback' },
		},
		showBadge: {
			control: 'boolean',
			description: 'Show a badge',
			table: { category: 'Badge' },
		},
		badgeIcon: {
			control: 'boolean',
			description: 'Show icon inside badge',
			if: { arg: 'showBadge' },
			table: { category: 'Badge' },
		},
	},
	args: {
		size: 'default',
		variant: 'circle',
		src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=128&h=128&fit=crop&crop=face',
		alt: 'Avatar',
		fallbackText: 'U',
		showBadge: false,
		badgeIcon: false,
	},
	render: (args) => (
		<Avatar size={args.size} variant={args.variant}>
			<AvatarImage src={args.src} alt={args.alt} />
			<AvatarFallback>{args.fallbackText || <User size={16} />}</AvatarFallback>
			{args.showBadge && <AvatarBadge>{args.badgeIcon ? <BadgeCheck /> : null}</AvatarBadge>}
		</Avatar>
	),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Reliable Unsplash avatar URLs */
const AVATAR_1 = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=128&h=128&fit=crop&crop=face';
const AVATAR_2 = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=128&h=128&fit=crop&crop=face';
const AVATAR_3 = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=128&h=128&fit=crop&crop=face';
const AVATAR_4 = 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=128&h=128&fit=crop&crop=face';

const users = [
	{ src: AVATAR_1, initials: 'T' },
	{ src: AVATAR_2, initials: 'S' },
	{ src: AVATAR_3, initials: 'J' },
	{ src: AVATAR_4, initials: 'K' },
];

// ── Sizes ───────────────────────────────────────────────

export const AllSizes: Story = {
	args: {
		showBadge: true,
	},

	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex items-end gap-8">
			{(['sm', 'default', 'lg'] as const).map((s) => (
				<div key={s} className="flex flex-col items-center gap-3">
					<Avatar size={s}>
						<AvatarImage src={AVATAR_1} alt="User" />
						<AvatarFallback>U</AvatarFallback>
					</Avatar>
					<span className="text-xs text-muted-foreground">{s}</span>
				</div>
			))}
		</div>
	),
};

// ── Square Variants ──────────────────────────────────────

export const AllSquareSizes: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex items-end gap-8">
			{(['sm', 'default', 'lg'] as const).map((s) => (
				<div key={s} className="flex flex-col items-center gap-3">
					<Avatar variant="square" size={s}>
						<AvatarImage src={AVATAR_1} alt="User" />
						<AvatarFallback>U</AvatarFallback>
					</Avatar>
					<span className="text-xs text-muted-foreground">{s}</span>
				</div>
			))}
		</div>
	),
};

// ── Group ───────────────────────────────────────────────

export const Group: Story = {
	name: 'Avatar Group',
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex flex-col gap-8">
			<AvatarGroup>
				{users.map((u, i) => (
					<Avatar key={i} size="default">
						<AvatarImage src={u.src} alt={`User ${i + 1}`} />
						<AvatarFallback>{u.initials}</AvatarFallback>
					</Avatar>
				))}
				<AvatarGroupCount>+3</AvatarGroupCount>
			</AvatarGroup>
			<span className="text-xs text-muted-foreground">Group with count overflow</span>
		</div>
	),
};

// ── Badge ───────────────────────────────────────────────

export const BadgeDot: Story = {
	args: { src: AVATAR_1, showBadge: true },
};

// ── Basic ───────────────────────────────────────────────

export const FallbackIcon: Story = {
	args: { src: '/broken.jpg', alt: 'User', fallbackText: '' },
};

export const FallbackInitials: Story = {
	args: { src: '/broken.jpg', alt: 'User', fallbackText: 'AB' },
};

// ── Group (Small) ─────────────────────────────────────────

export const GroupSm: Story = {
	name: 'Group Small',
	parameters: { layout: 'padded' },
	render: () => (
		<AvatarGroup>
			{users.slice(0, 3).map((u, i) => (
				<Avatar key={i} size="sm">
					<AvatarImage src={u.src} alt={`User ${i + 1}`} />
					<AvatarFallback>{u.initials}</AvatarFallback>
				</Avatar>
			))}
			<AvatarGroupCount>+5</AvatarGroupCount>
		</AvatarGroup>
	),
};

// ── Square Variants ──────────────────────────────────────

export const Square: Story = {
	parameters: { layout: 'padded' },
	args: { variant: 'square' },
};

export const SquareGroup: Story = {
	name: 'Square Avatar Group',
	parameters: { layout: 'padded' },
	render: () => (
		<AvatarGroup>
			{users.map((u, i) => (
				<Avatar key={i} variant="square" size="default">
					<AvatarImage src={u.src} alt={`User ${i + 1}`} />
					<AvatarFallback>{u.initials}</AvatarFallback>
				</Avatar>
			))}
			<AvatarGroupCount>+3</AvatarGroupCount>
		</AvatarGroup>
	),
};

export const SquareWithBadge: Story = {
	name: 'Square with Badge',
	parameters: { layout: 'padded' },
	args: { variant: 'square', size: 'lg', showBadge: true, badgeIcon: true },
};

// ── Badge ───────────────────────────────────────────────

export const WithBadge: Story = {
	args: { size: 'lg', src: AVATAR_1, showBadge: true, badgeIcon: true },
};

// ── Basic ───────────────────────────────────────────────

export const WithImage: Story = {
	args: { src: AVATAR_1, alt: 'User', fallbackText: 'U' },
};
