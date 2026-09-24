import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChoiceCard, ChoiceCardContent, ChoiceCardTitle, ChoiceCardDescription } from './';
import { Checkbox } from '../checkbox';
import { RadioGroup, RadioGroupItem } from '../radio-group';
import { CloudIcon, ServerIcon, ContainerIcon } from 'lucide-react';

/**
 * `ChoiceCard` renders a selectable card with the input positioned
 * at the top-right. Clicking anywhere on the card toggles the checkbox
 * or radio inside.
 *
 * Compose with `ChoiceCardContent`, `ChoiceCardTitle`, and
 * `ChoiceCardDescription` for a structured layout, or use
 * `FieldContent` / `FieldTitle` / `FieldDescription` directly.
 *
 * Works with both `Checkbox` (multi-select) and `RadioGroupItem`
 * (single-select via `RadioGroup`).
 */
const meta: Meta<typeof ChoiceCard> = {
	title: 'Components/ChoiceCard',
	component: ChoiceCard,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A card-style selectable option built on `FieldLabel`. The input (checkbox or radio) is positioned at the **top-right** and the content (title + description) takes the left side. The entire card is clickable via the native label behavior.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Checkbox (Multi-select) ──────────────────────────────

export const CheckboxChoice: Story = {
	name: 'Checkbox (Multi-select)',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Use `ChoiceCard` with `Checkbox` for multi-select scenarios. Each card toggles independently. The checkbox is positioned at the top-right of the card.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-3">
			<p className="text-sm font-medium">Compute Environments</p>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Kubernetes</ChoiceCardTitle>
					<ChoiceCardDescription>Managed Kubernetes cluster with auto-scaling and load balancing.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="choice-cb-k8s" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Virtual Machine</ChoiceCardTitle>
					<ChoiceCardDescription>Dedicated virtual machine with root access and custom images.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="choice-cb-vm" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Bare Metal</ChoiceCardTitle>
					<ChoiceCardDescription>Physical server with no virtualization overhead.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="choice-cb-bm" />
			</ChoiceCard>
		</div>
	),
};

// ── Radio (Single-select) ─────────────────────────────────

export const RadioChoice: Story = {
	name: 'Radio (Single-select)',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'Wrap `ChoiceCard` components in a `RadioGroup` for single-select scenarios. Only one option can be selected at a time. The radio indicator is positioned at the top-right of each card.',
			},
		},
	},
	render: () => (
		<RadioGroup defaultValue="pro" className="w-80">
			<p className="text-sm font-medium">Subscription Plan</p>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Plus</ChoiceCardTitle>
					<ChoiceCardDescription>For individuals and small teams. Up to 5 projects.</ChoiceCardDescription>
				</ChoiceCardContent>
				<RadioGroupItem value="plus" id="choice-radio-plus" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Pro</ChoiceCardTitle>
					<ChoiceCardDescription>For growing businesses. Unlimited projects and team members.</ChoiceCardDescription>
				</ChoiceCardContent>
				<RadioGroupItem value="pro" id="choice-radio-pro" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Enterprise</ChoiceCardTitle>
					<ChoiceCardDescription>For large teams with advanced security and compliance needs.</ChoiceCardDescription>
				</ChoiceCardContent>
				<RadioGroupItem value="enterprise" id="choice-radio-enterprise" />
			</ChoiceCard>
		</RadioGroup>
	),
};

// ── Icons ─────────────────────────────────────────────────

export const WithIcons: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Add an icon before the title for visual distinction. The icon sits inline with the title on the left side.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-3">
			<p className="text-sm font-medium">Deployment Options</p>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>
						<CloudIcon className="size-4" />
						Cloud
					</ChoiceCardTitle>
					<ChoiceCardDescription>Deploy to our managed cloud infrastructure.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="choice-icon-cloud" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>
						<ServerIcon className="size-4" />
						On-Premises
					</ChoiceCardTitle>
					<ChoiceCardDescription>Install and run on your own servers.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="choice-icon-onprem" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>
						<ContainerIcon className="size-4" />
						Container
					</ChoiceCardTitle>
					<ChoiceCardDescription>Docker image deployment with orchestration.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="choice-icon-container" />
			</ChoiceCard>
		</div>
	),
};

// ── Checked State Preview ─────────────────────────────────

export const CheckedStates: Story = {
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story: 'Preview of checked and unchecked states. Cards with `data-checked` show a highlighted border and subtle background tint.',
			},
		},
	},
	render: () => (
		<div className="flex w-80 flex-col gap-3">
			<p className="text-sm font-medium">Storage Tier</p>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Standard</ChoiceCardTitle>
					<ChoiceCardDescription>General-purpose storage with balanced performance.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="checked-default" />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>Premium SSD</ChoiceCardTitle>
					<ChoiceCardDescription>High-performance SSD storage for demanding workloads.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="checked-premium" defaultChecked />
			</ChoiceCard>
			<ChoiceCard>
				<ChoiceCardContent>
					<ChoiceCardTitle>NVMe</ChoiceCardTitle>
					<ChoiceCardDescription>Ultra-fast NVMe storage for latency-sensitive applications.</ChoiceCardDescription>
				</ChoiceCardContent>
				<Checkbox id="checked-nvme" />
			</ChoiceCard>
		</div>
	),
};
