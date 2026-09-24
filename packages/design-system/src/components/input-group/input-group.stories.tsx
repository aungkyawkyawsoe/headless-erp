import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	SearchIcon,
	MailIcon,
	EyeOffIcon,
	CheckIcon,
	CreditCardIcon,
	InfoIcon,
	StarIcon,
	CopyIcon,
	FileCodeIcon,
	LoaderIcon,
} from 'lucide-react';
import { useState } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupInput, InputGroupTextarea } from './';
import { Field, FieldDescription, FieldLabel } from '@/field';
import { Kbd } from '@/kbd';
import { Spinner } from '@/spinner';

/**
 * `InputGroup` adds addons, buttons, and helper content to inputs.
 *
 * Compose with `InputGroupInput` / `InputGroupTextarea` as the control,
 * then add `InputGroupAddon`, `InputGroupButton`, or `InputGroupText`
 * around it to build rich input composites.
 *
 * Built with CVA for variant styling and supports `inline-start`,
 * `inline-end`, `block-start`, and `block-end` alignment.
 *
 * ## Composition
 * ```
 * InputGroup
 * ├── InputGroupInput or InputGroupTextarea
 * ├── InputGroupAddon
 * ├── InputGroupButton
 * └── InputGroupText
 * ```
 */
const meta: Meta<typeof InputGroup> = {
	title: 'Components/InputGroup',
	component: InputGroup,
	tags: ['autodocs'],
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A composite input component that groups an input, textarea with addons, buttons, and labels in a single styled container. Supports four alignment positions.',
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Overview / Demo ───────────────────────────────────────

export const Demo: Story = {
	name: 'Overview',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'The `InputGroup` wraps a control with addons. Use `InputGroupInput` for text inputs and `InputGroupAddon` with an `align` prop to position icons, text, or buttons.',
			},
		},
	},
	render: () => (
		<InputGroup className="max-w-xs">
			<InputGroupInput placeholder="Search..." />
			<InputGroupAddon>
				<SearchIcon />
			</InputGroupAddon>
			<InputGroupAddon align="inline-end">12 results</InputGroupAddon>
		</InputGroup>
	),
};

// ── Align: inline-start ───────────────────────────────────

export const AlignInlineStart: Story = {
	name: 'Align / inline-start',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Use `align="inline-start"` to position the addon at the start of the input. This is the default alignment.',
			},
		},
	},
	render: () => (
		<Field className="max-w-sm">
			<FieldLabel htmlFor="inline-start-input">Input</FieldLabel>
			<InputGroup>
				<InputGroupInput id="inline-start-input" placeholder="Search..." />
				<InputGroupAddon align="inline-start">
					<SearchIcon className="text-muted-foreground" />
				</InputGroupAddon>
			</InputGroup>
			<FieldDescription>Icon positioned at the start.</FieldDescription>
		</Field>
	),
};

// ── Align: inline-end ─────────────────────────────────────

export const AlignInlineEnd: Story = {
	name: 'Align / inline-end',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Use `align="inline-end"` to position the addon at the end of the input.',
			},
		},
	},
	render: () => (
		<Field className="max-w-sm">
			<FieldLabel htmlFor="inline-end-input">Input</FieldLabel>
			<InputGroup>
				<InputGroupInput id="inline-end-input" type="password" placeholder="Enter password" />
				<InputGroupAddon align="inline-end">
					<EyeOffIcon />
				</InputGroupAddon>
			</InputGroup>
			<FieldDescription>Icon positioned at the end.</FieldDescription>
		</Field>
	),
};

// ── Align: block-start ────────────────────────────────────

export const AlignBlockStart: Story = {
	name: 'Align / block-start',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Use `align="block-start"` to position the addon above the input or textarea.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-sm flex-col gap-5">
			<Field>
				<FieldLabel htmlFor="block-start-input">Input</FieldLabel>
				<InputGroup className="h-auto">
					<InputGroupInput id="block-start-input" placeholder="Enter your name" />
					<InputGroupAddon align="block-start">
						<InputGroupText>Full Name</InputGroupText>
					</InputGroupAddon>
				</InputGroup>
				<FieldDescription>Header positioned above the input.</FieldDescription>
			</Field>
			<Field>
				<FieldLabel htmlFor="block-start-textarea">Textarea</FieldLabel>
				<InputGroup>
					<InputGroupTextarea id="block-start-textarea" placeholder="console.log('Hello, world!');" className="font-mono text-sm" />
					<InputGroupAddon align="block-start">
						<FileCodeIcon className="text-muted-foreground" />
						<InputGroupText className="font-mono">script.js</InputGroupText>
						<InputGroupButton size="icon-xs" className="ml-auto">
							<CopyIcon />
							<span className="sr-only">Copy</span>
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<FieldDescription>Header positioned above the textarea.</FieldDescription>
			</Field>
		</div>
	),
};

