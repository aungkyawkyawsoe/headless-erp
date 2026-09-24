import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment, useRef, useState } from 'react';
import { Form, FormHeader, FormBreadcrumbs, FormActions, FormContent, FormSection, FormTabs, type FormTabConfig } from './';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../breadcrumb';
import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { DatePicker } from '../datepicker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../dropdown-menu';
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '../field';
import { Input } from '../input';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '../input-group';
import { Label } from '../label';
import { NativeSelect, NativeSelectOption } from '../native-select';
import { RadioGroup, RadioGroupItem } from '../radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Switch } from '../switch';
import { TagsInput } from '../tags-input';
import { Textarea } from '../textarea';
import { toast } from '../toast';
import {
	BuildingIcon,
	DownloadIcon,
	FuelIcon,
	GlobeIcon,
	HotelIcon,
	MailIcon,
	MapPinIcon,
	MoreHorizontalIcon,
	PhoneIcon,
	PlaneIcon,
	PlusIcon,
	SaveIcon,
	TagIcon,
	Trash2Icon,
	UserIcon,
	UtensilsIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Form is a page-level layout for data-entry screens: a header bar with
 * breadcrumbs on the left and custom action slots on the right, above a
 * responsive multi-column grid of fields.
 *
 * Compose with `FormHeader` (`FormBreadcrumbs` + `FormActions`) for the top
 * bar and `FormContent` / `FormSection` for the fields below. `FormTabs`
 * renders the body as a tabbed view from a data-driven `FormTabConfig[]`.
 * The demos use
 * the design system's own controls (`DatePicker`, `Select`, `Switch`,
 * `RadioGroup`, `NativeSelect`, `TagsInput`, `InputGroup`, …) inside
 * `Field`.
 */
