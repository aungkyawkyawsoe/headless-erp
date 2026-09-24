import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import {
	MessageScrollerProvider,
	MessageScroller,
	MessageScrollerViewport,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerButton,
	useMessageScroller,
	useMessageScrollerScrollable,
	useMessageScrollerVisibility,
} from './';
import { Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter } from '@/message';
import { Bubble, BubbleContent } from '@/bubble';
import { Button } from '@/button';
import { ArrowDownIcon, ArrowUpIcon, LoaderIcon, ListIcon } from 'lucide-react';

/**
 * `MessageScroller` is a chat transcript scroller that handles anchoring turns,
 * following streamed responses, loading history without jumping, and jumping to
 * any message — all without moving the reader against their intent.
 *
 * Wrap your transcript in `<MessageScrollerProvider>` and compose the frame with
 * `<MessageScroller>`, `<MessageScrollerViewport>`, `<MessageScrollerContent>`,
 * `<MessageScrollerItem>`, and `<MessageScrollerButton>`.
 */
const meta: Meta<typeof MessageScroller> = {
	title: 'Components/MessageScroller',
	component: MessageScroller,
	parameters: {
		layout: 'fullscreen',
		docs: {
			description: {
				component:
					'A chat scroll container that anchors turns, opens at the right position, follows streamed responses, loads history without jumping, and lets readers jump to any message. Composes with `Message` and `Bubble` for a complete chat UI.',
			},
		},
	},
	tags: ['autodocs'],
	decorators: [
		(Story) => (
			<div className="mx-auto flex h-150 w-full max-w-2xl border-x border-border">
				<Story />
			</div>
		),
	],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Helpers ───────────────────────────────────────────────

const messages = [
	{
		id: '1',
		role: 'user' as const,
		name: 'You',
		content:
			"I'm building a chat for our app and the scroll behavior is driving me nuts. Every time the AI streams a reply, the whole thread jumps around.",
		time: '2 min ago',
	},
	{
		id: '2',
		role: 'assistant' as const,
		name: 'Assistant',
		content:
			"That's the classic streaming scroll problem. Wrap your message list in `MessageScroller` and turn on `autoScroll` — the viewport pins to the bottom as tokens arrive, so users always see the latest text land in place.\n\nThe important part: it only auto-scrolls while the reader is already at the bottom. The moment they scroll up to read something earlier, auto-scroll backs off and their position is preserved.",
		time: '1 min ago',
	},
	{
		id: '3',
		role: 'user' as const,
		name: 'You',
		content: 'Okay, but when someone sends a new message the view still feels jarring — like the whole conversation reloads from the top.',
		time: 'Just now',
	},
	{
		id: '4',
		role: 'assistant' as const,
		name: 'Assistant',
		content:
			"Use `scrollAnchor` on the user's message to anchor the new turn near the top of the viewport. When a new anchor is appended, the viewport moves it near the top and keeps a peek of the previous item above it, so the new turn doesn't feel detached from its context.",
		time: 'Just now',
	},
];

function ChatMessage({ message }: { message: (typeof messages)[number] }) {
	const isUser = message.role === 'user';
	return (
		<Message align={isUser ? 'end' : 'start'}>
			{!isUser && (
				<MessageAvatar>
					<div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">AI</div>
				</MessageAvatar>
			)}
			<MessageContent>
				{!isUser && <MessageHeader>Assistant</MessageHeader>}
				{isUser && <MessageHeader>You</MessageHeader>}
				<Bubble variant={isUser ? 'default' : 'secondary'} align={isUser ? 'end' : 'start'}>
					<BubbleContent>{message.content}</BubbleContent>
				</Bubble>
				<MessageFooter>{message.time}</MessageFooter>
			</MessageContent>
			{isUser && (
				<MessageAvatar>
					<div className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
						ME
					</div>
				</MessageAvatar>
			)}
		</Message>
	);
}

// ── Simple Chat ───────────────────────────────────────────

export const SimpleChat: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'A basic chat transcript with alternating user and assistant messages. The scroller renders inside a height-constrained parent container.',
			},
		},
	},
	render: () => (
		<MessageScrollerProvider>
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="px-4">
						{messages.map((msg) => (
							<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
								<ChatMessage message={msg} />
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	),
};

// ── Anchoring Turns ───────────────────────────────────────

function AnchoringTurnsDemo() {
	const [items, setItems] = React.useState([
		{
			id: '1',
			role: 'user' as const,
			name: 'You',
			content: "What's the best way to handle streaming in a chat UI?",
			time: '5 min ago',
		},
		{
			id: '2',
			role: 'assistant' as const,
			name: 'Assistant',
			content:
				'The best approach is to use a dedicated scroll container that understands turns. Anchor each user message near the top of the viewport so the conversation reads naturally from top to bottom.',
			time: '4 min ago',
		},
	]);

	const addMessage = () => {
		const id = String(Date.now());
		setItems((prev) => [
			...prev,
			{
				id,
				role: 'user',
				name: 'You',
				content: 'Can you show me how anchoring works?',
				time: 'Just now',
			},
			{
				id: `${id}-reply`,
				role: 'assistant',
				name: 'Assistant',
				content:
					'Sure! Mark the user message with `scrollAnchor`. When a new turn anchors, the viewport settles it near the top and keeps a peek of the previous turn above it for context.',
				time: 'Just now',
			},
		]);
	};

	return (
		<div className="flex h-full flex-col">
			<MessageScrollerProvider>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent className="px-4">
							{items.map((msg) => (
								<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
									<ChatMessage message={msg} />
								</MessageScrollerItem>
							))}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<div className="flex items-center gap-2 border-t border-border p-4">
				<p className="text-xs text-muted-foreground">Send a message to see anchoring in action</p>
				<Button size="sm" onClick={addMessage} className="ml-auto">
					Send Message
				</Button>
			</div>
		</div>
	);
}

export const AnchoringTurns: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'When `scrollAnchor` is set on a `MessageScrollerItem`, the viewport moves that row near the top edge. This keeps the new turn readable from the start while preserving context from the previous message.',
			},
		},
	},
	render: () => <AnchoringTurnsDemo />,
};

