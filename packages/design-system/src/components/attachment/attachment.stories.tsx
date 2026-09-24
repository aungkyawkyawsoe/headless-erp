import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	Attachment,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentContent,
	AttachmentTitle,
	AttachmentDescription,
	AttachmentActions,
	AttachmentAction,
	AttachmentTrigger,
} from './';
import {
	FileTextIcon,
	FileCodeIcon,
	TableIcon,
	CheckIcon,
	ClockIcon,
	FileWarningIcon,
	RefreshCwIcon,
	CopyIcon,
	FileSearchIcon,
	XIcon,
} from 'lucide-react';

/**
 * Attachment displays file metadata with an icon or thumbnail preview,
 * along with actions like remove, retry, or preview. Supports multiple
 * states (idle, uploading, processing, error, done) and sizes.
 */
const meta: Meta<typeof Attachment> = {
	title: 'Components/Attachment',
	component: Attachment,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A composable file attachment component. Use <b>AttachmentGroup</b> for horizontal scrolling galleries. Supports horizontal and vertical orientations, three sizes, and five states.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Group (mixed) ─────────────────────────────────────

export const Group: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<AttachmentGroup className="mx-auto max-w-sm py-8">
			{[
				{
					name: 'briefing-notes.pdf',
					meta: 'PDF · 1.4 MB',
					icon: FileTextIcon,
				},
				{
					name: 'workspace.png',
					meta: 'PNG · 820 KB',
					src: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=80',
				},
				{ name: 'customers.csv', meta: 'CSV · 18 KB', icon: TableIcon },
				{ name: 'renderer.tsx', meta: 'TSX · 12 KB', icon: FileCodeIcon },
			].map((item) => {
				const Icon = item.icon;
				return (
					<Attachment key={item.name}>
						{item.src ? (
							<AttachmentMedia variant="image">
								<img src={item.src} alt={item.name} />
							</AttachmentMedia>
						) : Icon ? (
							<AttachmentMedia>
								<Icon />
							</AttachmentMedia>
						) : null}
						<AttachmentContent>
							<AttachmentTitle>{item.name}</AttachmentTitle>
							<AttachmentDescription>{item.meta}</AttachmentDescription>
						</AttachmentContent>
						<AttachmentActions>
							<AttachmentAction aria-label={`Remove ${item.name}`}>
								<XIcon />
							</AttachmentAction>
						</AttachmentActions>
					</Attachment>
				);
			})}
		</AttachmentGroup>
	),
};

// ── Single file ───────────────────────────────────────

export const SingleFile: Story = {
	render: () => (
		<div className="py-8">
			<Attachment className="w-full max-w-sm">
				<AttachmentMedia>
					<FileCodeIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>message-renderer.tsx</AttachmentTitle>
					<AttachmentDescription>TypeScript · 12 KB</AttachmentDescription>
				</AttachmentContent>
				<AttachmentActions>
					<AttachmentAction aria-label="Remove message-renderer.tsx">
						<XIcon />
					</AttachmentAction>
				</AttachmentActions>
			</Attachment>
		</div>
	),
};

// ── Sizes ─────────────────────────────────────────────

export const Sizes: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex w-full max-w-sm flex-col gap-3 py-8">
			<Attachment size="default" className="w-full">
				<AttachmentMedia>
					<FileTextIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>Default attachment</AttachmentTitle>
					<AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
				</AttachmentContent>
			</Attachment>

			<Attachment size="sm" className="w-full">
				<AttachmentMedia>
					<FileTextIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>Small attachment</AttachmentTitle>
					<AttachmentDescription>PDF · 2.4 MB</AttachmentDescription>
				</AttachmentContent>
			</Attachment>

			<Attachment size="xs" className="w-full">
				<AttachmentMedia>
					<FileTextIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>Extra small attachment</AttachmentTitle>
				</AttachmentContent>
			</Attachment>
		</div>
	),
};

// ── All states ────────────────────────────────────────

