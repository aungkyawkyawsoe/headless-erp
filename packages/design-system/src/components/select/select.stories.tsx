'use client';

import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from './';
import { Field, FieldError, FieldLabel } from '@/field';

/**
 * Select lets users choose a single option from a dropdown menu.
 *
 * Handles accessibility, keyboard navigation, and positioning
 * out of the box. Compose with `SelectTrigger`, `SelectValue`,
 * `SelectContent`, `SelectGroup`, `SelectLabel`, `SelectItem`,
 * and `SelectSeparator` to build structured dropdowns.
 */
const meta: Meta<typeof Select> = {
	title: 'Components/Select',
	component: Select,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A styled select. Supports controlled/uncontrolled value, disabled state, grouped options with labels and separators, scrollable lists, and error styling via `aria-invalid` on the trigger.',
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Fruits Data ──────────────────────────────────────────

const fruits = [
	{ label: 'Apple', value: 'apple' },
	{ label: 'Banana', value: 'banana' },
	{ label: 'Blueberry', value: 'blueberry' },
	{ label: 'Cherry', value: 'cherry' },
	{ label: 'Grape', value: 'grape' },
	{ label: 'Mango', value: 'mango' },
	{ label: 'Orange', value: 'orange' },
	{ label: 'Strawberry', value: 'strawberry' },
	{ label: 'Watermelon', value: 'watermelon' },
];

const themes = [
	{ label: 'Light', value: 'light' },
	{ label: 'Dark', value: 'dark' },
	{ label: 'System', value: 'system' },
];

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A basic select with a few options. Pass `items` to `Select` and compose `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectGroup`, and `SelectItem` to render the dropdown.',
			},
		},
	},
	render: () => (
		<Select items={themes}>
			<SelectTrigger className="w-45">
				<SelectValue placeholder="Theme" />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{themes.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	),
};

// ── Groups ───────────────────────────────────────────────

const groupedItems = [
	{
		label: 'Fruits',
		items: [
			{ label: 'Apple', value: 'apple' },
			{ label: 'Banana', value: 'banana' },
			{ label: 'Blueberry', value: 'blueberry' },
		],
	},
	{
		label: 'Vegetables',
		items: [
			{ label: 'Broccoli', value: 'broccoli' },
			{ label: 'Carrot', value: 'carrot' },
			{ label: 'Spinach', value: 'spinach' },
		],
	},
	{
		label: 'Dairy',
		items: [
			{ label: 'Cheese', value: 'cheese' },
			{ label: 'Milk', value: 'milk' },
			{ label: 'Yogurt', value: 'yogurt' },
		],
	},
];

export const Groups: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `SelectGroup` with `SelectLabel` and `SelectSeparator` to organize options into categories.',
			},
		},
	},
	render: () => (
		<Select items={groupedItems.flatMap((g) => g.items)}>
			<SelectTrigger className="w-50">
				<SelectValue placeholder="Select item" />
			</SelectTrigger>
			<SelectContent>
				{groupedItems.map((group, groupIndex) => (
					<React.Fragment key={group.label}>
						{groupIndex > 0 && <SelectSeparator />}
						<SelectGroup>
							<SelectLabel>{group.label}</SelectLabel>
							{group.items.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectGroup>
					</React.Fragment>
				))}
			</SelectContent>
		</Select>
	),
};

// ── Scrollable ───────────────────────────────────────────

const timezones = [
	{ label: 'UTC-12:00 (Baker Island)', value: 'UTC-12' },
	{ label: 'UTC-11:00 (American Samoa)', value: 'UTC-11' },
	{ label: 'UTC-10:00 (Hawaii)', value: 'UTC-10' },
	{ label: 'UTC-09:00 (Alaska)', value: 'UTC-9' },
	{ label: 'UTC-08:00 (Pacific Time)', value: 'UTC-8' },
	{ label: 'UTC-07:00 (Mountain Time)', value: 'UTC-7' },
	{ label: 'UTC-06:00 (Central Time)', value: 'UTC-6' },
	{ label: 'UTC-05:00 (Eastern Time)', value: 'UTC-5' },
	{ label: 'UTC-04:00 (Atlantic Time)', value: 'UTC-4' },
	{ label: 'UTC-03:00 (Brasilia)', value: 'UTC-3' },
	{ label: 'UTC-02:00 (Mid-Atlantic)', value: 'UTC-2' },
	{ label: 'UTC-01:00 (Azores)', value: 'UTC-1' },
	{ label: 'UTC+00:00 (UTC)', value: 'UTC+0' },
	{ label: 'UTC+01:00 (CET)', value: 'UTC+1' },
	{ label: 'UTC+02:00 (EET)', value: 'UTC+2' },
	{ label: 'UTC+03:00 (Moscow)', value: 'UTC+3' },
	{ label: 'UTC+04:00 (Dubai)', value: 'UTC+4' },
	{ label: 'UTC+05:00 (Karachi)', value: 'UTC+5' },
	{ label: 'UTC+06:00 (Dhaka)', value: 'UTC+6' },
	{ label: 'UTC+07:00 (Bangkok)', value: 'UTC+7' },
	{ label: 'UTC+08:00 (Beijing)', value: 'UTC+8' },
	{ label: 'UTC+09:00 (Tokyo)', value: 'UTC+9' },
	{ label: 'UTC+10:00 (Sydney)', value: 'UTC+10' },
	{ label: 'UTC+11:00 (Solomon Is.)', value: 'UTC+11' },
	{ label: 'UTC+12:00 (Auckland)', value: 'UTC+12' },
];

export const Scrollable: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Select with many options that scroll. The popup automatically manages its max height via `max-h-(--available-height)` and shows scroll-up / scroll-down arrow indicators.',
			},
		},
	},
	render: () => (
		<Select items={timezones}>
			<SelectTrigger className="w-55">
				<SelectValue placeholder="Select timezone" />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{timezones.map((tz) => (
						<SelectItem key={tz.value} value={tz.value}>
							{tz.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	),
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Add the `disabled` prop to `Select` to disable the entire select. The trigger becomes non-interactive with reduced opacity.',
			},
		},
	},
	render: () => (
		<Select items={fruits} disabled>
			<SelectTrigger className="w-45">
				<SelectValue placeholder="Select a fruit" />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{fruits.map((fruit) => (
						<SelectItem key={fruit.value} value={fruit.value}>
							{fruit.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	),
};

// ── Invalid ──────────────────────────────────────────────

export const Invalid: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `aria-invalid` on `SelectTrigger` to show the error state. Wrap with `Field`, `FieldLabel`, and `FieldError` for a complete form layout with validation feedback.',
			},
		},
	},
	render: () => (
		<Field data-invalid className="w-50">
			<FieldLabel htmlFor="theme-select">Theme</FieldLabel>
			<Select items={themes} id="theme-select">
				<SelectTrigger className="w-50" aria-invalid>
					<SelectValue placeholder="Select theme" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{themes.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<FieldError>Please select a theme.</FieldError>
		</Field>
	),
};
