import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Switch } from './';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '../field';
import { Label } from '../label';

/**
 * A control that allows the user to toggle between checked and not checked.
 */
const meta: Meta<typeof Switch> = {
	title: 'Components/Switch',
	component: Switch,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A switch component. Allows users to toggle between checked and unchecked states. Supports disabled, invalid, and different size variants.',
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
				story: 'A basic switch with a label. Use the `Switch` component with a `Label` for accessible toggles.',
			},
		},
	},
	render: function DefaultStory() {
		const [checked, setChecked] = useState(false);
		return (
			<Field orientation="horizontal">
				<Switch checked={checked} onCheckedChange={setChecked} id="airplane-mode" />
				<Label htmlFor="airplane-mode">Airplane Mode</Label>
			</Field>
		);
	},
};

// ── Description ──────────────────────────────────────────

export const Description: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add a description to the switch using `FieldContent` to provide additional context about the setting.',
			},
		},
	},
	render: function DescriptionStory() {
		const [checked, setChecked] = useState(false);
		return (
			<Field orientation="horizontal" className="items-start">
				<Switch checked={checked} onCheckedChange={setChecked} id="share-devices" />
				<FieldContent>
					<Label htmlFor="share-devices">Share across devices</Label>
					<p className="text-xs text-muted-foreground">Focus is shared across devices, and turns off when you leave the app.</p>
				</FieldContent>
			</Field>
		);
	},
};

// ── Choice Card ──────────────────────────────────────────

export const ChoiceCard: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Card-style selection where `FieldLabel` wraps a horizontal `Field` containing `FieldContent` / `FieldTitle` / `FieldDescription` and the `Switch`, creating a clickable card pattern.',
			},
		},
	},
	render: function ChoiceCardStory() {
		const [shareEnabled, setShareEnabled] = useState(false);
		const [notificationsEnabled, setNotificationsEnabled] = useState(false);
		return (
			<div className="flex w-96 flex-col">
				<FieldGroup className="w-full max-w-sm">
					<FieldLabel htmlFor="switch-share">
						<Field orientation="horizontal">
							<FieldContent>
								<FieldTitle>Share across devices</FieldTitle>
								<FieldDescription>Focus is shared across devices, and turns off when you leave the app.</FieldDescription>
							</FieldContent>
							<Switch id="switch-share" checked={shareEnabled} onCheckedChange={setShareEnabled} />
						</Field>
					</FieldLabel>
					<FieldLabel htmlFor="switch-notifications">
						<Field orientation="horizontal">
							<FieldContent>
								<FieldTitle>Enable notifications</FieldTitle>
								<FieldDescription>Receive notifications when focus mode is enabled or disabled.</FieldDescription>
							</FieldContent>
							<Switch id="switch-notifications" checked={notificationsEnabled} onCheckedChange={setNotificationsEnabled} />
						</Field>
					</FieldLabel>
				</FieldGroup>
			</div>
		);
	},
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add the `disabled` prop to the `Switch` component to disable the switch.',
			},
		},
	},
	render: () => (
		<Field orientation="horizontal">
			<Switch disabled id="disabled-switch" />
			<Label htmlFor="disabled-switch" data-disabled>
				Disabled
			</Label>
		</Field>
	),
};

// ── Invalid ──────────────────────────────────────────────

export const Invalid: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add the `aria-invalid` prop to the `Switch` component to indicate an invalid state.',
			},
		},
	},
	render: function InvalidStory() {
		const [checked, setChecked] = useState(false);
		return (
			<Field orientation="horizontal" className="max-w-sm" data-invalid>
				<FieldContent>
					<FieldLabel htmlFor="switch-terms">Accept terms and conditions</FieldLabel>
					<FieldDescription>You must accept the terms and conditions to continue.</FieldDescription>
				</FieldContent>
				<Switch id="switch-terms" aria-invalid={!checked} checked={checked} onCheckedChange={setChecked} />
			</Field>
		);
	},
};

// ── Size ─────────────────────────────────────────────────

export const Size: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `size` prop to change the size of the switch. Supports `sm` and `default`.',
			},
		},
	},
	render: () => (
		<div className="flex w-96 flex-col">
			<FieldGroup>
				<Field orientation="horizontal">
					<Switch size="sm" id="size-small" />
					<Label htmlFor="size-small">Small</Label>
				</Field>
				<Field orientation="horizontal">
					<Switch size="default" id="size-default" />
					<Label htmlFor="size-default">Default</Label>
				</Field>
			</FieldGroup>
		</div>
	),
};
