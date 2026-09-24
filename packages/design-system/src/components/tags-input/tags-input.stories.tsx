import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TagsInput } from './';

/**
 * A chip-based multi-value input. Type a tag and press Enter to add it,
 * press Backspace on an empty input to remove the last tag, or click the
 * ✕ on a chip to remove it.
 */
const meta: Meta<typeof TagsInput> = {
	title: 'Components/TagsInput',
	component: TagsInput,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A tags input for collecting multiple short values as removable chips. Type a tag and press Enter to add it, press Backspace on an empty input to remove the last tag, or click the ✕ on a chip to remove it. Duplicate tags are ignored, and `maxTags` can cap the number of tags.',
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
					'A basic tags input. Type a tag and press Enter to add it. Press Backspace on an empty input to remove the last tag, or click the ✕ to remove an individual tag.',
			},
		},
	},
	render: () => {
		const [tags, setTags] = React.useState<string[]>([]);
		return (
			<div className="w-80">
				<TagsInput value={tags} onChange={setTags} placeholder="Add tag and press Enter..." />
			</div>
		);
	},
};

// ── Prefilled ────────────────────────────────────────────

export const Prefilled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A tags input starting with existing tags. Each tag renders as a chip with a remove button.',
			},
		},
	},
	render: () => {
		const [tags, setTags] = React.useState(['urgent', 'review', 'blocked']);
		return (
			<div className="w-80">
				<TagsInput value={tags} onChange={setTags} />
			</div>
		);
	},
};

// ── Max Tags ─────────────────────────────────────────────

export const MaxTags: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `maxTags` to limit the number of tags. Once the limit is reached, the input is replaced by a count indicator like `3/3`.',
			},
		},
	},
	render: () => {
		const [tags, setTags] = React.useState(['react', 'typescript']);
		return (
			<div className="w-80">
				<TagsInput value={tags} onChange={setTags} maxTags={3} placeholder="Max 3 tags" />
			</div>
		);
	},
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use the `disabled` prop to disable the input. Existing tags are shown without remove buttons and the input cannot be focused.',
			},
		},
	},
	render: () => (
		<div className="w-80">
			<TagsInput value={['react', 'typescript', 'vite']} disabled />
		</div>
	),
};

// ── Empty ────────────────────────────────────────────────

export const Empty: Story = {
	parameters: {
		docs: {
			description: {
				story: 'The empty state with a custom placeholder. The placeholder only shows while there are no tags.',
			},
		},
	},
	render: () => {
		const [tags, setTags] = React.useState<string[]>([]);
		return (
			<div className="w-80">
				<TagsInput value={tags} onChange={setTags} placeholder="Start typing to add tags..." />
			</div>
		);
	},
};