const meta: Meta<typeof Form> = {
	title: 'Components/Form',
	component: Form,
	parameters: {
		layout: 'padded',
		docs: {
			description: {
				component:
					'A page-level form layout. `Form` is the semantic root; `FormHeader` spans the full width with a breadcrumb trail (`FormBreadcrumbs`) on the left and action slots (`FormActions`) on the right. `FormContent` lays fields out in a centered, max-width 1/2-column grid. `FormSection` groups fields under an optional title and description. `FormTabs` renders the body as a tabbed view from a data-driven `FormTabConfig[]`.',
			},
		},
	},
	tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Helpers ──────────────────────────────────────────────

function CrumbTrail({ items }: { items: Array<{ label: string; href?: string }> }) {
	return (
		<Breadcrumb>
			<BreadcrumbList>
				{items.map((item, index) => {
					const isLast = index === items.length - 1;
					return (
						<Fragment key={item.label}>
							<BreadcrumbItem>
								{isLast ? (
									<BreadcrumbPage>{item.label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink href={item.href ?? '#'}>{item.label}</BreadcrumbLink>
								)}
							</BreadcrumbItem>
							{!isLast && <BreadcrumbSeparator />}
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

const statusOptions = [
	{ label: 'Draft', value: 'draft' },
	{ label: 'Pending approval', value: 'pending' },
	{ label: 'Confirmed', value: 'confirmed' },
];

const shippingMethods = [
	{ label: 'Standard (3–5 days)', value: 'standard' },
	{ label: 'Express (1–2 days)', value: 'express' },
	{ label: 'Same day', value: 'same-day' },
	{ label: 'Pickup', value: 'pickup' },
];

// ── Default ──────────────────────────────────────────────

export const Default: Story = {
	parameters: {
		docs: {
			description: {
				story: 'The basic layout: breadcrumbs top-left, `Cancel`/`Save` actions top-right, and a two-column grid of fields below.',
			},
		},
	},
	render: () => (
		<Form>
			<FormHeader>
				<FormBreadcrumbs>
					<CrumbTrail items={[{ label: 'Home', href: '/' }, { label: 'Settings' }, { label: 'Profile' }]} />
				</FormBreadcrumbs>
				<FormActions>
					<Button variant="outline" type="button">
						Cancel
					</Button>
					<Button type="submit">
						<SaveIcon />
						Save
					</Button>
				</FormActions>
			</FormHeader>
			<FormContent>
				<Field>
					<FieldLabel htmlFor="full-name">
						<UserIcon className="size-4" />
						Full name
					</FieldLabel>
					<FieldContent>
						<Input id="full-name" placeholder="Jane Cooper" />
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="email">
						<MailIcon className="size-4" />
						Email
					</FieldLabel>
					<FieldContent>
						<Input id="email" type="email" placeholder="jane@acme.com" />
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="role">Role</FieldLabel>
					<FieldContent>
						<Select items={statusOptions.slice(0, 1)}>
							<SelectTrigger id="role" className="w-full">
								<SelectValue placeholder="Select a role" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectItem value="admin">Admin</SelectItem>
									<SelectItem value="manager">Manager</SelectItem>
									<SelectItem value="member">Member</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="timezone">Timezone</FieldLabel>
					<FieldContent>
						<NativeSelect id="timezone" className="w-full" defaultValue="">
							<NativeSelectOption value="">Select timezone</NativeSelectOption>
							<NativeSelectOption value="asia/yangon">Asia/Yangon</NativeSelectOption>
							<NativeSelectOption value="asia/bangkok">Asia/Bangkok</NativeSelectOption>
							<NativeSelectOption value="asia/singapore">Asia/Singapore</NativeSelectOption>
						</NativeSelect>
						<FieldDescription>Used for scheduling and notification times.</FieldDescription>
					</FieldContent>
				</Field>
			</FormContent>
		</Form>
	),
};

// ── Use case: New Order (ERP) ────────────────────────────

export const NewOrder: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'An ERP-style “New Order” screen. `FormSection` groups fields under headings, `md:col-span-2` spans a field across both columns, and the header actions trigger a submit handler. Controls come from the design system: `DatePicker`, `Select`, `RadioGroup`, `InputGroup`, `NativeSelect`, `Checkbox`, `TagsInput`, and `Textarea`.',
			},
		},
	},
	render: () => {
		const [tags, setTags] = useState<string[]>(['warehouse', 'bulk']);

		return (
			<Form
				onSubmit={(event) => {
					event.preventDefault();
					toast.add({
						title: 'Order created',
						description: 'SO-1042 has been saved and is ready for review.',
						type: 'success',
					});
				}}
			>
				<FormHeader>
					<FormBreadcrumbs>
						<CrumbTrail
							items={[
								{ label: 'Logistics', href: '/logistics' },
								{
									label: 'Services Orders',
									href: '/logistics/services-orders',
								},
								{ label: 'New Order' },
							]}
						/>
					</FormBreadcrumbs>
					<FormActions>
						<Button variant="outline" type="button">
							Cancel
						</Button>
						<Button variant="outline" type="button">
							<DownloadIcon />
							Download
						</Button>
						<Button type="submit">
							<SaveIcon />
							Save
						</Button>
					</FormActions>
				</FormHeader>
				<FormContent>
					<FormSection title="Order Details" description="Core information about this service order.">
						<Field>
							<FieldLabel htmlFor="order-number">Order number</FieldLabel>
							<FieldContent>
								<Input id="order-number" placeholder="SO-1042" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="order-date">Order date</FieldLabel>
							<FieldContent>
								<DatePicker className="w-full" placeholder="Select a date" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="status">Status</FieldLabel>
							<FieldContent>
								<Select items={statusOptions.slice(0, 1)}>
									<SelectTrigger id="status" className="w-full">
										<SelectValue placeholder="Select a status" />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{statusOptions.map((status) => (
												<SelectItem key={status.value} value={status.value}>
													{status.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel>Priority</FieldLabel>
							<RadioGroup defaultValue="normal" className="flex flex-wrap gap-x-4 gap-y-2">
								<div className="flex items-center gap-2">
									<RadioGroupItem value="low" id="priority-low" />
									<Label htmlFor="priority-low">Low</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="normal" id="priority-normal" />
									<Label htmlFor="priority-normal">Normal</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="high" id="priority-high" />
									<Label htmlFor="priority-high">High</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="urgent" id="priority-urgent" />
									<Label htmlFor="priority-urgent">Urgent</Label>
								</div>
							</RadioGroup>
						</Field>
					</FormSection>

					<FormSection title="Customer Information" description="Who this order is for.">
						<Field>
							<FieldLabel htmlFor="customer">
								<BuildingIcon className="size-4" />
								Customer
							</FieldLabel>
							<FieldContent>
								<Input id="customer" placeholder="Acme Logistics Co." />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="contact-email">
								<MailIcon className="size-4" />
								Contact email
							</FieldLabel>
							<FieldContent>
								<Input id="contact-email" type="email" placeholder="ops@acme.com" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="contact-phone">
								<PhoneIcon className="size-4" />
								Contact phone
							</FieldLabel>
							<FieldContent>
								<InputGroup>
									<InputGroupAddon>
										<InputGroupText>+95</InputGroupText>
									</InputGroupAddon>
									<InputGroupInput id="contact-phone" type="tel" placeholder="9 123 456 789" />
								</InputGroup>
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="country">
								<GlobeIcon className="size-4" />
								Country
							</FieldLabel>
							<FieldContent>
								<NativeSelect id="country" className="w-full" defaultValue="mm">
									<NativeSelectOption value="mm">Myanmar</NativeSelectOption>
									<NativeSelectOption value="th">Thailand</NativeSelectOption>
									<NativeSelectOption value="sg">Singapore</NativeSelectOption>
								</NativeSelect>
							</FieldContent>
						</Field>
					</FormSection>

					<FormSection title="Delivery" description="Delivery arrangements.">
						<Field>
							<FieldLabel htmlFor="delivery-date">Delivery date</FieldLabel>
							<FieldContent>
								<DatePicker className="w-full" placeholder="Select a date" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="shipping-method">Shipping method</FieldLabel>
							<FieldContent>
								<Select items={shippingMethods.slice(0, 1)}>
									<SelectTrigger id="shipping-method" className="w-full">
										<SelectValue placeholder="Select a method" />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{shippingMethods.map((method) => (
												<SelectItem key={method.value} value={method.value}>
													{method.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</FieldContent>
						</Field>
						<Field orientation="horizontal" className="md:col-span-2">
							<Checkbox id="confirm-delivery" />
							<FieldLabel htmlFor="confirm-delivery">Confirm the delivery address with the customer before dispatch</FieldLabel>
						</Field>
						<Field className="md:col-span-2">
							<FieldLabel htmlFor="delivery-address">
								<MapPinIcon className="size-4" />
								Delivery address
							</FieldLabel>
							<FieldContent>
								<Textarea id="delivery-address" placeholder="Street, city, postal code…" />
							</FieldContent>
						</Field>
					</FormSection>

					<FormSection title="Notes" description="Anything else to record.">
						<Field className="md:col-span-2">
							<FieldLabel htmlFor="notes">Internal notes</FieldLabel>
							<FieldContent>
								<Textarea id="notes" placeholder="Optional notes for the team…" />
							</FieldContent>
						</Field>
						<Field className="md:col-span-2">
							<FieldLabel>Tags</FieldLabel>
							<FieldContent>
								<TagsInput value={tags} onChange={setTags} placeholder="Add a tag and press Enter…" />
							</FieldContent>
						</Field>
					</FormSection>
				</FormContent>
			</Form>
		);
	},
};

// ── Custom header slots ──────────────────────────────────

export const CustomHeaderSlots: Story = {
	parameters: {
		docs: {
			description: {
				story: '`FormActions` is an open slot — mix buttons, inputs, dropdowns, or any other component in the header’s right side.',
			},
		},
	},
	render: () => (
		<Form>
			<FormHeader>
				<FormBreadcrumbs>
					<CrumbTrail items={[{ label: 'Reports', href: '/reports' }, { label: 'Q3 Summary' }]} />
				</FormBreadcrumbs>
				<div className="flex items-center gap-2">
					<Input className="w-44" placeholder="Search records…" aria-label="Search records" />
					<FormActions>
						<Button variant="outline" type="button">
							<DownloadIcon />
							Export
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button variant="outline" size="icon-xs" aria-label="More options">
										<MoreHorizontalIcon />
									</Button>
								}
							/>
							<DropdownMenuContent align="end">
								<DropdownMenuItem>Duplicate</DropdownMenuItem>
								<DropdownMenuItem>Print preview</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem className="text-destructive">
									<Trash2Icon />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button type="submit">
							<SaveIcon />
							Save
						</Button>
					</FormActions>
				</div>
			</FormHeader>
			<FormContent>
				<Field>
					<FieldLabel htmlFor="report-name">Report name</FieldLabel>
					<FieldContent>
						<Input id="report-name" placeholder="Q3 Summary" />
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="report-owner">Owner</FieldLabel>
					<FieldContent>
						<Input id="report-owner" placeholder="Assign an owner" />
					</FieldContent>
				</Field>
			</FormContent>
		</Form>
	),
};

// ── Single column ────────────────────────────────────────

export const SingleColumn: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Set `columns={1}` on `FormContent` for single-column layouts such as short settings forms — here with `Switch` and `Select` controls.',
			},
		},
	},
	render: () => (
		<Form>
			<FormHeader>
				<FormBreadcrumbs>
					<CrumbTrail items={[{ label: 'Settings', href: '/settings' }, { label: 'Security' }]} />
				</FormBreadcrumbs>
				<FormActions>
					<Button variant="outline" type="button">
						Cancel
					</Button>
					<Button type="submit">Save changes</Button>
				</FormActions>
			</FormHeader>
			<FormContent columns={1}>
				<Field>
					<FieldLabel htmlFor="current-password">Current password</FieldLabel>
					<FieldContent>
						<Input id="current-password" type="password" />
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="new-password">New password</FieldLabel>
					<FieldContent>
						<Input id="new-password" type="password" />
						<FieldDescription>At least 8 characters.</FieldDescription>
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
					<FieldContent>
						<Input id="confirm-password" type="password" />
					</FieldContent>
				</Field>
				<Field orientation="horizontal">
					<FieldContent>
						<FieldLabel htmlFor="two-factor">Two-factor authentication</FieldLabel>
						<FieldDescription>Require a verification code when signing in.</FieldDescription>
					</FieldContent>
					<Switch id="two-factor" defaultChecked />
				</Field>
				<Field>
					<FieldLabel htmlFor="session-timeout">Session timeout</FieldLabel>
					<FieldContent>
						<Select items={[{ label: '30 minutes', value: '30m' }]}>
							<SelectTrigger id="session-timeout" className="w-full">
								<SelectValue placeholder="Select a timeout" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectItem value="15m">15 minutes</SelectItem>
									<SelectItem value="30m">30 minutes</SelectItem>
									<SelectItem value="1h">1 hour</SelectItem>
									<SelectItem value="never">Never</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
					</FieldContent>
				</Field>
			</FormContent>
		</Form>
	),
};

// ── Full-width fields ────────────────────────────────────

export const FullWidthFields: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Fields span both columns with `className="md:col-span-2"` — handy for textareas, switches, and long addresses inside a two-column grid.',
			},
		},
	},
	render: () => (
		<Form>
			<FormHeader>
				<FormBreadcrumbs>
					<CrumbTrail items={[{ label: 'Company', href: '/company' }, { label: 'Profile' }]} />
				</FormBreadcrumbs>
				<FormActions>
					<Button variant="outline" type="button">
						Cancel
					</Button>
					<Button type="submit">Save</Button>
				</FormActions>
			</FormHeader>
			<FormContent>
				<Field>
					<FieldLabel htmlFor="company-name">Company name</FieldLabel>
					<FieldContent>
						<Input id="company-name" placeholder="Acme Logistics Co." />
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="website">Website</FieldLabel>
					<FieldContent>
						<InputGroup>
							<InputGroupAddon>
								<InputGroupText>https://</InputGroupText>
							</InputGroupAddon>
							<InputGroupInput id="website" placeholder="acme.example" />
						</InputGroup>
					</FieldContent>
				</Field>
				<Field className="md:col-span-2">
					<FieldLabel htmlFor="bio">Company description</FieldLabel>
					<FieldContent>
						<Textarea id="bio" placeholder="A short description shown on the public profile…" />
					</FieldContent>
				</Field>
				<Field className="md:col-span-2" orientation="horizontal">
					<FieldContent>
						<FieldLabel htmlFor="notifications">Email notifications</FieldLabel>
						<FieldDescription>Receive a digest of weekly activity.</FieldDescription>
					</FieldContent>
					<Switch id="notifications" defaultChecked />
				</Field>
				<Field orientation="horizontal" className="md:col-span-2">
					<Checkbox id="public-directory" />
					<FieldLabel htmlFor="public-directory">List this company on the public directory</FieldLabel>
				</Field>
			</FormContent>
		</Form>
	),
};

// ── With validation errors ───────────────────────────────

export const WithValidation: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Required fields surfaced with `aria-invalid` on the control and a `FieldError` message underneath — the pattern for server or client validation.',
			},
		},
	},
	render: () => (
		<Form>
			<FormHeader>
				<FormBreadcrumbs>
					<CrumbTrail items={[{ label: 'Customers', href: '/customers' }, { label: 'New Customer' }]} />
				</FormBreadcrumbs>
				<FormActions>
					<Button variant="outline" type="button">
						Cancel
					</Button>
					<Button type="submit">Save</Button>
				</FormActions>
			</FormHeader>
			<FormContent>
				<Field>
					<FieldLabel htmlFor="customer-name">
						Customer name <span className="text-destructive">*</span>
					</FieldLabel>
					<FieldContent>
						<Input id="customer-name" aria-invalid="true" aria-describedby="customer-name-error" placeholder="Required" />
						<FieldError id="customer-name-error">Customer name is required.</FieldError>
					</FieldContent>
				</Field>
				<Field>
					<FieldLabel htmlFor="customer-code">
						Customer code <span className="text-destructive">*</span>
					</FieldLabel>
					<FieldContent>
						<Input id="customer-code" aria-invalid="true" aria-describedby="customer-code-error" placeholder="Required" />
						<FieldError id="customer-code-error">Customer code is required.</FieldError>
					</FieldContent>
				</Field>
			</FormContent>
		</Form>
	),
};