// ── Keeping Context Visible ───────────────────────────────

function KeepingContextVisibleDemo() {
	const [items, setItems] = React.useState([
		{
			id: '1',
			role: 'user' as const,
			name: 'You',
			content:
				"I'm building a chat for our app and the scroll behavior is driving me nuts. Every time the AI streams a reply, the whole thread jumps around.",
			time: '2 min ago',
		},
		{
			id: '2',
			role: 'assistant' as const,
			name: 'Assistant',
			content:
				"That's the classic streaming scroll problem. Wrap your message list in `MessageScroller` and turn on `autoScroll` — the viewport pins to the bottom as tokens arrive.",
			time: '1 min ago',
		},
	]);

	const [peek, setPeek] = React.useState(64);

	const addMessage = () => {
		setItems((prev) => [
			...prev,
			{
				id: String(Date.now()),
				role: 'user',
				name: 'You',
				content: 'Okay, but when someone sends a new message the view still feels jarring.',
				time: 'Just now',
			},
			{
				id: `${Date.now()}-reply`,
				role: 'assistant',
				name: 'Assistant',
				content:
					'Adjust the `scrollPreviousItemPeek` amount on the provider to control how much of the previous turn stays visible above the anchor.',
				time: 'Just now',
			},
		]);
	};

	return (
		<div className="flex h-full flex-col">
			<MessageScrollerProvider scrollPreviousItemPeek={peek}>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent className="px-4">
							{items.map((msg) => (
								<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
									<ChatMessage message={msg} />
								</MessageScrollerItem>
							))}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<div className="flex items-center gap-4 border-t border-border p-4">
				<label className="flex items-center gap-2 text-xs text-muted-foreground">
					Peek: {peek}px
					<input
						type="range"
						min={0}
						max={200}
						step={8}
						value={peek}
						onChange={(e) => setPeek(Number(e.target.value))}
						className="w-24 accent-foreground"
					/>
				</label>
				<Button size="sm" onClick={addMessage} className="ml-auto">
					Send
				</Button>
			</div>
		</div>
	);
}