export const States: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<div className="mx-auto flex w-full max-w-sm flex-col gap-2 py-8">
			<Attachment state="idle" className="w-full">
				<AttachmentMedia>
					<ClockIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>selected-file.pdf</AttachmentTitle>
					<AttachmentDescription>Ready to upload</AttachmentDescription>
				</AttachmentContent>
				<AttachmentActions>
					<AttachmentAction aria-label="Remove selected-file.pdf">
						<XIcon />
					</AttachmentAction>
				</AttachmentActions>
			</Attachment>

			<Attachment state="uploading" className="w-full">
				<AttachmentMedia>
					<ClockIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>design-system.zip</AttachmentTitle>
					<AttachmentDescription>Uploading · 64%</AttachmentDescription>
				</AttachmentContent>
				<AttachmentActions>
					<AttachmentAction aria-label="Cancel upload">
						<XIcon />
					</AttachmentAction>
				</AttachmentActions>
			</Attachment>

			<Attachment state="processing" className="w-full">
				<AttachmentMedia>
					<FileTextIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>market-research.pdf</AttachmentTitle>
					<AttachmentDescription>Processing document</AttachmentDescription>
				</AttachmentContent>
				<AttachmentActions>
					<AttachmentAction aria-label="Remove market-research.pdf">
						<XIcon />
					</AttachmentAction>
				</AttachmentActions>
			</Attachment>

			<Attachment state="error" className="w-full">
				<AttachmentMedia>
					<FileWarningIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>financial-model.xlsx</AttachmentTitle>
					<AttachmentDescription>Upload failed. Try again.</AttachmentDescription>
				</AttachmentContent>
				<AttachmentActions>
					<AttachmentAction aria-label="Retry upload">
						<RefreshCwIcon />
					</AttachmentAction>
					<AttachmentAction aria-label="Remove financial-model.xlsx">
						<XIcon />
					</AttachmentAction>
				</AttachmentActions>
			</Attachment>

			<Attachment state="done" className="w-full">
				<AttachmentMedia>
					<CheckIcon />
				</AttachmentMedia>
				<AttachmentContent>
					<AttachmentTitle>uploaded-report.pdf</AttachmentTitle>
					<AttachmentDescription>Uploaded · 1.8 MB</AttachmentDescription>
				</AttachmentContent>
				<AttachmentActions>
					<AttachmentAction aria-label="Remove uploaded-report.pdf">
						<XIcon />
					</AttachmentAction>
				</AttachmentActions>
			</Attachment>
		</div>
	),
};

// ── Orientation: vertical ─────────────────────────────

export const Vertical: Story = {
	parameters: { layout: 'padded' },
	render: () => (
		<AttachmentGroup className="mx-auto max-w-sm py-8">
			{[
				{
					name: 'workspace.png',
					meta: 'PNG · 820 KB',
					src: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=900&auto=format&fit=crop&q=80',
					alt: 'Workspace',
				},
				{
					name: 'desk-reference.jpg',
					meta: 'JPG · 1.1 MB',
					src: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=900&auto=format&fit=crop&q=80',
					alt: 'Desk',
				},
				{
					name: 'office-reference.jpg',
					meta: 'JPG · 940 KB',
					src: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=900&auto=format&fit=crop&q=80',
					alt: 'Office',
				},
			].map((image) => (
				<Attachment key={image.name} orientation="vertical">
					<AttachmentMedia variant="image">
						<img src={image.src} alt={image.alt} />
					</AttachmentMedia>
					<AttachmentContent>
						<AttachmentTitle>{image.name}</AttachmentTitle>
						<AttachmentDescription>{image.meta}</AttachmentDescription>
					</AttachmentContent>
				</Attachment>
			))}
		</AttachmentGroup>
	),
};

// ── With trigger (Dialog integration) ─────────────────

export const WithTrigger: Story = {
	parameters: { layout: 'centered' },
	render: () => (
		<div className="py-8">
			<div className="relative w-full max-w-sm">
				<Attachment className="w-full">
					<AttachmentMedia>
						<FileSearchIcon />
					</AttachmentMedia>
					<AttachmentContent>
						<AttachmentTitle>research-summary.pdf</AttachmentTitle>
						<AttachmentDescription>Open preview dialog</AttachmentDescription>
					</AttachmentContent>
					<AttachmentActions>
						<AttachmentAction aria-label="Copy link">
							<CopyIcon />
						</AttachmentAction>
						<AttachmentAction aria-label="Remove research-summary.pdf">
							<XIcon />
						</AttachmentAction>
					</AttachmentActions>
					<AttachmentTrigger aria-label="Preview research-summary.pdf" />
				</Attachment>
			</div>
			<p className="mt-4 text-center text-xs text-muted-foreground">
				The trigger overlay covers the attachment (excluding actions). Click anywhere on the card to trigger its action.
			</p>
		</div>
	),
};