// ── Align: block-end ──────────────────────────────────────

export const AlignBlockEnd: Story = {
	name: 'Align / block-end',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Use `align="block-end"` to position the addon below the input or textarea.',
			},
		},
	},
	render: () => (
		<div className="flex w-full max-w-sm flex-col gap-5">
			<Field>
				<FieldLabel htmlFor="block-end-input">Input</FieldLabel>
				<InputGroup className="h-auto">
					<InputGroupInput id="block-end-input" placeholder="Enter amount" />
					<InputGroupAddon align="block-end">
						<InputGroupText>USD</InputGroupText>
					</InputGroupAddon>
				</InputGroup>
				<FieldDescription>Footer positioned below the input.</FieldDescription>
			</Field>
			<Field>
				<FieldLabel htmlFor="block-end-textarea">Textarea</FieldLabel>
				<InputGroup>
					<InputGroupTextarea id="block-end-textarea" placeholder="Write a comment..." />
					<InputGroupAddon align="block-end">
						<InputGroupText>0/280</InputGroupText>
						<InputGroupButton variant="default" size="xs" className="ml-auto">
							Post
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<FieldDescription>Footer positioned below the textarea.</FieldDescription>
			</Field>
		</div>
	),
};

// ── Icon ───────────────────────────────────────────────────

export const Icon: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Place icons inside `InputGroupAddon` to add visual context. Multiple addons can be combined for start and end positions.',
			},
		},
	},
	render: () => (
		<div className="grid w-full max-w-sm gap-6">
			<InputGroup>
				<InputGroupInput placeholder="Search..." />
				<InputGroupAddon>
					<SearchIcon />
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput type="email" placeholder="Enter your email" />
				<InputGroupAddon>
					<MailIcon />
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput placeholder="Card number" />
				<InputGroupAddon>
					<CreditCardIcon />
				</InputGroupAddon>
				<InputGroupAddon align="inline-end">
					<CheckIcon />
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput placeholder="Card number" />
				<InputGroupAddon align="inline-end">
					<StarIcon />
					<InfoIcon />
				</InputGroupAddon>
			</InputGroup>
		</div>
	),
};

// ── Text ───────────────────────────────────────────────────

export const Text: Story = {
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'Use `InputGroupText` to display labels, units, or contextual text alongside inputs. Combine start and end addons for prefixes and suffixes.',
			},
		},
	},
	render: () => (
		<div className="grid w-full max-w-sm gap-6">
			<InputGroup>
				<InputGroupAddon>
					<InputGroupText>$</InputGroupText>
				</InputGroupAddon>
				<InputGroupInput placeholder="0.00" />
				<InputGroupAddon align="inline-end">
					<InputGroupText>USD</InputGroupText>
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupAddon>
					<InputGroupText>https://</InputGroupText>
				</InputGroupAddon>
				<InputGroupInput placeholder="example.com" />
				<InputGroupAddon align="inline-end">
					<InputGroupText>.com</InputGroupText>
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput placeholder="Enter your username" />
				<InputGroupAddon align="inline-end">
					<InputGroupText>@company.com</InputGroupText>
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupTextarea placeholder="Enter your message" />
				<InputGroupAddon align="block-end">
					<InputGroupText className="text-xs text-muted-foreground">120 characters left</InputGroupText>
				</InputGroupAddon>
			</InputGroup>
		</div>
	),
};

// ── Button ─────────────────────────────────────────────────

