import type { Meta, StoryObj } from '@storybook/react-vite';
import { LinksCard, LinksCardItem } from './';
import { Button } from '../button';
import { EllipsisVerticalIcon, ExternalLinkIcon, FileTextIcon } from 'lucide-react';

/**
 * LinksCard groups a list of quick-access links under a title. Each
 * `LinksCardItem` renders a full-width row with a trailing move-up-right icon
 * as an "open" affordance.
 */
const meta: Meta<typeof LinksCard> = {
	title: 'Components/LinksCard',
	component: LinksCard,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A quick-access card that groups links under a title. Compose it with <b>LinksCardItem</b> rows, each ending with an arrow-up-right icon by default. Items can be marked <code>disabled</code>; pass <code>disabledReason</code> to explain why in a tooltip, or swap the trailing icon with <code>endIcon</code>.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Gallery: All Variations ─────────────────────────────

export const AllVariations: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex max-w-md flex-col gap-6 py-8">
			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Default</h3>
				<LinksCard title="Reports">
					<LinksCardItem href="/desk/query-report/Material Requirements Planning Report">Material Requirements Planning</LinksCardItem>
					<LinksCardItem href="/desk/query-report/Work Order Consumed Materials">Work Order Consumed Materials</LinksCardItem>
					<LinksCardItem href="/desk/query-report/Production Planning Report">Production Planning Report</LinksCardItem>
				</LinksCard>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Description</h3>
				<LinksCard title="Quick Access" description="Shortcuts to the reports you open most often.">
					<LinksCardItem href="/desk/query-report/Job Card Summary">Job Card Summary</LinksCardItem>
					<LinksCardItem href="/desk/query-report/Downtime Analysis">Downtime Analysis</LinksCardItem>
				</LinksCard>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">With Action</h3>
				<LinksCard
					title="Reports"
					action={
						<Button variant="ghost" size="icon-xs" aria-label="More options">
							<EllipsisVerticalIcon />
						</Button>
					}
				>
					<LinksCardItem href="/desk/query-report/BOM Search">BOM Search</LinksCardItem>
					<LinksCardItem href="/desk/query-report/Production Analytics">Production Analytics</LinksCardItem>
				</LinksCard>
			</section>

			<section>
				<h3 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Disabled Items</h3>
				<LinksCard title="Reports">
					<LinksCardItem href="/desk/query-report/Material Requirements Planning Report">Material Requirements Planning</LinksCardItem>
					<LinksCardItem
						href="/desk/query-report/Production Planning Report"
						disabled
						disabledReason="You need to create these first: Work Order"
					>
						Production Planning Report
					</LinksCardItem>
				</LinksCard>
			</section>
		</div>
	),
};

// ── Default ─────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A titled card with a list of quick-access links. Each enabled row ends with a <code>MoveUpRight</code> icon indicating the link opens elsewhere.',
			},
		},
	},
	render: () => (
		<LinksCard title="Reports" className="w-80">
			<LinksCardItem href="/desk/query-report/Material Requirements Planning Report">Material Requirements Planning</LinksCardItem>
			<LinksCardItem href="/desk/query-report/Work Order Consumed Materials">Work Order Consumed Materials</LinksCardItem>
			<LinksCardItem href="/desk/query-report/Production Planning Report">Production Planning Report</LinksCardItem>
		</LinksCard>
	),
};

// ── With Description ────────────────────────────────────

export const WithDescription: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Pass an optional <code>description</code> to add a muted subtitle below the title.',
			},
		},
	},
	render: () => (
		<LinksCard title="Quick Access" description="Shortcuts to the reports you open most often." className="w-80">
			<LinksCardItem href="/desk/query-report/Job Card Summary">Job Card Summary</LinksCardItem>
			<LinksCardItem href="/desk/query-report/Downtime Analysis">Downtime Analysis</LinksCardItem>
			<LinksCardItem href="/desk/query-report/Quality Inspection Summary">Quality Inspection Summary</LinksCardItem>
		</LinksCard>
	),
};

// ── With Action ─────────────────────────────────────────