export const KeepingContextVisible: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`scrollPreviousItemPeek` controls how many pixels of the previous turn remain visible above the newly anchored row. Adjust the slider to see how it affects the conversation.',
			},
		},
	},
	render: () => <KeepingContextVisibleDemo />,
};

// ── Following the Live Edge with AutoScroll ───────────────

const streamResponses = [
	'The deployment pipeline consists of three stages.',
	'First, the code is built and tested in the CI environment.',
	'Then, the artifacts are pushed to a container registry.',
	'Finally, the orchestrator performs a rolling update across the cluster.',
	'Each stage has health checks and automatic rollback on failure.',
	'The entire process takes about 4-5 minutes for a typical deploy.',
];

function LiveEdgeDemo() {
	const [items, setItems] = React.useState([
		{
			id: '1',
			role: 'user' as const,
			name: 'You',
			content: 'How does the deployment pipeline work?',
			time: '1 min ago',
		},
		{
			id: '2',
			role: 'assistant' as const,
			name: 'Assistant',
			content: 'Let me walk you through our deployment process.',
			time: 'Just now',
		},
	]);
	const [streaming, setStreaming] = React.useState(false);
	const [streamedContent, setStreamedContent] = React.useState('');

	const startStreaming = () => {
		if (streaming) return;
		setStreaming(true);
		setStreamedContent('');

		let idx = 0;
		const interval = setInterval(() => {
			if (idx < streamResponses.length) {
				setStreamedContent((prev) => (prev ? `${prev}\n\n${streamResponses[idx]}` : streamResponses[idx]));
				idx++;
			} else {
				clearInterval(interval);
				setStreaming(false);
				setItems((prev) => [
					...prev,
					{
						id: 'stream-complete',
						role: 'assistant',
						name: 'Assistant',
						content: streamResponses.join(' '),
						time: 'Just now',
					},
				]);
				setStreamedContent('');
			}
		}, 800);
	};

	return (
		<div className="flex h-full flex-col">
			<MessageScrollerProvider autoScroll>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent className="px-4">
							{items.map((msg) => (
								<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
									<ChatMessage message={msg} />
								</MessageScrollerItem>
							))}
							{streaming && streamedContent && (
								<MessageScrollerItem messageId="streaming" scrollAnchor={false}>
									<Message>
										<MessageAvatar>
											<div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
												AI
											</div>
										</MessageAvatar>
										<MessageContent>
											<MessageHeader>Assistant</MessageHeader>
											<Bubble variant="secondary" align="start">
												<BubbleContent>
													{streamedContent}
													<span className="ml-1 inline-flex animate-pulse">▊</span>
												</BubbleContent>
											</Bubble>
										</MessageContent>
									</Message>
								</MessageScrollerItem>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<div className="flex items-center gap-2 border-t border-border p-4">
				<p className="text-xs text-muted-foreground">
					{streaming ? 'Streaming response...' : 'Press Stream to simulate AI response streaming'}
				</p>
				<Button size="sm" onClick={startStreaming} disabled={streaming} className="ml-auto">
					{streaming ? (
						<>
							<LoaderIcon className="animate-spin" />
							Streaming...
						</>
					) : (
						'Stream'
					)}
				</Button>
			</div>
		</div>
	);
}

export const LiveEdge: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'With `autoScroll`, the viewport follows the live edge as new tokens arrive. Scroll away to pause following; press the scroll button to return to the latest content.',
			},
		},
	},
	render: () => <LiveEdgeDemo />,
};

// ── Opening Saved Threads ─────────────────────────────────

