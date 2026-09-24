import type { Meta, StoryObj } from '@storybook/react-vite';
import { AspectRatio } from './';

/**
 * AspectRatio renders a container constrained to a specific aspect ratio.
 * All child content is clipped to the ratio boundary.
 *
 * The ratio is set via the `ratio` prop (e.g. `16/9`, `1`, `3/4`).
 * Under the hood it uses the CSS `aspect-ratio` property, so any
 * content placed inside will automatically size to the container.
 */
const meta: Meta<typeof AspectRatio> = {
	title: 'Components/AspectRatio',
	component: AspectRatio,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A utility wrapper that constrains its content to a given aspect ratio. Commonly used with images, videos, maps, and embeds to maintain consistent layout across viewports.',
			},
		},
	},
	tags: ['autodocs'],
	argTypes: {
		ratio: {
			control: 'number',
			description: 'Aspect ratio as a decimal (e.g. `16/9`, `1`, `4/3`)',
			table: { defaultValue: { summary: '16/9' } },
		},
	},
	args: {
		ratio: 16 / 9,
	},
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Image examples ────────────────────────────────────

const IMAGE_URL = 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=800&h=450&fit=crop';

// ── Square (1/1) ───────────────────────────────────────

export const Square: Story = {
	name: '1/1',
	args: { ratio: 1 },
	parameters: {
		docs: {
			description: {
				story: 'Perfect square — great for profile photos, product thumbnails, or grid tiles.',
			},
		},
	},
	render: (args) => (
		<div className="w-40">
			<AspectRatio {...args} className="overflow-hidden rounded-lg">
				<img
					src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=256&h=256&fit=crop&crop=face"
					alt="Portrait"
					className="size-full object-cover"
				/>
			</AspectRatio>
		</div>
	),
};

// ── Default (16/9) ─────────────────────────────────────

export const Default: Story = {
	name: '16/9',
	args: { ratio: 16 / 9 },
	parameters: {
		docs: {
			description: {
				story: 'The classic widescreen ratio, ideal for videos and hero images.',
			},
		},
	},
	render: (args) => (
		<div className="w-80">
			<AspectRatio {...args} className="overflow-hidden rounded-lg">
				<img src={IMAGE_URL} alt="Landscape" className="size-full object-cover" />
			</AspectRatio>
		</div>
	),
};

// ── Wide (21/9) ────────────────────────────────────────

export const UltraWide: Story = {
	name: '21/9',
	args: { ratio: 21 / 9 },
	parameters: {
		docs: {
			description: {
				story: 'Cinematic ultrawide ratio, suitable for hero banners and movie-style presentations.',
			},
		},
	},
	render: (args) => (
		<div className="w-96">
			<AspectRatio {...args} className="overflow-hidden rounded-lg">
				<img
					src="https://images.unsplash.com/photo-1682687982501-1e58ab814714?w=1000&h=429&fit=crop"
					alt="Ultrawide landscape"
					className="size-full object-cover"
				/>
			</AspectRatio>
		</div>
	),
};

// ── Portrait (3/4) ─────────────────────────────────────

export const Portrait: Story = {
	name: '3/4',
	args: { ratio: 3 / 4 },
	parameters: {
		docs: {
			description: {
				story: 'Standard portrait ratio, commonly used for card thumbnails and vertical layouts.',
			},
		},
	},
	render: (args) => (
		<div className="w-48">
			<AspectRatio {...args} className="overflow-hidden rounded-lg">
				<img
					src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=533&fit=crop"
					alt="Portrait"
					className="size-full object-cover"
				/>
			</AspectRatio>
		</div>
	),
};

// ── With custom content ────────────────────────────────

export const WithContent: Story = {
	name: 'With Embed',
	args: { ratio: 16 / 9 },
	parameters: {
		docs: {
			description: {
				story: 'AspectRatio can wrap any content — here a video embed fills the constrained space.',
			},
		},
	},
	render: (args) => (
		<div className="w-96">
			<AspectRatio {...args} className="overflow-hidden rounded-lg bg-muted">
				<iframe
					src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
					title="Video embed"
					className="size-full"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowFullScreen
				/>
			</AspectRatio>
		</div>
	),
};
