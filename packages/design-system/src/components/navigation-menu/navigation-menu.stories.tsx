import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	navigationMenuTriggerStyle,
} from './';
import { CircleAlertIcon, CircleCheckIcon, CircleDashedIcon } from 'lucide-react';

/**
 * A collection of links for navigating websites.
 *
 * Supports dropdown content panels, indicators, keyboard navigation,
 * and responsive layouts.
 */
const meta: Meta<typeof NavigationMenu> = {
	title: 'Components/NavigationMenu',
	component: NavigationMenu,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A collection of links for navigating websites. Supports trigger-based dropdown panels with animated content transitions, keyboard navigation, and responsive layouts.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Helper component matching the docs' ListItem pattern
function ListItem({ className, title, children, href, ...props }: React.ComponentPropsWithoutRef<'li'> & { href: string; title: string }) {
	return (
		<li className={className} {...props}>
			<NavigationMenuLink
				render={
					<a href={href}>
						<div className="flex flex-col gap-1 text-sm">
							<div className="leading-none font-medium">{title}</div>
							<div className="line-clamp-2 text-muted-foreground">{children}</div>
						</div>
					</a>
				}
			/>
		</li>
	);
}

// ── Demo ─────────────────────────────────────────────────

const components: { title: string; href: string; description: string }[] = [
	{
		title: 'Alert Dialog',
		href: '#',
		description: 'A modal dialog that interrupts the user with important content and expects a response.',
	},
	{
		title: 'Hover Card',
		href: '#',
		description: 'For sighted users to preview content available behind a link.',
	},
	{
		title: 'Progress',
		href: '#',
		description: 'Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.',
	},
	{
		title: 'Scroll-area',
		href: '#',
		description: 'Visually or semantically separates content.',
	},
	{
		title: 'Tabs',
		href: '#',
		description: 'A set of layered sections of content—known as tab panels—that are displayed one at a time.',
	},
	{
		title: 'Tooltip',
		href: '#',
		description:
			'A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.',
	},
];

export const Demo: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<NavigationMenu>
			<NavigationMenuList>
				<NavigationMenuItem>
					<NavigationMenuTrigger>Getting started</NavigationMenuTrigger>
					<NavigationMenuContent>
						<ul className="w-96">
							<ListItem href="#" title="Introduction">
								Re-usable components built with Tailwind CSS.
							</ListItem>
							<ListItem href="#" title="Installation">
								How to install dependencies and structure your app.
							</ListItem>
							<ListItem href="#" title="Typography">
								Styles for headings, paragraphs, lists...etc
							</ListItem>
						</ul>
					</NavigationMenuContent>
				</NavigationMenuItem>
				<NavigationMenuItem className="hidden md:flex">
					<NavigationMenuTrigger>Components</NavigationMenuTrigger>
					<NavigationMenuContent>
						<ul className="grid w-100 gap-2 md:w-125 md:grid-cols-2 lg:w-150">
							{components.map((component) => (
								<ListItem key={component.title} title={component.title} href={component.href}>
									{component.description}
								</ListItem>
							))}
						</ul>
					</NavigationMenuContent>
				</NavigationMenuItem>
				<NavigationMenuItem>
					<NavigationMenuTrigger>With Icon</NavigationMenuTrigger>
					<NavigationMenuContent>
						<ul className="grid w-50">
							<li>
								<NavigationMenuLink
									render={
										<a href="#" className="flex-row items-center gap-2">
											<CircleAlertIcon />
											Backlog
										</a>
									}
								/>
								<NavigationMenuLink
									render={
										<a href="#" className="flex-row items-center gap-2">
											<CircleDashedIcon />
											To Do
										</a>
									}
								/>
								<NavigationMenuLink
									render={
										<a href="#" className="flex-row items-center gap-2">
											<CircleCheckIcon />
											Done
										</a>
									}
								/>
							</li>
						</ul>
					</NavigationMenuContent>
				</NavigationMenuItem>
				<NavigationMenuItem>
					<NavigationMenuLink className={navigationMenuTriggerStyle()} render={<a href="#">Docs</a>} />
				</NavigationMenuItem>
			</NavigationMenuList>
		</NavigationMenu>
	),
};

// ── Link Component ───────────────────────────────────────

export const LinkComponent: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Use the `render` prop to compose a custom link component. The `navigationMenuTriggerStyle()` function provides the correct trigger styling for direct links that don't open a content panel.",
			},
		},
	},
	render: () => (
		<NavigationMenu>
			<NavigationMenuList>
				<NavigationMenuItem>
					<NavigationMenuLink className={navigationMenuTriggerStyle()} render={<a href="#">Documentation</a>} />
				</NavigationMenuItem>
				<NavigationMenuItem>
					<NavigationMenuLink className={navigationMenuTriggerStyle()} render={<a href="#">Components</a>} />
				</NavigationMenuItem>
			</NavigationMenuList>
		</NavigationMenu>
	),
};