export const ButtonStory: Story = {
	name: 'Button',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'Add `InputGroupButton` inside an addon to provide actions like copy, favorite, or submit. Use the `size` prop (`xs`, `icon-xs`) and `variant` prop (`ghost`, `secondary`, `default`) to control appearance.',
			},
		},
	},
	render: () => {
		const [copied, setCopied] = useState(false);
		const [favorite, setFavorite] = useState(false);

		return (
			<div className="grid w-full max-w-sm gap-6">
				<InputGroup>
					<InputGroupInput placeholder="https://x.com/mmbix" defaultValue="https://x.com/mmbix" readOnly />
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							aria-label="Copy"
							title="Copy"
							size="icon-xs"
							onClick={() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 2000);
							}}
						>
							{copied ? <CheckIcon /> : <CopyIcon />}
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<InputGroup className="rounded-full">
					<InputGroupAddon className="pl-1.5 text-muted-foreground">https://</InputGroupAddon>
					<InputGroupInput />
					<InputGroupAddon align="inline-end">
						<InputGroupButton onClick={() => setFavorite(!favorite)} size="icon-xs">
							<StarIcon data-favorite={favorite} className="data-[favorite=true]:fill-blue-600 data-[favorite=true]:stroke-blue-600" />
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				<InputGroup>
					<InputGroupInput placeholder="Type to search..." />
					<InputGroupAddon align="inline-end">
						<InputGroupButton variant="secondary">Search</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</div>
		);
	},
};

// ── Kbd ────────────────────────────────────────────────────

export const KbdStory: Story = {
	name: 'Kbd',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'Display keyboard shortcuts inside `InputGroupAddon` using the `Kbd` component. Great for search inputs with quick-action hints.',
			},
		},
	},
	render: () => (
		<InputGroup className="max-w-sm">
			<InputGroupInput placeholder="Search..." />
			<InputGroupAddon>
				<SearchIcon className="text-muted-foreground" />
			</InputGroupAddon>
			<InputGroupAddon align="inline-end">
				<Kbd>⌘K</Kbd>
			</InputGroupAddon>
		</InputGroup>
	),
};

// ── Spinner ────────────────────────────────────────────────

export const SpinnerStory: Story = {
	name: 'Spinner',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story: 'Use `Spinner` inside addons to indicate loading state. Combine with `InputGroupText` for contextual messages.',
			},
		},
	},
	render: () => (
		<div className="grid w-full max-w-sm gap-4">
			<InputGroup>
				<InputGroupInput placeholder="Searching..." />
				<InputGroupAddon align="inline-end">
					<Spinner />
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput placeholder="Processing..." />
				<InputGroupAddon>
					<Spinner />
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput placeholder="Saving changes..." />
				<InputGroupAddon align="inline-end">
					<InputGroupText>Saving...</InputGroupText>
					<Spinner />
				</InputGroupAddon>
			</InputGroup>
			<InputGroup>
				<InputGroupInput placeholder="Refreshing data..." />
				<InputGroupAddon>
					<LoaderIcon className="animate-spin" />
				</InputGroupAddon>
				<InputGroupAddon align="inline-end">
					<InputGroupText className="text-muted-foreground">Please wait...</InputGroupText>
				</InputGroupAddon>
			</InputGroup>
		</div>
	),
};

// ── Textarea ───────────────────────────────────────────────

export const TextareaStory: Story = {
	name: 'Textarea',
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				story:
					'Combine `InputGroupTextarea` with `block-start` and `block-end` addons to build rich editor-like experiences. Addons can include status info, buttons, and labels.',
			},
		},
	},
	render: () => (
		<div className="grid w-full max-w-md gap-4">
			<InputGroup>
				<InputGroupTextarea id="textarea-code" placeholder="console.log('Hello, world!');" className="min-h-50" />
				<InputGroupAddon align="block-end" className="border-t">
					<InputGroupText>Line 1, Column 1</InputGroupText>
					<InputGroupButton size="sm" className="ml-auto" variant="default">
						Run
					</InputGroupButton>
				</InputGroupAddon>
				<InputGroupAddon align="block-start" className="border-b">
					<InputGroupText className="font-mono font-medium">script.js</InputGroupText>
					<InputGroupButton className="ml-auto" size="icon-xs">
						<FileCodeIcon />
					</InputGroupButton>
					<InputGroupButton variant="ghost" size="icon-xs">
						<CopyIcon />
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>
	),
};
