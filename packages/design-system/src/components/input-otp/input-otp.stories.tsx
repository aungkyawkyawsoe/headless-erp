import type { Meta, StoryObj } from '@storybook/react-vite';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from './';
import { useState } from 'react';

/**
 * InputOTP collects one-time passcodes with individual digit slots.
 *
 * Built on [`input-otp`](https://input-otp.vercel.app/), it provides
 * accessible, autofill-compatible OTP entry with support for paste,
 * backspace navigation, and fake caret animation.
 */
const meta: Meta<typeof InputOTP> = {
	title: 'Components/InputOTP',
	component: InputOTP,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A compound component: `InputOTP` (root), `InputOTPGroup`, `InputOTPSlot`, and `InputOTPSeparator`. Set `maxLength` for the number of digits. Use `onComplete` to fire when all digits are filled.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;

// ── Default ─────────────────────────────────────────────

export const Default: StoryObj = {
	render: () => {
		const [value, setValue] = useState('');
		return (
			<div className="flex flex-col items-center gap-4">
				<InputOTP maxLength={6} value={value} onChange={setValue}>
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
						<InputOTPSlot index={3} />
						<InputOTPSlot index={4} />
						<InputOTPSlot index={5} />
					</InputOTPGroup>
				</InputOTP>
				<p className="text-xs text-muted-foreground">Value: {value || '(empty)'}</p>
			</div>
		);
	},
};

// ── With Separator ──────────────────────────────────────

export const WithSeparator: StoryObj = {
	render: () => {
		const [value, setValue] = useState('');
		return (
			<div className="flex flex-col items-center gap-4">
				<InputOTP maxLength={6} value={value} onChange={setValue}>
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
					</InputOTPGroup>
					<InputOTPSeparator />
					<InputOTPGroup>
						<InputOTPSlot index={3} />
						<InputOTPSlot index={4} />
						<InputOTPSlot index={5} />
					</InputOTPGroup>
				</InputOTP>
				<p className="text-xs text-muted-foreground">Value: {value || '(empty)'}</p>
			</div>
		);
	},
};

// ── 4-digit ─────────────────────────────────────────────

export const FourDigit: StoryObj = {
	name: '4-digit',
	render: () => {
		const [value, setValue] = useState('');
		return (
			<div className="flex flex-col items-center gap-4">
				<InputOTP maxLength={4} value={value} onChange={setValue}>
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
						<InputOTPSlot index={3} />
					</InputOTPGroup>
				</InputOTP>
				<p className="text-xs text-muted-foreground">Value: {value || '(empty)'}</p>
			</div>
		);
	},
};

// ── Disabled ────────────────────────────────────────────

export const Disabled: StoryObj = {
	render: () => {
		const [value, setValue] = useState('');
		return (
			<div className="flex flex-col items-center gap-4">
				<InputOTP maxLength={6} value={value} onChange={setValue} disabled>
					<InputOTPGroup>
						<InputOTPSlot index={0} />
						<InputOTPSlot index={1} />
						<InputOTPSlot index={2} />
						<InputOTPSlot index={3} />
						<InputOTPSlot index={4} />
						<InputOTPSlot index={5} />
					</InputOTPGroup>
				</InputOTP>
				<p className="text-xs text-muted-foreground">Value: {value || '(empty)'}</p>
			</div>
		);
	},
};
