import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
	AlertDialogTrigger,
} from './';
import { Badge } from '../badge';
import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../dialog';
import { Label } from '../label';
import {
	BluetoothIcon,
	CheckIcon,
	CircleAlertIcon,
	FingerprintPatternIcon,
	KeySquareIcon,
	LockIcon,
	ShieldAlertIcon,
	Trash2Icon,
} from 'lucide-react';

const meta: Meta<typeof AlertDialog> = {
	title: 'Components/AlertDialog',
	component: AlertDialog,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A modal dialog that requires user acknowledgment. Commonly used for destructive actions (delete, discard) or important confirmations. Supports two sizes: `default` (desktop: left-aligned) and `sm` (compact).',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		open: {
			control: 'boolean',
			description: 'Controlled open state',
			table: { category: 'State' },
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Centered confirmation ───────────────────────────────

export const CenteredConfirmation: Story = {
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="outline">Open Alert Dialog</Button>} />
			<AlertDialogContent className="sm:max-w-sm">
				<AlertDialogHeader className="sm:place-items-center sm:text-center">
					<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
					<AlertDialogDescription>
						This action cannot be undone. This will permanently delete your account and remove your data from our servers.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="sm:justify-center">
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction>Continue</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Small alert ─────────────────────────────────────────

export const SmallAlert: Story = {
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="outline">Small Alert</Button>} />
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogTitle>Allow accessory to connect?</AlertDialogTitle>
					<AlertDialogDescription>Do you want to allow the USB accessory to connect to this device?</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Don't allow</AlertDialogCancel>
					<AlertDialogAction>Allow</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Default with media ──────────────────────────────────

export const DefaultMedia: Story = {
	name: 'Default (Media)',
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="outline">Default (Media)</Button>} />
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogMedia>
						<BluetoothIcon />
					</AlertDialogMedia>
					<AlertDialogTitle>Pair with this device?</AlertDialogTitle>
					<AlertDialogDescription>This will allow the device to connect and share data with your current session.</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction>Connect</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Small with media ────────────────────────────────────

export const SmallMedia: Story = {
	name: 'Small (Media)',
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="outline">Small (Media)</Button>} />
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogMedia>
						<BluetoothIcon />
					</AlertDialogMedia>
					<AlertDialogTitle>Allow accessory to connect?</AlertDialogTitle>
					<AlertDialogDescription>Do you want to allow the USB accessory to connect to this device?</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Don&apos;t allow</AlertDialogCancel>
					<AlertDialogAction>Allow</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Destructive: delete chat ────────────────────────────

export const DeleteChat: Story = {
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="destructive">Delete Chat</Button>} />
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
						<Trash2Icon />
					</AlertDialogMedia>
					<AlertDialogTitle>Delete chat?</AlertDialogTitle>
					<AlertDialogDescription>
						This will permanently delete this chat conversation. View{' '}
						<a href="#" className="underline">
							Settings
						</a>{' '}
						to delete any memories saved during this chat.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
					<AlertDialogAction variant="destructive">Delete</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Nested inside a dialog ──────────────────────────────

export const NestedInDialog: Story = {
	name: 'Alert Dialog in Dialog',
	render: () => (
		<Dialog>
			<DialogTrigger render={<Button variant="outline" />}>Open Dialog</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Alert Dialog Example</DialogTitle>
					<DialogDescription>Click the button below to open an alert dialog.</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<AlertDialog>
						<AlertDialogTrigger render={<Button />}>Open Alert Dialog</AlertDialogTrigger>
						<AlertDialogContent size="sm">
							<AlertDialogHeader>
								<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
								<AlertDialogDescription>
									This action cannot be undone. This will permanently delete your account and remove your data from our servers.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction>Continue</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	),
};

// ── Task status ─────────────────────────────────────────

export const TaskStatus: Story = {
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="outline">Task Status</Button>} />
			<AlertDialogContent>
				<div className="flex items-center gap-3 py-1">
					<div className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 dark:bg-emerald-950 dark:text-emerald-300">
						<CheckIcon className="size-5" />
					</div>
					<div className="flex flex-col justify-center gap-1">
						<AlertDialogTitle className="text-sm font-semibold">Task successful</AlertDialogTitle>
						<AlertDialogDescription className="text-sm text-muted-foreground">
							Your task has been completed successfully.
						</AlertDialogDescription>
					</div>
				</div>
				<AlertDialogFooter className="items-center gap-4 sm:justify-between">
					<div className="flex items-center gap-2">
						<Checkbox id="show-again" />
						<Label htmlFor="show-again" className="font-normal text-muted-foreground">
							Don&apos;t show again
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction>Confirm</AlertDialogAction>
					</div>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Deactivate account ──────────────────────────────────

export const DeactivateAccount: Story = {
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="destructive">Deactivate Account</Button>} />
			<AlertDialogContent>
				<div className="flex items-start gap-3 py-1">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 dark:bg-destructive/10">
						<CircleAlertIcon className="size-5 text-destructive" />
					</div>
					<div className="flex flex-col justify-center gap-1">
						<AlertDialogTitle className="text-sm font-semibold">Deactivate your account?</AlertDialogTitle>
						<AlertDialogDescription className="text-sm text-muted-foreground">
							This will disable your account and remove your profile from all active searches.
						</AlertDialogDescription>
					</div>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep My Account</AlertDialogCancel>
					<AlertDialogAction variant="destructive">Deactivate Anyway</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};

