import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './';

/**
 * Resizable panels let users split and resize interface sections
 * via draggable handles — perfect for layouts like sidebars,
 * code editors, and dashboards.
 *
 * Built on [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels),
 * it supports horizontal and vertical orientations, keyboard
 * navigation, and optional visible handles.
 */
const meta: Meta<typeof ResizablePanelGroup> = {
	title: 'Components/Resizable',
	component: ResizablePanelGroup,
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'A resizable panel system built on `react-resizable-panels`. Compose `ResizablePanelGroup`, `ResizablePanel`, and `ResizableHandle` to create splittable layouts with drag-to-resize and keyboard support.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Helpers ─────────────────────────────────────────────

function StoryContainer({ children }: { children: React.ReactNode }) {
	return <div className="mx-auto h-64 max-w-2xl overflow-hidden rounded-lg border">{children}</div>;
}

function PanelPlaceholder({ label, className }: { label: string; className?: string }) {
	return (
		<div className={`flex h-full items-center justify-center p-6 ${className ?? ''}`}>
			<span className="text-lg font-semibold text-muted-foreground">{label}</span>
		</div>
	);
}

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A horizontal panel group with three resizable panels. Drag the handles between panels to resize them.',
			},
		},
	},
	render: () => (
		<StoryContainer>
			<ResizablePanelGroup orientation="horizontal">
				<ResizablePanel defaultSize={33}>
					<PanelPlaceholder label="One" />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize={33}>
					<PanelPlaceholder label="Two" />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize={34}>
					<PanelPlaceholder label="Three" />
				</ResizablePanel>
			</ResizablePanelGroup>
		</StoryContainer>
	),
};

// ── Vertical ────────────────────────────────────────────

export const Vertical: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A vertical panel group arranges panels top-to-bottom instead of left-to-right.',
			},
		},
	},
	render: () => (
		<StoryContainer>
			<ResizablePanelGroup orientation="vertical">
				<ResizablePanel defaultSize={30}>
					<PanelPlaceholder label="Header" />
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel defaultSize={70}>
					<PanelPlaceholder label="Content" />
				</ResizablePanel>
			</ResizablePanelGroup>
		</StoryContainer>
	),
};

// ── WithHandle ─────────────────────────────────────────

export const WithHandle: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add the `withHandle` prop to `ResizableHandle` to show a visible drag grip, making resize interactions more discoverable.',
			},
		},
	},
	render: () => (
		<StoryContainer>
			<ResizablePanelGroup orientation="horizontal">
				<ResizablePanel defaultSize={30}>
					<PanelPlaceholder label="Sidebar" />
				</ResizablePanel>
				<ResizableHandle withHandle />
				<ResizablePanel defaultSize={70}>
					<PanelPlaceholder label="Content" />
				</ResizablePanel>
			</ResizablePanelGroup>
		</StoryContainer>
	),
};