function OpeningPositionDemo({ position }: { position: 'start' | 'end' | 'last-anchor' }) {
	const items = React.useMemo(
		() => [
			{
				id: '1',
				role: 'user' as const,
				name: 'You',
				content: 'This is the first message the user sent in the conversation.',
				time: '1 hour ago',
			},
			{
				id: '2',
				role: 'assistant' as const,
				name: 'Assistant',
				content: 'Workspace creation rose 8%, but first invite completion only rose 2%.',
				time: '1 hour ago',
			},
			{
				id: '3',
				role: 'user' as const,
				name: 'You',
				content: 'This is the last message the user sent in the conversation.',
				time: 'Just now',
			},
			{
				id: '4',
				role: 'assistant' as const,
				name: 'Assistant',
				content:
					'Start with the invite step. Teams are creating workspaces but waiting to add collaborators.\n\nRecommended follow-up:\n\n1. Compare invite drop-off by account size.\n2. Check whether users who skip invites still return within 24 hours.\n3. Review the empty-state copy on the first project screen.\n4. Segment activation by template, since template users may not need invites right away.\n\nIf that pattern holds, the next experiment should make collaboration useful earlier instead of prompting for invites harder.',
				time: 'Just now',
			},
		],
		[],
	);

	return (
		<MessageScrollerProvider defaultScrollPosition={position}>
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="px-4">
						{items.map((msg) => (
							<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
								<ChatMessage message={msg} />
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

// ── Loading Earlier Messages
export const OpeningSavedThreads: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Use `defaultScrollPosition` to control where a saved transcript opens. `"last-anchor"` shows the last meaningful turn with the reply below it. `"start"` opens at the beginning, and `"end"` at the absolute latest message.',
			},
		},
	},
	render: () => <OpeningPositionDemo position="last-anchor" />,
};

// ── Loading Earlier Messages ──────────────────────────────

function LoadHistoryDemo() {
	const [items, setItems] = React.useState([
		{
			id: '4',
			role: 'user' as const,
			name: 'You',
			content: 'Do we need to roll back?',
			time: '2 min ago',
		},
		{
			id: '5',
			role: 'assistant' as const,
			name: 'Assistant',
			content:
				'Not yet. Queue depth is recovering after we reduced retry concurrency, and the oldest pending job is now under five minutes old.\n\nKeep rollback ready if the queue starts climbing again, but the current trend points toward recovery.',
			time: '1 min ago',
		},
		{
			id: '6',
			role: 'user' as const,
			name: 'You',
			content: 'What actions are open?',
			time: 'Just now',
		},
		{
			id: '7',
			role: 'assistant' as const,
			name: 'Assistant',
			content:
				'Keep the retry window enabled until the next deploy, then add a queue-depth alert as the long-term fix.\n\nThe alert should fire on sustained queue growth, not a single short spike.',
			time: 'Just now',
		},
	]);
	const [historyLoaded, setHistoryLoaded] = React.useState(false);
	const [loading, setLoading] = React.useState(false);

	const loadHistory = () => {
		if (loading || historyLoaded) return;
		setLoading(true);
		setTimeout(() => {
			setItems((prev) => [
				{
					id: '1',
					role: 'user' as const,
					name: 'You',
					content: 'Only the export queue worker changed. The deploy moved large CSV jobs onto the shared retry policy.',
					time: '10 min ago',
				},
				{
					id: '2',
					role: 'assistant' as const,
					name: 'Assistant',
					content: 'The app deploy did not include checkout, pricing, or billing API changes.',
					time: '9 min ago',
				},
				{
					id: '3',
					role: 'user' as const,
					name: 'You',
					content: "We're seeing activation dip after workspace creation. Can you help me find the likely step?",
					time: '5 min ago',
				},
				...prev,
			]);
			setHistoryLoaded(true);
			setLoading(false);
		}, 1000);
	};

	return (
		<div className="flex h-full flex-col">
			<MessageScrollerProvider>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent className="px-4">
							{items.map((msg) => (
								<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
									<ChatMessage message={msg} />
								</MessageScrollerItem>
							))}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>
			<div className="flex items-center gap-2 border-t border-border p-4">
				<p className="text-xs text-muted-foreground">
					{historyLoaded ? 'All messages loaded' : 'Click to load earlier messages without losing your place'}
				</p>
				<Button size="sm" onClick={loadHistory} disabled={loading || historyLoaded} className="ml-auto">
					{loading ? (
						<>
							<LoaderIcon className="animate-spin" />
							Loading...
						</>
					) : historyLoaded ? (
						'Loaded'
					) : (
						'Load History'
					)}
				</Button>
			</div>
		</div>
	);
}

export const LoadHistory: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Loading earlier messages prepends rows above the current viewport. `MessageScrollerViewport` preserves the visible row so the reader stays in place while history loads above.',
			},
		},
	},
	render: () => <LoadHistoryDemo />,
};

