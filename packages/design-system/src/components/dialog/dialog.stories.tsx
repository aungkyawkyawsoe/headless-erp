import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from './';
import { Button } from '../button';

/**
 * A modal dialog. Supports a header, footer, close button,
 * and nested title/description for accessible announcements.
 */
const meta: Meta<typeof Dialog> = {
	title: 'Components/Dialog',
	component: Dialog,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					"A modal dialog. Displays content in a focused overlay on top of the page, with optional header, footer, title, description, and close button. Use for confirmations, forms, or any content that requires the user's attention before continuing.",
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
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger render={<Button variant="outline">Open Dialog</Button>} />
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Dialog Title</DialogTitle>
						<DialogDescription>A dialog description provides context and information to the user.</DialogDescription>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">This is the dialog body content. You can place any content here.</p>
				</DialogContent>
			</Dialog>
		);
	},
};

// ── With Footer ─────────────────────────────────────────

export const WithFooter: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `DialogFooter` to display action buttons at the bottom of the dialog. Import `Button` from the button component for consistent styling.',
			},
		},
	},
	render: function WithFooterStory() {
		const [open, setOpen] = useState(false);
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger render={<Button variant="outline">Open with Footer</Button>} />
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Confirm Action</DialogTitle>
						<DialogDescription>Are you sure you want to proceed with this action?</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button>Confirm</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	},
};

// ── Without Close ────────────────────────────────────────

export const WithoutClose: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `showCloseButton={false}` on `DialogContent` to hide the default close (X) button in the top-right corner. Useful when you want to force the user to make a selection via footer buttons.',
			},
		},
	},
	render: function WithoutCloseStory() {
		const [open, setOpen] = useState(false);
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger render={<Button variant="outline">Open without Close</Button>} />
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>No Close Button</DialogTitle>
						<DialogDescription>This dialog does not have a close button in the top-right corner.</DialogDescription>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">You can still dismiss this dialog by pressing Escape or clicking the overlay.</p>
					<div className="flex justify-end">
						<Button variant="outline" onClick={() => setOpen(false)}>
							Dismiss
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		);
	},
};
