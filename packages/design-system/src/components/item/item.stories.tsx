import type { Meta, StoryObj } from '@storybook/react-vite';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemMedia, ItemTitle } from './';
import { BadgeCheckIcon, ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, InboxIcon, PlusIcon, ShieldAlertIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/avatar';
import { Button } from '@/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/dropdown-menu';

/**
 * A versatile component for displaying content with media, title,
 * description, and actions.
 */
const meta: Meta<typeof Item> = {
	title: 'Components/Item',
	component: Item,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A straightforward flex container that can house nearly any type of content. Use it to display a title, description, and actions. Group it with `ItemGroup` to create a list of items.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Demo ─────────────────────────────────────────────────

export const Demo: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="flex w-full max-w-md flex-col gap-6">
			<Item variant="outline">
				<ItemContent>
					<ItemTitle>Basic Item</ItemTitle>
					<ItemDescription>A simple item with title and description.</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button variant="outline" size="sm">
						Action
					</Button>
				</ItemActions>
			</Item>
			<Item
				variant="outline"
				size="sm"
				render={
					<a href="#">
						<ItemMedia>
							<BadgeCheckIcon className="size-5" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>Your profile has been verified.</ItemTitle>
						</ItemContent>
						<ItemActions>
							<ChevronRightIcon className="size-4" />
						</ItemActions>
					</a>
				}
			/>
		</div>
	),
};

// ── Variant ──────────────────────────────────────────────

export const Variant: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use the `variant` prop to change the visual style of the item. Available variants are `default`, `outline`, and `muted`.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-md flex-col gap-6">
			<Item>
				<ItemMedia variant="icon">
					<InboxIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Default Variant</ItemTitle>
					<ItemDescription>Transparent background with no border.</ItemDescription>
				</ItemContent>
			</Item>
			<Item variant="outline">
				<ItemMedia variant="icon">
					<InboxIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Outline Variant</ItemTitle>
					<ItemDescription>Outlined style with a visible border.</ItemDescription>
				</ItemContent>
			</Item>
			<Item variant="muted">
				<ItemMedia variant="icon">
					<InboxIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Muted Variant</ItemTitle>
					<ItemDescription>Muted background for secondary content.</ItemDescription>
				</ItemContent>
			</Item>
		</div>
	),
};

// ── Size ─────────────────────────────────────────────────

export const Size: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use the `size` prop to change the size of the item. Available sizes are `default`, `sm`, and `xs`.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-md flex-col gap-6">
			<Item variant="outline">
				<ItemMedia variant="icon">
					<InboxIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Default Size</ItemTitle>
					<ItemDescription>The standard size for most use cases.</ItemDescription>
				</ItemContent>
			</Item>
			<Item variant="outline" size="sm">
				<ItemMedia variant="icon">
					<InboxIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Small Size</ItemTitle>
					<ItemDescription>A compact size for dense layouts.</ItemDescription>
				</ItemContent>
			</Item>
			<Item variant="outline" size="xs">
				<ItemMedia variant="icon">
					<InboxIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Extra Small Size</ItemTitle>
					<ItemDescription>The most compact size available.</ItemDescription>
				</ItemContent>
			</Item>
		</div>
	),
};

// ── Icon ─────────────────────────────────────────────────

export const Icon: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `ItemMedia` with `variant="icon"` to display an icon alongside the title and description.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-md flex-col gap-6">
			<Item variant="outline">
				<ItemMedia variant="icon">
					<ShieldAlertIcon />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Security Alert</ItemTitle>
					<ItemDescription>New login detected from unknown device.</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button variant="outline" size="sm">
						Review
					</Button>
				</ItemActions>
			</Item>
		</div>
	),
};

// ── Avatar ───────────────────────────────────────────────