export const WithAction: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the <code>action</code> slot for a secondary control in the header, such as a menu or settings trigger.',
			},
		},
	},
	render: () => (
		<LinksCard
			title="Reports"
			className="w-80"
			action={
				<Button variant="ghost" size="icon-xs" aria-label="More options">
					<EllipsisVerticalIcon />
				</Button>
			}
		>
			<LinksCardItem href="/desk/query-report/BOM Search">BOM Search</LinksCardItem>
			<LinksCardItem href="/desk/query-report/Production Analytics">Production Analytics</LinksCardItem>
			<LinksCardItem href="/desk/query-report/BOM Operations Time">BOM Operations Time</LinksCardItem>
		</LinksCard>
	),
};

// ── Disabled ────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Mark an item <code>disabled</code> to mute it and remove its link. Pass <code>disabledReason</code> to explain why — it is shown in a tooltip on hover, e.g. when a feature depends on documents that have not been created yet.',
			},
		},
	},
	render: () => (
		<LinksCard title="Reports" className="w-80">
			<LinksCardItem href="/desk/query-report/Material Requirements Planning Report">Material Requirements Planning</LinksCardItem>
			<LinksCardItem
				href="/desk/query-report/Production Planning Report"
				disabled
				disabledReason="You need to create these first: Work Order"
			>
				Production Planning Report
			</LinksCardItem>
			<LinksCardItem
				href="/desk/query-report/Quality Inspection Summary"
				disabled
				disabledReason="You need to create these first: Quality Inspection"
			>
				Quality Inspection Summary
			</LinksCardItem>
			<LinksCardItem href="/desk/query-report/BOM Search" disabled disabledReason="You need to create these first: BOM">
				BOM Search
			</LinksCardItem>
		</LinksCard>
	),
};

// ── Custom End Icon ─────────────────────────────────────

export const CustomEndIcon: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Swap the default <code>MoveUpRight</code> icon by passing <code>endIcon</code> to any item.',
			},
		},
	},
	render: () => (
		<LinksCard title="Documentation" className="w-80">
			<LinksCardItem href="https://frappeframework.com/docs" endIcon={<ExternalLinkIcon className="size-4" />}>
				Framework Docs
			</LinksCardItem>
			<LinksCardItem href="https://frappeframework.com/docs/v15/user/en" endIcon={<FileTextIcon className="size-4" />}>
				User Manual
			</LinksCardItem>
			<LinksCardItem href="https://frappeframework.com/docs">Changelog</LinksCardItem>
		</LinksCard>
	),
};

// ── Burmese locale (မြန်မာ) ────────────────────────────────

/**
 * LinksCard with all UI text localized to Burmese (မြန်မာ). Useful for
 * verifying how the rows handle a tall-script locale — truncation,
 * line-height, and the end icon alignment with the Noto Sans Myanmar font.
 */
export const BurmeseLocale: Story = {
	name: 'Burmese Locale (မြန်မာ)',
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				story:
					'The Reports card with all labels localized to Burmese (မြန်မာ), shown next to the English original for comparison. Verify truncation and row height with the tall Myanmar script, and hover a disabled item to see the localized reason tooltip.',
			},
		},
	},
	render: () => (
		<div className="mx-auto flex max-w-2xl flex-wrap items-start gap-6 py-8">
			<div className="flex flex-col gap-2">
				<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">English</span>
				<LinksCard title="Reports" className="w-80">
					<LinksCardItem href="/desk/query-report/Material Requirements Planning Report">Material Requirements Planning</LinksCardItem>
					<LinksCardItem href="/desk/query-report/Work Order Consumed Materials">Work Order Consumed Materials</LinksCardItem>
					<LinksCardItem
						href="/desk/query-report/Production Planning Report"
						disabled
						disabledReason="You need to create these first: Work Order"
					>
						Production Planning Report
					</LinksCardItem>
				</LinksCard>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">မြန်မာ (Burmese)</span>
				<LinksCard title="အစီရင်ခံစာများ" className="w-80">
					<LinksCardItem href="/desk/query-report/Material Requirements Planning Report">ပစ္စည်းလိုအပ်ချက် စီမံကိန်း</LinksCardItem>
					<LinksCardItem href="/desk/query-report/Work Order Consumed Materials">အလုပ်အမိန့် သုံးစွဲပစ္စည်းများ</LinksCardItem>
					<LinksCardItem
						href="/desk/query-report/Production Planning Report"
						disabled
						disabledReason="အရင်ဦးစွာ ဖန်တီးရန် လိုအပ်သည်: အလုပ်အမိန့်"
					>
						ထုတ်လုပ်မှု စီမံကိန်း အစီရင်ခံစာ
					</LinksCardItem>
				</LinksCard>
			</div>
		</div>
	),
};
