import type { Meta, StoryObj } from '@storybook/react-vite';
import { toast } from './';
import { Button } from '../button';

/**
 * A toast notification system for showing transient messages.
 *
 * Place `<Toaster />` once in your layout, then call `toast.add()` from
 * anywhere to fire a notification.
 *
 * > **Note:** `<Toaster />` is already rendered globally in `.storybook/preview.tsx`,
 * > so toast stories only need to call `toast.add()` — no need to wrap.
 */
const meta: Meta = {
	title: 'Components/Toast',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A toast notification system. Add `<Toaster />` to your layout, then use the `toast` manager to fire notifications: `toast.add({ title, description, type })`. Supports success, info, warning, error, and loading types, plus action buttons and promise-based workflows.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// ── Types ──────────────────────────────────────────────

export const Types: Story = {
	render: () => (
		<div className="flex flex-wrap gap-2">
			<Button
				variant="outline"
				onClick={() =>
					toast.add({
						title: 'Success',
						description: 'Operation completed successfully.',
						type: 'success',
					})
				}
			>
				Success
			</Button>
			<Button
				variant="outline"
				onClick={() =>
					toast.add({
						title: 'Info',
						description: 'You have 3 new messages.',
						type: 'info',
					})
				}
			>
				Info
			</Button>
			<Button
				variant="outline"
				onClick={() =>
					toast.add({
						title: 'Warning',
						description: 'Your session will expire in 5 minutes.',
						type: 'warning',
					})
				}
			>
				Warning
			</Button>
			<Button
				variant="outline"
				onClick={() =>
					toast.add({
						title: 'Error',
						description: 'Failed to save changes. Please try again.',
						type: 'error',
					})
				}
			>
				Error
			</Button>
			<Button
				variant="outline"
				onClick={() =>
					toast.add({
						title: 'Loading',
						description: 'Uploading file...',
						type: 'loading',
					})
				}
			>
				Loading
			</Button>
		</div>
	),
};

// ── Default (simple success) ───────────────────────────

export const Default: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() =>
				toast.add({
					title: 'Event created',
					description: 'Sunday, December 3 at 9:00 AM',
				})
			}
		>
			Show Toast
		</Button>
	),
};

// ── With action ────────────────────────────────────────

export const WithAction: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() => {
				const id = toast.add({
					title: 'Event created',
					description: 'Sunday, December 3 at 9:00 AM',
					actionProps: {
						children: 'Undo',
						onClick() {
							toast.close(id);
						},
					},
				});
			}}
		>
			Show Toast with Action
		</Button>
	),
};

// ── Promise ────────────────────────────────────────────

export const PromiseToast: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() => {
				const promise = new Promise<string>((resolve) => setTimeout(() => resolve('File uploaded successfully!'), 2500));
				toast.promise(promise, {
					loading: {
						title: 'Uploading...',
						description: 'Please wait while we upload your file.',
						type: 'loading',
					},
					success: (result) => ({
						title: 'Success',
						description: result,
						type: 'success',
					}),
					error: {
						title: 'Error',
						description: 'Something went wrong.',
						type: 'error',
					},
				});
			}}
		>
			Upload File
		</Button>
	),
};

// ── Promise with error state ───────────────────────────

export const PromiseWithError: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() => {
				const promise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Network failure')), 2000));
				toast.promise(promise, {
					loading: {
						title: 'Saving...',
						description: 'Saving your changes.',
						type: 'loading',
					},
					success: {
						title: 'Saved',
						description: 'Changes saved.',
						type: 'success',
					},
					error: {
						title: 'Save failed',
						description: 'Could not save changes. Please try again.',
						type: 'error',
					},
				});
			}}
		>
			Save (Simulate Error)
		</Button>
	),
};

// ── Custom timeout (persistent) ────────────────────────

export const Persistent: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() => {
				toast.add({
					title: 'Persistent toast',
					description: "This toast won't auto-dismiss. Close it manually.",
					timeout: 0,
				});
			}}
		>
			Show Persistent Toast
		</Button>
	),
};

// ─── Stacking (multiple toasts) ───────────────────────

export const Stacking: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() => {
				toast.add({
					title: 'Toast #1',
					description: 'First notification',
					type: 'success',
					timeout: 6000,
				});
				toast.add({
					title: 'Toast #2',
					description: 'Second notification',
					type: 'info',
					timeout: 6000,
				});
				toast.add({
					title: 'Toast #3',
					description: 'Third notification',
					type: 'warning',
					timeout: 6000,
				});
			}}
		>
			Show 3 Toasts
		</Button>
	),
};

// ── Update a toast in place ────────────────────────────

export const UpdateInPlace: Story = {
	render: () => (
		<Button
			variant="outline"
			onClick={() => {
				const id = toast.add({
					title: 'Downloading...',
					description: '0% complete',
					type: 'loading',
					timeout: 0,
				});

				let progress = 0;
				const interval = setInterval(() => {
					progress += 25;
					toast.update(id, {
						title: progress < 100 ? 'Downloading...' : 'Download complete',
						description: `${progress}% complete`,
						type: progress < 100 ? 'loading' : 'success',
						timeout: progress < 100 ? 0 : 3000,
					});

					if (progress >= 100) {
						clearInterval(interval);
					}
				}, 800);
			}}
		>
			Start Download
		</Button>
	),
};