export const AvatarStory: Story = {
	name: 'Avatar',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `ItemMedia` to display an avatar. You can use any component such as `Avatar` from the avatar component set.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-lg flex-col gap-6">
			<Item variant="outline">
				<ItemMedia>
					<Avatar className="size-10">
						<AvatarImage src="https://github.com/evilrabbit.png" />
						<AvatarFallback>ER</AvatarFallback>
					</Avatar>
				</ItemMedia>
				<ItemContent>
					<ItemTitle>Evil Rabbit</ItemTitle>
					<ItemDescription>Last seen 5 months ago</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button size="icon-sm" variant="outline" className="rounded-full" aria-label="Invite">
						<PlusIcon />
					</Button>
				</ItemActions>
			</Item>
			<Item variant="outline">
				<ItemMedia>
					<div className="flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background *:data-[slot=avatar]:grayscale">
						<Avatar className="hidden sm:flex">
							<AvatarImage src="https://github.com/mmbix.png" alt="@mmbix" />
							<AvatarFallback>MM</AvatarFallback>
						</Avatar>
						<Avatar className="hidden sm:flex">
							<AvatarImage src="https://github.com/maxleiter.png" alt="@maxleiter" />
							<AvatarFallback>LR</AvatarFallback>
						</Avatar>
						<Avatar>
							<AvatarImage src="https://github.com/evilrabbit.png" alt="@evilrabbit" />
							<AvatarFallback>ER</AvatarFallback>
						</Avatar>
					</div>
				</ItemMedia>
				<ItemContent>
					<ItemTitle>No Team Members</ItemTitle>
					<ItemDescription>Invite your team to collaborate on this project.</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Button size="sm" variant="outline">
						Invite
					</Button>
				</ItemActions>
			</Item>
		</div>
	),
};

// ── Image ────────────────────────────────────────────────

export const ImageStory: Story = {
	name: 'Image',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `ItemMedia` with `variant="image"` to display an image alongside content. Combine with `ItemGroup` for lists.',
			},
		},
	},
	render: () => {
		const music = [
			{
				title: 'Midnight City Lights',
				artist: 'Neon Dreams',
				album: 'Electric Nights',
				duration: '3:45',
			},
			{
				title: 'Coffee Shop Conversations',
				artist: 'The Morning Brew',
				album: 'Urban Stories',
				duration: '4:05',
			},
			{
				title: 'Digital Rain',
				artist: 'Cyber Symphony',
				album: 'Binary Beats',
				duration: '3:30',
			},
		];

		return (
			<div className="flex w-full max-w-md flex-col gap-6">
				<ItemGroup className="gap-4">
					{music.map((song) => (
						<Item
							key={song.title}
							variant="outline"
							role="listitem"
							render={
								<a href="#">
									<ItemMedia variant="image">
										<img
											src={`https://avatar.vercel.sh/${song.title}`}
											alt={song.title}
											width={32}
											height={32}
											className="object-cover grayscale"
										/>
									</ItemMedia>
									<ItemContent>
										<ItemTitle className="line-clamp-1">
											{song.title} - <span className="text-muted-foreground">{song.album}</span>
										</ItemTitle>
										<ItemDescription>{song.artist}</ItemDescription>
									</ItemContent>
									<ItemContent className="flex-none text-center">
										<ItemDescription>{song.duration}</ItemDescription>
									</ItemContent>
								</a>
							}
						/>
					))}
				</ItemGroup>
			</div>
		);
	},
};

// ── Group ────────────────────────────────────────────────