// ── Tabbed layout ────────────────────────────────────────

export const Tabbed: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'`FormTabs` renders the form body as a tabbed view from a data-driven `FormTabConfig[]` — value, label, optional icon, and `content` (or `render`). The tab bar is a full-width strip flush below `FormHeader`, left-aligned with the breadcrumbs and closed by a bottom border — like a Flutter `AppBar` tab bar — while each panel lays its fields out inside a centered `FormContent` container. Panels stay mounted by default, so values typed in one tab survive switching to another.',
			},
		},
	},
	render: () => {
		const [tags, setTags] = useState<string[]>([]);

		const tabs: FormTabConfig[] = [
			{
				value: 'details',
				label: 'Order Details',
				content: (
					<FormContent>
						<Field>
							<FieldLabel htmlFor="t-order-number">Order number</FieldLabel>
							<FieldContent>
								<Input id="t-order-number" placeholder="SO-1042" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="t-order-date">Order date</FieldLabel>
							<FieldContent>
								<DatePicker className="w-full" placeholder="Select a date" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="t-status">Status</FieldLabel>
							<FieldContent>
								<Select items={statusOptions.slice(0, 1)}>
									<SelectTrigger id="t-status" className="w-full">
										<SelectValue placeholder="Select a status" />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{statusOptions.map((status) => (
												<SelectItem key={status.value} value={status.value}>
													{status.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="t-priority">Priority</FieldLabel>
							<FieldContent>
								<NativeSelect id="t-priority" className="w-full" defaultValue="normal">
									<NativeSelectOption value="low">Low</NativeSelectOption>
									<NativeSelectOption value="normal">Normal</NativeSelectOption>
									<NativeSelectOption value="high">High</NativeSelectOption>
								</NativeSelect>
							</FieldContent>
						</Field>
					</FormContent>
				),
			},
			{
				value: 'customer',
				label: 'Customer',
				content: (
					<FormContent>
						<Field>
							<FieldLabel htmlFor="t-customer">Customer</FieldLabel>
							<FieldContent>
								<Input id="t-customer" placeholder="Acme Logistics Co." />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="t-contact-email">Contact email</FieldLabel>
							<FieldContent>
								<Input id="t-contact-email" type="email" placeholder="ops@acme.com" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="t-country">Country</FieldLabel>
							<FieldContent>
								<NativeSelect id="t-country" className="w-full" defaultValue="mm">
									<NativeSelectOption value="mm">Myanmar</NativeSelectOption>
									<NativeSelectOption value="th">Thailand</NativeSelectOption>
									<NativeSelectOption value="sg">Singapore</NativeSelectOption>
								</NativeSelect>
							</FieldContent>
						</Field>
					</FormContent>
				),
			},
			{
				value: 'delivery',
				label: 'Delivery',
				content: (
					<FormContent>
						<Field>
							<FieldLabel htmlFor="t-delivery-date">Delivery date</FieldLabel>
							<FieldContent>
								<DatePicker className="w-full" placeholder="Select a date" />
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor="t-shipping-method">Shipping method</FieldLabel>
							<FieldContent>
								<Select items={shippingMethods.slice(0, 1)}>
									<SelectTrigger id="t-shipping-method" className="w-full">
										<SelectValue placeholder="Select a method" />
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{shippingMethods.map((method) => (
												<SelectItem key={method.value} value={method.value}>
													{method.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
							</FieldContent>
						</Field>
						<Field className="md:col-span-2">
							<FieldLabel htmlFor="t-delivery-address">
								<MapPinIcon className="size-4" />
								Delivery address
							</FieldLabel>
							<FieldContent>
								<Textarea id="t-delivery-address" placeholder="Street, city, postal code…" />
							</FieldContent>
						</Field>
					</FormContent>
				),
			},
			{
				value: 'notes',
				label: 'Notes',
				content: (
					<FormContent>
						<Field className="md:col-span-2">
							<FieldLabel htmlFor="t-notes">Internal notes</FieldLabel>
							<FieldContent>
								<Textarea id="t-notes" placeholder="Optional notes for the team…" />
							</FieldContent>
						</Field>
						<Field className="md:col-span-2">
							<FieldLabel>Tags</FieldLabel>
							<FieldContent>
								<TagsInput value={tags} onChange={setTags} placeholder="Add a tag and press Enter…" />
							</FieldContent>
						</Field>
					</FormContent>
				),
			},
		];

		return (
			<Form
				onSubmit={(event) => {
					event.preventDefault();
					toast.add({
						title: 'Order saved',
						description: 'SO-1042 has been updated.',
						type: 'success',
					});
				}}
			>
				<FormHeader>
					<FormBreadcrumbs>
						<CrumbTrail
							items={[
								{ label: 'Logistics', href: '/logistics' },
								{
									label: 'Services Orders',
									href: '/logistics/services-orders',
								},
								{ label: 'SO-1042' },
							]}
						/>
					</FormBreadcrumbs>
					<FormActions>
						<Button size="xs" variant="outline" type="button">
							Cancel
						</Button>
						<Button size="xs" type="submit">
							<SaveIcon />
							Save
						</Button>
					</FormActions>
				</FormHeader>
				<FormTabs defaultValue="details" tabs={tabs} />
			</Form>
		);
	},
};

// ── Dynamic tabs ─────────────────────────────────────────

type ReasonEntry = {
	id: string;
	label: string;
	description: string;
	amount: string;
};

const initialReasons: ReasonEntry[] = [
	{
		id: 'travel',
		label: 'Travel',
		description: 'Airfare and ground transport',
		amount: '420',
	},
	{
		id: 'meals',
		label: 'Meals',
		description: 'Client dinner',
		amount: '85',
	},
];

/**
 * Picks a tab icon from the reason label, so newly added tabs get a sensible
 * icon without storing one in state. Renaming a tab swaps its icon live.
 */
function reasonIcon(label: string): LucideIcon {
	const l = label.toLowerCase();
	if (/(travel|flight|trip|airport|taxi)/.test(l)) return PlaneIcon;
	if (/(meal|food|dinner|lunch|breakfast|coffee)/.test(l)) return UtensilsIcon;
	if (/(hotel|stay|accommodation|lodging)/.test(l)) return HotelIcon;
	if (/(fuel|petrol|gas)/.test(l)) return FuelIcon;
	return TagIcon;
}

export const DynamicTabs: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Tabs are managed at runtime: add, remove, and rename “reason” tabs from the form itself. Icons are derived from each reason’s label (rename “Travel” and the tab swaps to a plane icon). `render` builds each panel from its tab value, and the bar scrolls when tabs overflow. Removing the active tab falls back to the first remaining tab.',
			},
		},
	},
	render: () => {
		const [reasons, setReasons] = useState<ReasonEntry[]>(initialReasons);
		const [activeTab, setActiveTab] = useState(initialReasons[0].id);
		const idCounter = useRef(initialReasons.length + 1);

		const updateReason = (id: string, patch: Partial<ReasonEntry>) => {
			setReasons((prev) => prev.map((reason) => (reason.id === id ? { ...reason, ...patch } : reason)));
		};

		const addReason = () => {
			const index = idCounter.current++;
			setReasons((prev) => [
				...prev,
				{
					id: `reason-${index}`,
					label: `Reason ${index}`,
					description: '',
					amount: '',
				},
			]);
			setActiveTab(`reason-${index}`);
		};

		const removeReason = (id: string) => {
			const next = reasons.filter((reason) => reason.id !== id);
			setReasons(next);
			if (activeTab === id) {
				setActiveTab(next[0]?.id ?? '');
			}
		};

		const tabs: FormTabConfig[] = reasons.map((reason) => {
			const Icon = reasonIcon(reason.label);
			return {
				value: reason.id,
				label: reason.label || 'Untitled reason',
				icon: <Icon />,
				render: ({ value }) => (
					<FormContent>
						<Field>
							<FieldLabel htmlFor={`${value}-label`}>Reason</FieldLabel>
							<FieldContent>
								<Input
									id={`${value}-label`}
									value={reason.label}
									onChange={(event) => updateReason(reason.id, { label: event.target.value })}
									placeholder="e.g. Travel, Accommodation…"
								/>
								<FieldDescription>Shown on the tab itself.</FieldDescription>
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${value}-description`}>Description</FieldLabel>
							<FieldContent>
								<Textarea
									id={`${value}-description`}
									value={reason.description}
									onChange={(event) => updateReason(reason.id, { description: event.target.value })}
									placeholder="What is this reason for?"
								/>
							</FieldContent>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${value}-amount`}>Amount</FieldLabel>
							<FieldContent>
								<InputGroup>
									<InputGroupAddon>
										<InputGroupText>MMK</InputGroupText>
									</InputGroupAddon>
									<InputGroupInput
										id={`${value}-amount`}
										type="number"
										min="0"
										value={reason.amount}
										onChange={(event) => updateReason(reason.id, { amount: event.target.value })}
										placeholder="0"
									/>
								</InputGroup>
							</FieldContent>
						</Field>
						<div className="flex md:col-span-2">
							<Button variant="outline" type="button" onClick={() => removeReason(reason.id)}>
								<Trash2Icon />
								Remove reason
							</Button>
						</div>
					</FormContent>
				),
			};
		});

		return (
			<Form
				onSubmit={(event) => {
					event.preventDefault();
					toast.add({
						title: 'Request submitted',
						description: 'Your reimbursement request is pending approval.',
						type: 'success',
					});
				}}
			>
				<FormHeader>
					<FormBreadcrumbs>
						<CrumbTrail items={[{ label: 'Finance', href: '/finance' }, { label: 'Reimbursements' }, { label: 'New Request' }]} />
					</FormBreadcrumbs>
					<FormActions>
						<Button variant="outline" type="button" onClick={addReason}>
							<PlusIcon />
							Add reason
						</Button>
						<Button type="submit">
							<SaveIcon />
							Submit request
						</Button>
					</FormActions>
				</FormHeader>
				{reasons.length === 0 ? (
					<FormContent>
						<div className="rounded-sm border border-dashed p-10 text-center text-sm text-muted-foreground md:col-span-2">
							No reasons yet — use “Add reason” to create one.
						</div>
					</FormContent>
				) : (
					<FormTabs value={activeTab} onValueChange={setActiveTab} tabs={tabs} scrollable />
				)}
			</Form>
		);
	},
};
