import type { Meta, StoryObj } from '@storybook/react-vite';
import {
	Pagination,
	PaginationContent,
	PaginationCursor,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
	PaginationSummary,
} from './';
import { Field, FieldLabel } from '@/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select';
import { useState } from 'react';

/**
 * Pagination with page navigation, next and previous links. Composes navigation
 * items (`PaginationLink`, `PaginationPrevious`, `PaginationNext`) inside a
 * `PaginationContent` list, with `PaginationEllipsis` for gaps.
 */
const meta: Meta<typeof Pagination> = {
	title: 'Components/Pagination',
	component: Pagination,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A pagination component for navigating through pages. Compose `PaginationContent` with `PaginationItem`, `PaginationLink`, `PaginationPrevious`, `PaginationNext`, and `PaginationEllipsis` to build various pagination layouts.',
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
				story: 'Full pagination with previous/next buttons, page links, and an ellipsis for truncated ranges.',
			},
		},
	},
	render: () => (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious href="#" />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">1</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#" isActive>
						2
					</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">3</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationEllipsis />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">8</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationNext href="#" />
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	),
};

// ── Simple ───────────────────────────────────────────────

export const Simple: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A simple pagination with only page numbers, no previous/next buttons.',
			},
		},
	},
	render: () => (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationLink href="#" isActive>
						1
					</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">2</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">3</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationEllipsis />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">10</PaginationLink>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	),
};

// ── Icons Only ───────────────────────────────────────────

export const IconsOnly: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Previous and next buttons without page numbers. Useful for data tables with a rows-per-page selector.',
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="flex w-full min-w-80 items-center justify-between gap-4">
				<div className="flex items-center gap-2">
					<Field orientation="horizontal">
						<FieldLabel className="text-sm whitespace-nowrap text-muted-foreground">Rows per page</FieldLabel>
						<Select defaultValue="25">
							<SelectTrigger className="w-16">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="10">10</SelectItem>
								<SelectItem value="25">25</SelectItem>
								<SelectItem value="50">50</SelectItem>
							</SelectContent>
						</Select>
					</Field>
				</div>
				<Story />
			</div>
		),
	],
	render: () => (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious href="#" />
				</PaginationItem>
				<PaginationItem>
					<PaginationNext href="#" />
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	),
};

// ── Interactive ──────────────────────────────────────────

function InteractiveDemo() {
	const [currentPage, setCurrentPage] = useState(1);
	const totalPages = 10;

	const getVisiblePages = () => {
		const pages: (number | 'ellipsis')[] = [];
		if (totalPages <= 7) {
			for (let i = 1; i <= totalPages; i++) pages.push(i);
		} else {
			pages.push(1);
			if (currentPage > 3) pages.push('ellipsis');
			const start = Math.max(2, currentPage - 1);
			const end = Math.min(totalPages - 1, currentPage + 1);
			for (let i = start; i <= end; i++) pages.push(i);
			if (currentPage < totalPages - 2) pages.push('ellipsis');
			pages.push(totalPages);
		}
		return pages;
	};

	return (
		<div className="flex flex-col items-center gap-6">
			<Pagination>
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious
							href="#"
							text="Previous"
							onClick={(e) => {
								e.preventDefault();
								setCurrentPage((p) => Math.max(1, p - 1));
							}}
							aria-disabled={currentPage === 1}
							className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
						/>
					</PaginationItem>
					{getVisiblePages().map((page, idx) =>
						page === 'ellipsis' ? (
							<PaginationItem key={`e-${idx}`}>
								<PaginationEllipsis />
							</PaginationItem>
						) : (
							<PaginationItem key={page}>
								<PaginationLink
									href="#"
									isActive={page === currentPage}
									onClick={(e) => {
										e.preventDefault();
										setCurrentPage(page);
									}}
								>
									{page}
								</PaginationLink>
							</PaginationItem>
						),
					)}
					<PaginationItem>
						<PaginationNext
							href="#"
							text="Next"
							onClick={(e) => {
								e.preventDefault();
								setCurrentPage((p) => Math.min(totalPages, p + 1));
							}}
							aria-disabled={currentPage === totalPages}
							className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
						/>
					</PaginationItem>
				</PaginationContent>
			</Pagination>
			<p className="text-sm text-muted-foreground">
				Page <span className="font-medium text-foreground">{currentPage}</span> of {totalPages}
			</p>
		</div>
	);
}

export const Interactive: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'An interactive pagination demo. Click the page links or previous/next buttons to navigate between pages. Disabled states are applied at the boundaries.',
			},
		},
	},
	render: () => <InteractiveDemo />,
};

// ── Many Pages ───────────────────────────────────────────

export const ManyPages: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Pagination with a large number of pages, showing ellipsis on both sides.',
			},
		},
	},
	render: () => (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious href="#" />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">1</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationEllipsis />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">12</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#" isActive>
						13
					</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">14</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationEllipsis />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">42</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationNext href="#" />
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	),
};

// ── Cursor Only ─────────────────────────────────────────

export const CursorOnly: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Cursor-based pagination showing the current range (`0–25`) with previous/next arrow buttons only. No page numbers — useful for offset/cursor-driven APIs and infinite scroll.',
			},
		},
	},
	render: () => (
		<Pagination>
			<PaginationCursor from={0} to={25} canPrevious={false} onPrevious={() => {}} onNext={() => {}} />
		</Pagination>
	),
};

export const CursorSummary: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'The `PaginationSummary` building block renders a range label like `0–25`, `25–50`, `50–75` — useful alongside cursor-only controls.',
			},
		},
	},
	render: () => (
		<div className="flex flex-col items-center gap-3">
			<PaginationSummary from={0} to={25} />
			<PaginationSummary from={25} to={50} />
			<PaginationSummary from={50} to={75} />
		</div>
	),
};

// ── Interactive Cursor ──────────────────────────────────

function InteractiveCursorDemo() {
	const [rangeStart, setRangeStart] = useState(0);
	const pageSize = 25;
	const total = 100;

	return (
		<div className="flex flex-col items-center gap-6">
			<Pagination>
				<PaginationCursor
					from={rangeStart}
					to={rangeStart + pageSize}
					canPrevious={rangeStart > 0}
					canNext={rangeStart + pageSize < total}
					onPrevious={() => setRangeStart((s) => Math.max(0, s - pageSize))}
					onNext={() => setRangeStart((s) => s + pageSize)}
				/>
			</Pagination>
			<p className="text-sm text-muted-foreground">
				Showing rows{' '}
				<span className="font-medium text-foreground">
					{rangeStart}–{rangeStart + pageSize}
				</span>
			</p>
		</div>
	);
}

export const InteractiveCursor: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Interactive cursor pagination. Use the arrow buttons to move through the result set; the buttons disable at the boundaries.',
			},
		},
	},
	render: () => <InteractiveCursorDemo />,
};

// ── Custom Text ─────────────────────────────────────────

export const CustomText: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Custom text labels for the previous and next buttons using the `text` prop.',
			},
		},
	},
	render: () => (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious href="#" text="ရှေ့" />
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">1</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#" isActive>
						2
					</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationLink href="#">3</PaginationLink>
				</PaginationItem>
				<PaginationItem>
					<PaginationNext href="#" text="နောက်" />
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	),
};
