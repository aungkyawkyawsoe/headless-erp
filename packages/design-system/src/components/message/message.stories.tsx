import type { Meta, StoryObj } from '@storybook/react-vite';
import { MessageGroup, Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter } from './';
import { Bubble, BubbleContent } from '../bubble';

/**
 * A chat message layout component that composes avatar, header, content,
 * and footer slots with start/end alignment. Pair with `Bubble` for the
 * message body.
 */
const meta: Meta<typeof Message> = {
	title: 'Components/Message',
	component: Message,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A composable chat message layout. Use `<Message>` with `<MessageAvatar>`, `<MessageHeader>`, `<MessageContent>`, and `<MessageFooter>` to build consistent message threads. Pair with `<Bubble>` for the message body.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default (start-aligned, incoming) ─────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'An incoming message aligned to the start with avatar, header (name), bubble content, and footer (timestamp).',
			},
		},
	},
	render: () => (
		<Message className="mx-auto max-w-lg">
			<MessageAvatar>
				<div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">JD</div>
			</MessageAvatar>
			<MessageContent>
				<MessageHeader>Jane Doe</MessageHeader>
				<Bubble variant="secondary" align="start">
					<BubbleContent>Hey, have you reviewed the pull request?</BubbleContent>
				</Bubble>
				<MessageFooter>2 min ago</MessageFooter>
			</MessageContent>
		</Message>
	),
};

// ── End-aligned (outgoing) ────────────────────────────

export const Outgoing: Story = {
	parameters: {
		docs: {
			description: {
				story: 'An outgoing message aligned to the end. The avatar, header, footer, and bubble are right-aligned automatically.',
			},
		},
	},
	render: () => (
		<Message align="end" className="mx-auto max-w-lg">
			<MessageAvatar>
				<div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
					ME
				</div>
			</MessageAvatar>
			<MessageContent>
				<MessageHeader>You</MessageHeader>
				<Bubble variant="default" align="end">
					<BubbleContent>Just finished reviewing it. Looks good to me!</BubbleContent>
				</Bubble>
				<MessageFooter>Just now</MessageFooter>
			</MessageContent>
		</Message>
	),
};

// ── Thread (multiple messages) ────────────────────────

export const Thread: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A message thread with alternating incoming and outgoing messages, grouped using `MessageGroup`.',
			},
		},
	},
	render: () => (
		<MessageGroup className="mx-auto max-w-lg">
			<Message>
				<MessageAvatar>
					<div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">JD</div>
				</MessageAvatar>
				<MessageContent>
					<MessageHeader>Jane Doe</MessageHeader>
					<Bubble variant="secondary" align="start">
						<BubbleContent>Can you deploy the latest build to staging?</BubbleContent>
					</Bubble>
					<MessageFooter>10 min ago</MessageFooter>
				</MessageContent>
			</Message>

			<Message align="end">
				<MessageAvatar>
					<div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
						ME
					</div>
				</MessageAvatar>
				<MessageContent>
					<MessageHeader>You</MessageHeader>
					<Bubble variant="default" align="end">
						<BubbleContent>Sure, I&apos;ll trigger the deployment now.</BubbleContent>
					</Bubble>
					<MessageFooter>8 min ago</MessageFooter>
				</MessageContent>
			</Message>

			<Message>
				<MessageAvatar>
					<div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">JD</div>
				</MessageAvatar>
				<MessageContent>
					<MessageHeader>Jane Doe</MessageHeader>
					<Bubble variant="secondary" align="start">
						<BubbleContent>Thanks! Let me know when it&apos;s up.</BubbleContent>
					</Bubble>
					<MessageFooter>5 min ago</MessageFooter>
				</MessageContent>
			</Message>

			<Message align="end">
				<MessageAvatar>
					<div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
						ME
					</div>
				</MessageAvatar>
				<MessageContent>
					<MessageHeader>You</MessageHeader>
					<Bubble variant="default" align="end">
						<BubbleContent>Deployment complete. It&apos;s live on staging 🚀</BubbleContent>
					</Bubble>
					<MessageFooter>Just now</MessageFooter>
				</MessageContent>
			</Message>
		</MessageGroup>
	),
};
