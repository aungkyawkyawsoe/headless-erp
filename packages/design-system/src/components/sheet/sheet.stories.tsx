import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetClose } from './';
import { Button } from '@/button';
import { Label } from '@/label';
import { Input } from '@/input';

/**
 * Extends the Dialog component to display content that complements the main
 * content of the screen. Supports sliding in from top, right, bottom, or left.
 */
const meta: Meta<typeof Sheet> = {
	title: 'Components/Sheet',
	component: Sheet,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A sheet component. Displays content in a panel that slides in from the edge of the screen. Supports header, footer, title, description, close button, and configurable side. Use for side panels, navigation drawers, or any content that complements the main view.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A basic sheet with a trigger button, header, title, description, and body content. The sheet slides in from the right edge by default.',
			},
		},
	},
	render: function DefaultStory() {
		const [open, setOpen] = useState(false);
		return (
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetTrigger render={<Button variant="outline">Open Sheet</Button>} />
				<SheetContent>
					<SheetHeader>
						<SheetTitle>Sheet Title</SheetTitle>
						<SheetDescription>A sheet description provides context and information to the user.</SheetDescription>
					</SheetHeader>
					<div className="grid gap-4 px-4 py-2">
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="name" className="text-right">
								Name
							</Label>
							<Input id="name" defaultValue="Pedro Duarte" className="col-span-3" />
						</div>
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="username" className="text-right">
								Username
							</Label>
							<Input id="username" defaultValue="@peduarte" className="col-span-3" />
						</div>
					</div>
				</SheetContent>
			</Sheet>
		);
	},
};

// ── Side ────────────────────────────────────────────────

export const Side: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use the `side` prop on `SheetContent` to set the edge of the screen where the sheet appears. Values are `top`, `right`, `bottom`, or `left`.',
			},
		},
	},
	render: function SideStory() {
		const [side, setSide] = useState<'top' | 'right' | 'bottom' | 'left'>('right');
		const [open, setOpen] = useState(false);
		return (
			<div className="flex flex-col items-center gap-4">
				<div className="flex items-center gap-2">
					{(['top', 'right', 'bottom', 'left'] as const).map((s) => (
						<Button
							key={s}
							variant={side === s ? 'default' : 'outline'}
							size="sm"
							onClick={() => {
								setSide(s);
								setOpen(true);
							}}
						>
							{s.charAt(0).toUpperCase() + s.slice(1)}
						</Button>
					))}
				</div>
				<Sheet open={open} onOpenChange={setOpen}>
					<SheetContent side={side}>
						<SheetHeader>
							<SheetTitle>Edit Profile</SheetTitle>
							<SheetDescription>Make changes to your profile here. Click save when you are done.</SheetDescription>
						</SheetHeader>
						<div className="grid gap-4 px-4 py-2">
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor="side-name" className="text-right">
									Name
								</Label>
								<Input id="side-name" defaultValue="Pedro Duarte" className="col-span-3" />
							</div>
							<div className="grid grid-cols-4 items-center gap-4">
								<Label htmlFor="side-username" className="text-right">
									Username
								</Label>
								<Input id="side-username" defaultValue="@peduarte" className="col-span-3" />
							</div>
						</div>
						<SheetFooter>
							<SheetClose render={<Button variant="outline">Cancel</Button>} />
							<Button onClick={() => setOpen(false)}>Save</Button>
						</SheetFooter>
					</SheetContent>
				</Sheet>
			</div>
		);
	},
};

// ── No Close Button ─────────────────────────────────────

export const NoCloseButton: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `showCloseButton={false}` on `SheetContent` to hide the default close (X) button. Useful when you want users to take an action before dismissing the sheet.',
			},
		},
	},
	render: function NoCloseButtonStory() {
		const [open, setOpen] = useState(false);
		return (
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetTrigger render={<Button variant="outline">Open without Close</Button>} />
				<SheetContent showCloseButton={false}>
					<SheetHeader>
						<SheetTitle>No Close Button</SheetTitle>
						<SheetDescription>This sheet does not have a close button in the top-right corner.</SheetDescription>
					</SheetHeader>
					<div className="px-4 text-sm text-muted-foreground">
						You can still dismiss this sheet by pressing Escape or clicking the overlay.
					</div>
					<SheetFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							Dismiss
						</Button>
					</SheetFooter>
				</SheetContent>
			</Sheet>
		);
	},
};