export const Group: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `ItemGroup` to group related items together. Use `ItemSeparator` to add separators between items.',
			},
		},
	},
	render: () => {
		const people = [
			{
				username: 'mmbix',
				avatar: 'https://github.com/mmbix.png',
				email: 'mmbix@example.com',
			},
			{
				username: 'maxleiter',
				avatar: 'https://github.com/maxleiter.png',
				email: 'maxleiter@vercel.com',
			},
			{
				username: 'evilrabbit',
				avatar: 'https://github.com/evilrabbit.png',
				email: 'evilrabbit@vercel.com',
			},
		];

		return (
			<ItemGroup className="max-w-sm">
				{people.map((person) => (
					<Item key={person.username} variant="outline">
						<ItemMedia>
							<Avatar>
								<AvatarImage src={person.avatar} className="grayscale" />
								<AvatarFallback>{person.username.charAt(0)}</AvatarFallback>
							</Avatar>
						</ItemMedia>
						<ItemContent className="gap-1">
							<ItemTitle>{person.username}</ItemTitle>
							<ItemDescription>{person.email}</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button variant="ghost" size="icon" className="rounded-full">
								<PlusIcon />
							</Button>
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
		);
	},
};

// ── Header ───────────────────────────────────────────────

export const Header: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `ItemHeader` to add a header above the item content. Headers span the full width and can include titles and actions.',
			},
		},
	},
	render: () => {
		const models = [
			{
				name: 'v0-1.5-sm',
				description: 'Everyday tasks and UI generation.',
				image: 'v0-1.5-sm',
			},
			{
				name: 'v0-1.5-lg',
				description: 'Advanced thinking or reasoning.',
				image: 'v0-1.5-lg',
			},
			{
				name: 'v0-2.0-mini',
				description: 'Open Source model for everyone.',
				image: 'v0-2.0-mini',
			},
		];

		return (
			<ItemGroup className="max-w-md">
				{models.map((model) => (
					<Item key={model.name} variant="outline">
						<ItemHeader>
							<ItemTitle>{model.name}</ItemTitle>
						</ItemHeader>
						<ItemMedia variant="image">
							<img
								src={`https://avatar.vercel.sh/${model.image}`}
								alt={model.name}
								width={40}
								height={40}
								className="size-10 object-cover grayscale"
							/>
						</ItemMedia>
						<ItemContent>
							<ItemDescription>{model.description}</ItemDescription>
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
		);
	},
};

// ── Link ─────────────────────────────────────────────────

export const Link: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use the `render` prop to render the item as a link. The hover and focus states will be applied to the anchor element.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-md flex-col gap-4">
			<Item
				render={
					<a href="#">
						<ItemContent>
							<ItemTitle>Visit our documentation</ItemTitle>
							<ItemDescription>Learn how to get started with our components.</ItemDescription>
						</ItemContent>
						<ItemActions>
							<ChevronRightIcon className="size-4" />
						</ItemActions>
					</a>
				}
			/>
			<Item
				variant="outline"
				render={
					<a href="#" target="_blank" rel="noopener noreferrer">
						<ItemContent>
							<ItemTitle>External resource</ItemTitle>
							<ItemDescription>Opens in a new tab with security attributes.</ItemDescription>
						</ItemContent>
						<ItemActions>
							<ExternalLinkIcon className="size-4" />
						</ItemActions>
					</a>
				}
			/>
		</div>
	),
};

// ── Dropdown ─────────────────────────────────────────────

export const Dropdown: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Use `Item` inside dropdown menus. The `size="xs"` variant is designed for compact menu layouts.',
			},
		},
	},
	render: () => {
		const people = [
			{
				username: 'mmbix',
				avatar: 'https://github.com/mmbix.png',
				email: 'mmbix@example.com',
			},
			{
				username: 'maxleiter',
				avatar: 'https://github.com/maxleiter.png',
				email: 'maxleiter@vercel.com',
			},
			{
				username: 'evilrabbit',
				avatar: 'https://github.com/evilrabbit.png',
				email: 'evilrabbit@vercel.com',
			},
		];

		return (
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="outline">
							Select <ChevronDownIcon />
						</Button>
					}
				/>
				<DropdownMenuContent className="w-56" align="end">
					<DropdownMenuGroup>
						{people.map((person) => (
							<DropdownMenuItem key={person.username}>
								<Item size="xs" className="w-full p-2">
									<ItemMedia>
										<Avatar className="size-6.5">
											<AvatarImage src={person.avatar} className="grayscale" />
											<AvatarFallback>{person.username.charAt(0)}</AvatarFallback>
										</Avatar>
									</ItemMedia>
									<ItemContent className="gap-0">
										<ItemTitle>{person.username}</ItemTitle>
										<ItemDescription className="leading-none">{person.email}</ItemDescription>
									</ItemContent>
								</Item>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
		);
	},
};