// ── Jumping to Messages ───────────────────────────────────

const longMessages = [
	{
		id: '1',
		role: 'user' as const,
		name: 'You',
		content: "We're seeing activation dip after workspace creation. Can you help me find the likely step?",
		time: '30 min ago',
	},
	{
		id: '2',
		role: 'assistant' as const,
		name: 'Assistant',
		content:
			'The sharpest drop is between creating the workspace and inviting the first teammate.\n\nWorkspace creation is still healthy, but the invite step is where users pause. That suggests the product is asking for collaboration before the user has enough confidence in the workspace.',
		time: '29 min ago',
	},
	{
		id: '3',
		role: 'user' as const,
		name: 'You',
		content: 'What should I compare before we change the onboarding flow?',
		time: '25 min ago',
	},
	{
		id: '4',
		role: 'assistant' as const,
		name: 'Assistant',
		content:
			'Compare three cohorts:\n\n1. Users who choose a template before inviting teammates.\n2. Users who start from a blank workspace.\n3. Users who skip invites and return within 24 hours.\n\nIf template users invite faster, the fix is probably better first-run guidance rather than a louder invite prompt.',
		time: '24 min ago',
	},
	{
		id: '5',
		role: 'user' as const,
		name: 'You',
		content: 'Can you turn that into an experiment?',
		time: '20 min ago',
	},
	{
		id: '6',
		role: 'assistant' as const,
		name: 'Assistant',
		content:
			'Yes. Create a variant that shows a short checklist after workspace creation:\n\n- Pick a template.\n- Add one project detail.\n- Invite a teammate when the workspace has context.\n\nMeasure first invite completion, 24-hour return rate, and whether teams create a second project.',
		time: '19 min ago',
	},
	{
		id: '7',
		role: 'user' as const,
		name: 'You',
		content: "What's the risk if we delay the invite prompt?",
		time: '15 min ago',
	},
	{
		id: '8',
		role: 'assistant' as const,
		name: 'Assistant',
		content:
			'The main risk is reducing team creation for accounts that already know who they want to invite.\n\nTo protect that path, keep the invite action visible in the header and only change the primary empty-state guidance. That gives confident teams a direct route without forcing uncertain users through the invite step too early.',
		time: '14 min ago',
	},
];

function JumpToMessageDemo() {
	const { scrollToMessage } = useMessageScroller();
	const [targetId, setTargetId] = React.useState('');

	const handleJump = (id: string) => {
		setTargetId(id);
		scrollToMessage(id);
	};

	return (
		<div className="flex h-full flex-col">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="px-4">
						{longMessages.map((msg) => (
							<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
								<ChatMessage message={msg} />
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
			<div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
				<span className="text-xs text-muted-foreground">Jump to:</span>
				{longMessages
					.filter((m) => m.role === 'user')
					.map((msg) => (
						<Button key={msg.id} size="sm" variant={targetId === msg.id ? 'default' : 'secondary'} onClick={() => handleJump(msg.id)}>
							{msg.content.length > 30 ? msg.content.slice(0, 30) + '…' : msg.content}
						</Button>
					))}
			</div>
		</div>
	);
}

export const JumpToMessage: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"Use `useMessageScroller`'s `scrollToMessage` to drive the transcript from outside the message list. Buttons below the transcript jump to specific user messages.",
			},
		},
	},
	render: () => (
		<MessageScrollerProvider>
			<JumpToMessageDemo />
		</MessageScrollerProvider>
	),
};