// ── Advanced security check ─────────────────────────────

const SECURITY_ITEMS = [
	{
		icon: <LockIcon className="size-4 text-muted-foreground" />,
		title: 'Password Policy',
		description: 'Verify strength and rotation',
		status: 'Pending',
	},
	{
		icon: <FingerprintPatternIcon className="size-4 text-muted-foreground" />,
		title: 'Biometric Status',
		description: 'Check hardware encryption',
		status: 'Done',
	},
	{
		icon: <KeySquareIcon className="size-4 text-muted-foreground" />,
		title: 'Active Sessions',
		description: 'Review connected devices',
		status: 'Pending',
	},
];

export const AdvancedSecurity: Story = {
	name: 'Advanced Security Check',
	render: () => (
		<AlertDialog>
			<AlertDialogTrigger render={<Button variant="outline">Advanced Security Check</Button>} />
			<AlertDialogContent className="max-w-sm! gap-0 overflow-hidden p-0">
				{/* Header */}
				<div className="flex flex-col items-center justify-center gap-1.5 px-4 pt-6 pb-5 text-center">
					<AlertDialogMedia className="size-12 rounded-full bg-green-50 text-green-500 dark:bg-green-950 dark:text-green-400">
						<ShieldAlertIcon className="size-6" />
					</AlertDialogMedia>
					<AlertDialogTitle className="text-base font-semibold">Advanced Security Audit</AlertDialogTitle>
					<AlertDialogDescription className="p-0 text-sm">Summary of your account status and security settings.</AlertDialogDescription>
				</div>

				{/* Content */}
				<div className="space-y-3 p-4">
					{SECURITY_ITEMS.map((item) => (
						<div key={item.title} className="flex items-center justify-between rounded-md border border-dashed border-border px-3 py-2.5">
							<div className="flex items-center gap-2.5">
								<div className="flex size-8 items-center justify-center rounded-md border border-border/80 bg-background shadow-xs">
									{item.icon}
								</div>
								<div className="flex flex-col gap-px">
									<span className="text-sm font-medium">{item.title}</span>
									<span className="text-xs text-muted-foreground">{item.description}</span>
								</div>
							</div>
							<Badge
								className={
									item.status === 'Pending'
										? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300'
										: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-300'
								}
							>
								{item.status}
							</Badge>
						</div>
					))}
				</div>

				{/* Footer */}
				{/* The content is `p-0`, so there is no padding to escape: the footer's
            built-in `-mx-4 -mb-4` pushed the bar OUTSIDE the dialog, where
            `overflow-hidden` clipped it - which is why it looked like it had no
            padding. Cancelling the breakout puts it flush edge-to-edge with its
            own `p-4` intact. */}
				<AlertDialogFooter className="mx-0 mb-0 grid grid-cols-1 gap-2 p-4">
					<AlertDialogAction variant="default" className="flex-1">
						Start Deep Audit
					</AlertDialogAction>
					<AlertDialogCancel variant="ghost" className="flex-1">
						Skip for now
					</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	),
};
