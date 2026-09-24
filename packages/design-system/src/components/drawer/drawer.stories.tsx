import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription } from './';
import { Button } from '../button';

/**
 * A slide-in drawer panel. Supports swipe gestures, snap
 * points, and nested drawers for multi-step workflows.
 */
const meta: Meta<typeof Drawer> = {
	title: 'Components/Drawer',
	component: Drawer,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A slide-in drawer panel. Slides up from the bottom by default with optional swipe-to-dismiss, snap points for multi-height layouts, and support for nested drawers. Commonly used for mobile navigation, filters, or quick-edit panels.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	render: function DefaultStory() {
		const [open, setOpen] = useState(false);
		return (
			<Drawer open={open} onOpenChange={setOpen}>
				<DrawerTrigger render={<Button variant="outline">Open Drawer</Button>} />
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Drawer Title</DrawerTitle>
						<DrawerDescription>Drawer description providing context for the content.</DrawerDescription>
					</DrawerHeader>
					<div className="flex-1 p-4">
						<p className="text-sm text-muted-foreground">
							This is the main drawer content area. You can place any content here, such as forms, details, or navigation options.
						</p>
					</div>
					<DrawerFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							Close
						</Button>
						<Button>Save</Button>
					</DrawerFooter>
				</DrawerContent>
			</Drawer>
		);
	},
};

// ── With Swipe Handle ────────────────────────────────────

export const WithSwipeHandle: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `showSwipeHandle={true}` on `Drawer` to render a visual drag handle at the top of the drawer. This provides a clear affordance for swipe-to-dismiss on mobile devices.',
			},
		},
	},
	render: function WithSwipeHandleStory() {
		const [open, setOpen] = useState(false);
		return (
			<Drawer open={open} onOpenChange={setOpen} showSwipeHandle={true}>
				<DrawerTrigger render={<Button variant="outline">Open Swipeable Drawer</Button>} />
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>Swipeable Drawer</DrawerTitle>
						<DrawerDescription>This drawer has a swipe handle at the top for drag-to-dismiss.</DrawerDescription>
					</DrawerHeader>
					<div className="flex-1 p-4">
						<p className="text-sm text-muted-foreground">Drag the handle or swipe down to close this drawer.</p>
					</div>
				</DrawerContent>
			</Drawer>
		);
	},
};