// ── Tracking Reader's Position ────────────────────────────

function TranscriptOutlineDemo() {
	const { currentAnchorId } = useMessageScrollerVisibility();

	return (
		<div className="flex h-full flex-col">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="px-4">
						{longMessages.map((msg) => (
							<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
								<ChatMessage message={msg} />
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
			<div className="border-t border-border bg-muted/30 p-3">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<ListIcon className="size-3.5" />
					<span className="font-medium">Current anchor:</span>
					<span className="text-foreground">
						{currentAnchorId
							? longMessages.find((m) => m.id === currentAnchorId)?.content.slice(0, 50) + '…'
							: 'None (at top or between anchors)'}
					</span>
				</div>
			</div>
		</div>
	);
}

export const TranscriptOutline: Story = {
	parameters: {
		docs: {
			description: {
				story:
					"`useMessageScrollerVisibility` tracks the reader's position. `currentAnchorId` reports the current anchored turn, which stays set even after it scrolls above the viewport. The footer below the transcript shows which anchor is currently in focus.",
			},
		},
	},
	render: () => (
		<MessageScrollerProvider>
			<TranscriptOutlineDemo />
		</MessageScrollerProvider>
	),
};

// ── Scroll State (useMessageScrollerScrollable) ───────────

function ScrollStateDemo() {
	const { start, end } = useMessageScrollerScrollable();

	const items = React.useMemo(
		() =>
			Array.from({ length: 12 }, (_, i) => ({
				id: String(i + 1),
				role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
				name: i % 2 === 0 ? 'You' : 'Assistant',
				content: `Review scroll checkpoint ${i + 1}.`,
				time: `${60 - i * 5} min ago`,
			})),
		[],
	);

	return (
		<div className="flex h-full flex-col">
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="px-4">
						{items.map((msg) => (
							<MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={msg.role === 'user'}>
								<ChatMessage message={msg} />
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
			<div className="flex items-center gap-4 border-t border-border p-3 text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<ArrowUpIcon className="size-3.5" />
					Start: <code className="text-foreground">{String(start)}</code>
				</span>
				<span className="flex items-center gap-1">
					<ArrowDownIcon className="size-3.5" />
					End: <code className="text-foreground">{String(end)}</code>
				</span>
				<span className="ml-auto">
					{!start && !end
						? 'All messages fit in the viewport'
						: start && end
							? 'Scrollable in both directions'
							: end
								? 'Scroll down for more'
								: 'Scroll up for more'}
				</span>
			</div>
		</div>
	);
}

export const ScrollState: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`useMessageScrollerScrollable` reports which edges the viewport can scroll toward. The footer displays the scrollable state as you scroll through the transcript.',
			},
		},
	},
	render: () => (
		<MessageScrollerProvider>
			<ScrollStateDemo />
		</MessageScrollerProvider>
	),
};

// ── Empty State ───────────────────────────────────────────

export const EmptyState: Story = {
	parameters: {
		docs: {
			description: {
				story: 'When there are no messages, the scroller shows an empty content area. The scroll button is inert and hidden.',
			},
		},
	},
	render: () => (
		<MessageScrollerProvider>
			<MessageScroller>
				<MessageScrollerViewport>
					<MessageScrollerContent className="items-center justify-center px-4">
						<div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
							<MessageIcon className="size-12 opacity-30" />
							<p className="text-sm font-medium">No messages yet</p>
							<p className="text-xs">Start a conversation to see messages appear here.</p>
						</div>
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	),
};

function MessageIcon(props: React.ComponentProps<'svg'>) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
	);
}
