import type { Meta, StoryObj } from '@storybook/react-vite';
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from './';
import { Button } from '../button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../dropdown-menu';
import { MoreHorizontalIcon } from 'lucide-react';

/**
 * A responsive table component.
 */
const meta: Meta<typeof Table> = {
	title: 'Components/Table',
	component: Table,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component:
					'A responsive table component with header, body, footer, caption, and row/cell sub-components. Composable to build various table layouts.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Default ──────────────────────────────────────────────

const invoices = [
	{
		invoice: 'INV001',
		status: 'Paid',
		method: 'Credit Card',
		amount: '$250.00',
	},
	{ invoice: 'INV002', status: 'Pending', method: 'PayPal', amount: '$150.00' },
	{
		invoice: 'INV003',
		status: 'Unpaid',
		method: 'Bank Transfer',
		amount: '$350.00',
	},
	{
		invoice: 'INV004',
		status: 'Paid',
		method: 'Credit Card',
		amount: '$450.00',
	},
	{ invoice: 'INV005', status: 'Paid', method: 'PayPal', amount: '$550.00' },
	{
		invoice: 'INV006',
		status: 'Pending',
		method: 'Bank Transfer',
		amount: '$200.00',
	},
	{
		invoice: 'INV007',
		status: 'Unpaid',
		method: 'Credit Card',
		amount: '$300.00',
	},
];

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A basic table with caption, header, and body rows. Use `TableCaption` to provide a descriptive title for the table.',
			},
		},
	},
	render: () => (
		<Table>
			<TableCaption>A list of your recent invoices.</TableCaption>
			<TableHeader>
				<TableRow>
					<TableHead className="w-25">Invoice</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Method</TableHead>
					<TableHead className="text-right">Amount</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{invoices.map((item) => (
					<TableRow key={item.invoice}>
						<TableCell className="font-medium">{item.invoice}</TableCell>
						<TableCell>{item.status}</TableCell>
						<TableCell>{item.method}</TableCell>
						<TableCell className="text-right">{item.amount}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	),
};

// ── Footer ───────────────────────────────────────────────

export const Footer: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `<TableFooter />` to add a footer to the table, useful for displaying totals or summary rows.',
			},
		},
	},
	render: () => (
		<Table>
			<TableCaption>A list of your recent invoices.</TableCaption>
			<TableHeader>
				<TableRow>
					<TableHead className="w-25">Invoice</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Method</TableHead>
					<TableHead className="text-right">Amount</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{invoices.map((item) => (
					<TableRow key={item.invoice}>
						<TableCell className="font-medium">{item.invoice}</TableCell>
						<TableCell>{item.status}</TableCell>
						<TableCell>{item.method}</TableCell>
						<TableCell className="text-right">{item.amount}</TableCell>
					</TableRow>
				))}
			</TableBody>
			<TableFooter>
				<TableRow>
					<TableCell colSpan={3}>Total</TableCell>
					<TableCell className="text-right">$2,500.00</TableCell>
				</TableRow>
			</TableFooter>
		</Table>
	),
};

// ── Actions ──────────────────────────────────────────────

export const Actions: Story = {
	parameters: {
		docs: {
			description: {
				story: 'A table showing actions for each row using a `<DropdownMenu />` component.',
			},
		},
	},
	render: () => (
		<Table>
			<TableCaption>A list of your products.</TableCaption>
			<TableHeader>
				<TableRow>
					<TableHead className="w-25">SKU</TableHead>
					<TableHead>Product</TableHead>
					<TableHead>Price</TableHead>
					<TableHead className="w-12.5"></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{[
					{ sku: 'WM-001', product: 'Wireless Mouse', price: '$29.99' },
					{ sku: 'MK-002', product: 'Mechanical Keyboard', price: '$129.99' },
					{ sku: 'UC-003', product: 'USB-C Hub', price: '$49.99' },
				].map((item) => (
					<TableRow key={item.sku}>
						<TableCell className="font-medium">{item.sku}</TableCell>
						<TableCell>{item.product}</TableCell>
						<TableCell>{item.price}</TableCell>
						<TableCell>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button variant="ghost" size="icon-sm">
											<MoreHorizontalIcon />
											<span className="sr-only">Open menu</span>
										</Button>
									}
								/>
								<DropdownMenuContent align="end">
									<DropdownMenuGroup>
										<DropdownMenuLabel>Actions</DropdownMenuLabel>
									</DropdownMenuGroup>
									<DropdownMenuItem>Edit</DropdownMenuItem>
									<DropdownMenuItem>Duplicate</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	),
};
