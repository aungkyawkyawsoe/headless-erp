'use client';

import * as React from 'react';
import { Fragment } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { GlobeIcon, UserIcon, UsersIcon } from 'lucide-react';

import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxLabel,
	ComboboxCollection,
	ComboboxSeparator,
	ComboboxChips,
	ComboboxChip,
	ComboboxChipsInput,
	ComboboxValue,
	ComboboxTrigger,
	useComboboxAnchor,
} from './';
import { InputGroupAddon } from '@/input-group';
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from '@/avatar';
import { Button } from '@/button';
import { Field } from '@/field';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/item';
import { cn } from '@/utils';

const fruits = [
	{ value: 'apple', label: 'Apple' },
	{ value: 'banana', label: 'Banana' },
	{ value: 'blueberry', label: 'Blueberry' },
	{ value: 'cherry', label: 'Cherry' },
	{ value: 'grape', label: 'Grape' },
	{ value: 'kiwi', label: 'Kiwi' },
	{ value: 'lemon', label: 'Lemon' },
	{ value: 'lime', label: 'Lime' },
	{ value: 'mango', label: 'Mango' },
	{ value: 'orange', label: 'Orange' },
	{ value: 'peach', label: 'Peach' },
	{ value: 'pear', label: 'Pear' },
	{ value: 'pineapple', label: 'Pineapple' },
	{ value: 'strawberry', label: 'Strawberry' },
	{ value: 'watermelon', label: 'Watermelon' },
];

const frameworks = ['Next.js', 'SvelteKit', 'Nuxt.js', 'Remix', 'Astro', 'SolidJS', 'Qwik', 'Angular', 'Vue', 'Ember'] as const;

type Framework = {
	label: string;
	value: string;
};

const customFrameworks: Framework[] = [
	{ label: 'Next.js', value: 'next' },
	{ label: 'SvelteKit', value: 'sveltekit' },
	{ label: 'Nuxt.js', value: 'nuxt' },
	{ label: 'Remix', value: 'remix' },
	{ label: 'Astro', value: 'astro' },
];

interface Country {
	code: string;
	label: string;
}

const countries: Country[] = [
	{ code: 'us', label: 'United States' },
	{ code: 'gb', label: 'United Kingdom' },
	{ code: 'jp', label: 'Japan' },
	{ code: 'de', label: 'Germany' },
	{ code: 'fr', label: 'France' },
	{ code: 'br', label: 'Brazil' },
	{ code: 'in', label: 'India' },
	{ code: 'sg', label: 'Singapore' },
	{ code: 'kr', label: 'South Korea' },
	{ code: 'ca', label: 'Canada' },
];

const meta: Meta<typeof Combobox> = {
	title: 'Components/Combobox',
	component: Combobox,
	tags: ['autodocs'],
	parameters: {
		docs: {
			description: {
				component:
					'A combobox component. Supports single-select and multi-select (chips) with search filtering. ComboboxInput includes the trigger button, so do not render ComboboxTrigger separately when using ComboboxInput.',
			},
		},
	},
};

export default meta;
type Story = StoryObj<typeof Combobox>;

// ───────────────────────────── 1. Basic ─────────────────────────────

export const Basic: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks}>
					<ComboboxInput placeholder="Select a framework..." />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 2. Clear Button ─────────────────────────────

export const ClearButton: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks} defaultValue={frameworks[0]}>
					<ComboboxInput showClear placeholder="Select a framework..." />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 3. Multiple ─────────────────────────────

export const Multiple: Story = {
	render: () => {
		const [value, setValue] = React.useState<string[]>([]);
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks} multiple value={value} onValueChange={setValue}>
					<ComboboxChips>
						<ComboboxValue>
							{value.map((item) => (
								<ComboboxChip key={item}>{item}</ComboboxChip>
							))}
						</ComboboxValue>
						<ComboboxChipsInput placeholder="Add framework..." />
					</ComboboxChips>
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 4. Groups ─────────────────────────────

interface ProduceGroup {
	label: string;
	items: { value: string; label: string }[];
}

const produceGroups: ProduceGroup[] = [
	{
		label: 'Fruits',
		items: [
			{ value: 'apple', label: 'Apple' },
			{ value: 'banana', label: 'Banana' },
			{ value: 'orange', label: 'Orange' },
			{ value: 'mango', label: 'Mango' },
			{ value: 'grape', label: 'Grape' },
		],
	},
	{
		label: 'Vegetables',
		items: [
			{ value: 'carrot', label: 'Carrot' },
			{ value: 'broccoli', label: 'Broccoli' },
			{ value: 'spinach', label: 'Spinach' },
			{ value: 'potato', label: 'Potato' },
			{ value: 'tomato', label: 'Tomato' },
		],
	},
];

export const Groups: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={produceGroups}>
					<ComboboxInput placeholder="Select produce..." showClear />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No produce found.</ComboboxEmpty>
						<ComboboxList>
							{(group: ProduceGroup) => (
								<ComboboxGroup key={group.label} items={group.items}>
									<ComboboxLabel>{group.label}</ComboboxLabel>
									<ComboboxCollection>
										{(item: ProduceGroup['items'][number]) => (
											<ComboboxItem key={item.value} value={item.value}>
												{item.label}
											</ComboboxItem>
										)}
									</ComboboxCollection>
									<ComboboxSeparator />
								</ComboboxGroup>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 5. Custom Items ─────────────────────────────

export const CustomItems: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={customFrameworks} itemToStringValue={(fw: Framework) => fw.label}>
					<ComboboxInput placeholder="Select a framework..." showClear />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(framework: Framework) => (
								<ComboboxItem key={framework.value} value={framework}>
									{framework.label}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 6. Invalid ─────────────────────────────

export const Invalid: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks}>
					<ComboboxInput showClear aria-invalid placeholder="Select a framework..." />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 7. Disabled ─────────────────────────────

export const Disabled: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks} disabled defaultValue={frameworks[0]}>
					<ComboboxInput showClear placeholder="Select a framework..." />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 8. Auto Highlight ─────────────────────────────

export const AutoHighlight: Story = {
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks} autoHighlight>
					<ComboboxInput placeholder="Type to filter..." showClear />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 9. Popup (input inside popup) ─────────────────────────────

export const Popup: Story = {
	render: () => {
		const [value, setValue] = React.useState<Country | null>(null);
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={countries} value={value} onValueChange={(v) => setValue(v ?? null)} itemToStringValue={(c: Country) => c.label}>
					<ComboboxTrigger
						render={
							<button className="flex h-8 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm shadow-none transition-colors hover:bg-accent hover:text-accent-foreground data-placeholder:text-muted-foreground">
								<ComboboxValue placeholder="Select country..." />
							</button>
						}
					/>
					<ComboboxContent anchor={anchorRef}>
						<ComboboxInput placeholder="Search countries..." />
						<ComboboxEmpty>No countries found.</ComboboxEmpty>
						<ComboboxList>
							{(country: Country) => (
								<ComboboxItem key={country.code} value={country}>
									{country.label}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 10. Input Group (with addon) ─────────────────────────────

export const InputGroupAddonStory: Story = {
	name: 'Input Group',
	render: () => {
		const anchorRef = useComboboxAnchor();

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox items={frameworks}>
					<ComboboxInput placeholder="Select a framework..." showClear>
						<InputGroupAddon align="inline-start">
							<GlobeIcon className="size-4 text-muted-foreground" />
						</InputGroupAddon>
					</ComboboxInput>
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No frameworks found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 11. Single Select (controlled, with clear) ─────────────────────────────

export const SingleSelect: Story = {
	render: () => {
		const [value, setValue] = React.useState<string | undefined>(undefined);
		const [inputValue, setInputValue] = React.useState('');
		const anchorRef = useComboboxAnchor();

		const filteredFruits = React.useMemo(
			() => fruits.filter((f) => f.label.toLowerCase().includes(inputValue.toLowerCase())),
			[inputValue],
		);

		return (
			<div ref={anchorRef} className="w-72">
				<Combobox
					items={filteredFruits}
					value={value}
					onValueChange={(v) => setValue(v ?? undefined)}
					onInputValueChange={(v) => setInputValue(v)}
				>
					<ComboboxInput showClear placeholder="Select a fruit..." />
					<ComboboxContent anchor={anchorRef}>
						<ComboboxList>
							{filteredFruits.map((fruit) => (
								<ComboboxItem key={fruit.value} value={fruit.value}>
									{fruit.label}
								</ComboboxItem>
							))}
							<ComboboxEmpty>No fruits found.</ComboboxEmpty>
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 12. Member Picker (custom rendered items) ─────────────────────────────

interface Member {
	id: string;
	name: string;
	email: string;
	avatar: string;
	initials: string;
	position: string;
}

const members: Member[] = [
	{
		id: '1',
		name: 'Alex Johnson',
		email: 'alex@example.com',
		avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&h=96&dpr=2&q=80',
		initials: 'AJ',
		position: 'Software Engineer',
	},
	{
		id: '2',
		name: 'Sarah Chen',
		email: 'sarah@example.com',
		avatar: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=96&h=96&dpr=2&q=80',
		initials: 'SC',
		position: 'Product Manager',
	},
	{
		id: '3',
		name: 'Michael Rodriguez',
		email: 'michael@example.com',
		avatar: 'https://images.unsplash.com/photo-1584308972272-9e4e7685e80f?w=96&h=96&dpr=2&q=80',
		initials: 'MR',
		position: 'UX Designer',
	},
	{
		id: '4',
		name: 'Emma Wilson',
		email: 'emma@example.com',
		avatar: 'https://images.unsplash.com/photo-1485893086445-ed75865251e0?w=96&h=96&dpr=2&q=80',
		initials: 'EW',
		position: 'Technical Lead',
	},
	{
		id: '5',
		name: 'David Kim',
		email: 'david@example.com',
		avatar: 'https://images.unsplash.com/photo-1607990281513-2c110a25bd8c?w=96&h=96&dpr=2&q=80',
		initials: 'DK',
		position: 'CTO',
	},
	{
		id: '6',
		name: 'Aron Thompson',
		email: 'lisa@example.com',
		avatar: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=96&h=96&dpr=2&q=80',
		initials: 'LT',
		position: 'Software Engineer',
	},
	{
		id: '7',
		name: 'James Brown',
		email: 'james@example.com',
		avatar: 'https://images.unsplash.com/photo-1543299750-19d1d6297053?w=96&h=96&dpr=2&q=80',
		initials: 'JB',
		position: 'Product Manager',
	},
	{
		id: '8',
		name: 'Maria Garcia',
		email: 'maria@example.com',
		avatar: 'https://images.unsplash.com/photo-1620075225255-8c2051b6c015?w=96&h=96&dpr=2&q=80',
		initials: 'MG',
		position: 'UX Designer',
	},
	{
		id: '9',
		name: 'Nick Johnson',
		email: 'nick@example.com',
		avatar: 'https://images.unsplash.com/photo-1485206412256-701ccc5b93ca?w=96&h=96&dpr=2&q=80',
		initials: 'NJ',
		position: 'Technical Lead',
	},
	{
		id: '10',
		name: 'Liam Thompson',
		email: 'liam@example.com',
		avatar: 'https://images.unsplash.com/photo-1542595913-85d69b0edbaf?w=96&h=96&dpr=2&q=80',
		initials: 'LT',
		position: 'CTO',
	},
];

export const MemberPicker: Story = {
	render: () => (
		<Field className="max-w-xs">
			<Combobox
				items={members}
				defaultValue={members[0]}
				itemToStringValue={(member: Member) => member.name}
				itemToStringLabel={(member: Member) => member.name}
			>
				<ComboboxTrigger render={<Button variant="outline" className="w-full justify-between font-normal" />}>
					<ComboboxValue>
						{(member: Member) =>
							member ? (
								<span className="flex items-center gap-2">
									<Avatar className="size-5">
										<AvatarImage src={member?.avatar} alt={member?.name} />
										<AvatarFallback>{member?.initials}</AvatarFallback>
									</Avatar>
									<span>{member?.name}</span>
								</span>
							) : (
								<span className="text-muted-foreground">Select a member</span>
							)
						}
					</ComboboxValue>
				</ComboboxTrigger>
				<ComboboxContent className="max-w-(--anchor-width) min-w-(--anchor-width)">
					<ComboboxInput showTrigger={false} placeholder="Search members..." />
					<ComboboxEmpty>No members found.</ComboboxEmpty>
					<ComboboxList>
						{(member: Member) => (
							<ComboboxItem key={member.id} value={member}>
								<Item size="xs" className="p-0">
									<Avatar className="size-6">
										<AvatarImage src={member.avatar} alt={member.name} />
										<AvatarFallback>{member.initials}</AvatarFallback>
									</Avatar>
									<ItemContent>
										<ItemTitle className="whitespace-nowrap">{member.name}</ItemTitle>
										<ItemDescription>{member.position}</ItemDescription>
									</ItemContent>
								</Item>
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</Field>
	),
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 13. Member Tags (multi-select chips) ─────────────────────────────

export const MemberTags: Story = {
	render: () => {
		const anchor = useComboboxAnchor();

		return (
			<Field className="max-w-xs">
				<Combobox
					multiple
					items={members}
					itemToStringValue={(member: Member) => member.name}
					itemToStringLabel={(member: Member) => member.name}
					defaultValue={[members[0], members[1]]}
				>
					<ComboboxChips ref={anchor}>
						<ComboboxValue>
							{(selectedMembers: Member[]) => (
								<Fragment>
									{selectedMembers.map((member) => (
										<ComboboxChip key={member.id} showRemove className="gap-1.5 rounded-full">
											<Avatar className="size-4">
												<AvatarImage src={member.avatar} alt={member.name} />
												<AvatarFallback className="text-[8px]">{member.initials}</AvatarFallback>
											</Avatar>
											{member.name}
										</ComboboxChip>
									))}
									<ComboboxChipsInput placeholder="Add members..." />
								</Fragment>
							)}
						</ComboboxValue>
					</ComboboxChips>
					<ComboboxContent anchor={anchor} className="max-w-(--anchor-width) min-w-(--anchor-width)">
						<ComboboxEmpty>No members found.</ComboboxEmpty>
						<ComboboxList>
							{(member: Member) => (
								<ComboboxItem key={member.id} value={member}>
									<Item size="xs" className="p-0">
										<Avatar className="size-6">
											<AvatarImage src={member.avatar} alt={member.name} />
											<AvatarFallback>{member.initials}</AvatarFallback>
										</Avatar>
										<ItemContent>
											<ItemTitle className="whitespace-nowrap">{member.name}</ItemTitle>
											<ItemDescription>{member.position}</ItemDescription>
										</ItemContent>
									</Item>
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</Field>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 14. Lead Selection (pinned "No lead" + grouped members) ─────────────────────────────

type NoLeadOption = {
	type: 'none';
	value: 'none';
	label: 'No lead';
};

type TeamMember = {
	type: 'member';
	id: string;
	value: string;
	label: string;
	avatar: string;
	initials: string;
	isCurrentUser?: boolean;
};

type LeadOption = NoLeadOption | TeamMember;

const noLeadOption: NoLeadOption = {
	type: 'none',
	value: 'none',
	label: 'No lead',
};

const teamMembers: TeamMember[] = [
	{
		type: 'member',
		id: 'member-1',
		value: 'shuhrat-saipov',
		label: 'Shuhrat Saipov',
		avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&dpr=2&q=80',
		initials: 'SS',
		isCurrentUser: true,
	},
	{
		type: 'member',
		id: 'member-2',
		value: 'nadia-karimova',
		label: 'Nadia Karimova',
		avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&dpr=2&q=80',
		initials: 'NK',
	},
	{
		type: 'member',
		id: 'member-3',
		value: 'bekzod-rakhimov',
		label: 'Bekzod Rakhimov',
		avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=96&h=96&dpr=2&q=80',
		initials: 'BR',
	},
	{
		type: 'member',
		id: 'member-4',
		value: 'lina-bauer',
		label: 'Lina Bauer',
		avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=96&h=96&dpr=2&q=80',
		initials: 'LB',
	},
	{
		type: 'member',
		id: 'member-5',
		value: 'omar-haddad',
		label: 'Omar Haddad',
		avatar: 'https://images.unsplash.com/photo-1504593811423-6dd665756598?w=96&h=96&dpr=2&q=80',
		initials: 'OH',
	},
	{
		type: 'member',
		id: 'member-6',
		value: 'priya-nand',
		label: 'Priya Nand',
		avatar: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=96&h=96&dpr=2&q=80',
		initials: 'PN',
	},
	{
		type: 'member',
		id: 'member-7',
		value: 'kenji-watan',
		label: 'Kenji Watan',
		avatar: 'https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=96&h=96&dpr=2&q=80',
		initials: 'KW',
	},
	{
		type: 'member',
		id: 'member-8',
		value: 'ava-sinclair',
		label: 'Ava Sinclair',
		avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=96&h=96&dpr=2&q=80',
		initials: 'AS',
	},
	{
		type: 'member',
		id: 'member-9',
		value: 'nia-okafor',
		label: 'Nia Okafor',
		avatar: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=96&h=96&dpr=2&q=80',
		initials: 'NO',
	},
	{
		type: 'member',
		id: 'member-10',
		value: 'matteo-sosa',
		label: 'Matteo Sosa',
		avatar: 'https://images.unsplash.com/photo-1506795660185-2f0c6a1c7f6c?w=96&h=96&dpr=2&q=80',
		initials: 'MS',
	},
	{
		type: 'member',
		id: 'member-11',
		value: 'salma-rahman',
		label: 'Salma Rahman',
		avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=96&h=96&dpr=2&q=80',
		initials: 'SR',
	},
	{
		type: 'member',
		id: 'member-12',
		value: 'jonas-meyer',
		label: 'Jonas Meyer',
		avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&dpr=2&q=80',
		initials: 'JM',
	},
];

const leadOptions: LeadOption[] = [noLeadOption, ...teamMembers];

function UserGlyph({ className }: { className?: string }) {
	return <UserIcon className={cn('size-4 shrink-0', className)} />;
}

function LeadTriggerLabel({ option }: { option: LeadOption }) {
	if (option.type === 'none') {
		return (
			<span className="flex min-w-0 items-center gap-2">
				<UserGlyph className="text-muted-foreground" />
				<span className="truncate">{option.label}</span>
			</span>
		);
	}

	return (
		<span className="flex min-w-0 items-center gap-2">
			<Avatar className="size-5">
				<AvatarImage src={option.avatar} alt={option.label} />
				<AvatarFallback className="text-[9px]">{option.initials}</AvatarFallback>
			</Avatar>
			<span className="truncate">{option.label}</span>
		</span>
	);
}

function LeadListRow({ option }: { option: LeadOption }) {
	if (option.type === 'none') {
		return (
			<span className="flex min-w-0 items-center gap-2">
				<UserGlyph className="text-muted-foreground" />
				<span className="truncate">{option.label}</span>
			</span>
		);
	}

	return (
		<Item size="xs" className="p-0">
			<ItemMedia>
				<Avatar className="size-5">
					<AvatarImage src={option.avatar} alt={option.label} />
					<AvatarFallback className="text-[9px]">{option.initials}</AvatarFallback>
				</Avatar>
			</ItemMedia>
			<ItemContent>
				<ItemTitle className="gap-1 whitespace-nowrap">
					<span>{option.label}</span>
					{option.isCurrentUser ? <span className="font-normal text-muted-foreground">(You)</span> : null}
				</ItemTitle>
			</ItemContent>
		</Item>
	);
}

export const LeadSelection: Story = {
	render: () => {
		const [lead, setLead] = React.useState<LeadOption | null>(noLeadOption);

		return (
			<Field className="max-w-xs">
				<Combobox
					items={leadOptions}
					value={lead}
					onValueChange={setLead}
					itemToStringValue={(item: LeadOption) => item.label}
					autoHighlight
				>
					<ComboboxTrigger render={<Button type="button" variant="outline" className="w-full justify-between font-normal" />}>
						<ComboboxValue placeholder="No lead">
							{(selectedLead: LeadOption | null) =>
								selectedLead ? <LeadTriggerLabel option={selectedLead} /> : <span className="text-muted-foreground">No lead</span>
							}
						</ComboboxValue>
					</ComboboxTrigger>

					<ComboboxContent className="max-w-(--anchor-width) min-w-(--anchor-width)">
						<ComboboxInput showTrigger={false} placeholder="Select lead" className="mb-1" />
						<ComboboxEmpty>No team members found.</ComboboxEmpty>
						<ComboboxList>
							<ComboboxItem value={noLeadOption}>
								<LeadListRow option={noLeadOption} />
							</ComboboxItem>

							<ComboboxGroup items={teamMembers}>
								<ComboboxLabel>Team members</ComboboxLabel>
								<ComboboxCollection>
									{(member: TeamMember) => (
										<ComboboxItem key={member.id} value={member}>
											<LeadListRow option={member} />
										</ComboboxItem>
									)}
								</ComboboxCollection>
							</ComboboxGroup>
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</Field>
		);
	},
	parameters: {
		layout: 'padded',
	},
};

// ───────────────────────────── 15. Member Selection (multi-select, avatar stack + "No members") ─────────────────────────────

type EmptyMembersOption = {
	id: 'no-members';
	value: 'none';
	label: string;
	searchText: string;
};

type SelectableMember = {
	id: string;
	value: string;
	label: string;
	avatar?: string;
	initials: string;
	isCurrentUser?: boolean;
};

type MemberSelectionItem = EmptyMembersOption | SelectableMember;

const noMembersOption: EmptyMembersOption = {
	id: 'no-members',
	value: 'none',
	label: 'No members',
	searchText: 'No members clear members remove members empty',
};

const selectableMembers: SelectableMember[] = [
	{
		id: 'member-1',
		value: 'alex-morgan',
		label: 'Alex Morgan',
		avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&dpr=2&q=80',
		initials: 'AM',
		isCurrentUser: true,
	},
	{
		id: 'member-2',
		value: 'emma-carter',
		label: 'Emma Carter',
		avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&dpr=2&q=80',
		initials: 'EC',
	},
	{
		id: 'member-3',
		value: 'ryan-mitchell',
		label: 'Ryan Mitchell',
		initials: 'RM',
	},
	{
		id: 'member-4',
		value: 'olivia-bennett',
		label: 'Olivia Bennett',
		avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=96&h=96&dpr=2&q=80',
		initials: 'OB',
	},
	{
		id: 'member-5',
		value: 'ethan-brooks',
		label: 'Ethan Brooks',
		avatar: 'https://images.unsplash.com/photo-1504593811423-6dd665756598?w=96&h=96&dpr=2&q=80',
		initials: 'EB',
	},
	{
		id: 'member-6',
		value: 'sophia-reed',
		label: 'Sophia Reed',
		avatar: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=96&h=96&dpr=2&q=80',
		initials: 'SR',
	},
	{
		id: 'member-7',
		value: 'lucas-hayes',
		label: 'Lucas Hayes',
		avatar: 'https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=96&h=96&dpr=2&q=80',
		initials: 'LH',
	},
	{
		id: 'member-8',
		value: 'ava-sinclair',
		label: 'Ava Sinclair',
		initials: 'AS',
	},
	{
		id: 'member-9',
		value: 'mia-parker',
		label: 'Mia Parker',
		avatar: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=96&h=96&dpr=2&q=80',
		initials: 'MP',
	},
	{
		id: 'member-10',
		value: 'noah-foster',
		label: 'Noah Foster',
		avatar: 'https://images.unsplash.com/photo-1506795660185-2f0c6a1c7f6c?w=96&h=96&dpr=2&q=80',
		initials: 'NF',
	},
	{
		id: 'member-11',
		value: 'grace-collins',
		label: 'Grace Collins',
		initials: 'GC',
	},
	{
		id: 'member-12',
		value: 'jack-turner',
		label: 'Jack Turner',
		avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=96&h=96&dpr=2&q=80',
		initials: 'JT',
	},
];

const memberSelectionOptions: MemberSelectionItem[] = [noMembersOption, ...selectableMembers];

function isNoMembersOption(item: MemberSelectionItem): item is EmptyMembersOption {
	return item.id === noMembersOption.id;
}

function isMemberSelectionItemEqual(item: MemberSelectionItem, value: MemberSelectionItem) {
	return item.id === value.id;
}

function UsersGlyph({ className }: { className?: string }) {
	return <UsersIcon className={cn('size-4 shrink-0', className)} />;
}

function MemberAvatar({
	member,
	className,
	fallbackClassName,
}: {
	member: SelectableMember;
	className?: string;
	fallbackClassName?: string;
}) {
	return (
		<Avatar className={className}>
			{member.avatar ? <AvatarImage src={member.avatar} alt={member.label} /> : null}
			<AvatarFallback className={cn('text-[9px] text-foreground', fallbackClassName)}>{member.initials}</AvatarFallback>
		</Avatar>
	);
}

function MembersTriggerSummary({ selectedMembers }: { selectedMembers: SelectableMember[] }) {
	if (!selectedMembers.length) {
		return (
			<span className="flex min-w-0 items-center gap-2">
				<UsersGlyph className="text-muted-foreground" />
				<span className="truncate">Members</span>
			</span>
		);
	}

	const visibleMembers = selectedMembers.slice(0, 4);
	const hiddenMemberCount = selectedMembers.length - visibleMembers.length;
	const selectedLabel = selectedMembers.map((member) => member.label).join(', ');
	const countLabel =
		selectedMembers.length === 1
			? '1 member'
			: hiddenMemberCount > 0
				? `+${hiddenMemberCount} ${hiddenMemberCount === 1 ? 'member' : 'members'}`
				: `${selectedMembers.length} members`;

	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="sr-only">Selected members: {selectedLabel}</span>
			<AvatarGroup className="-space-x-1">
				{visibleMembers.map((member) => (
					<MemberAvatar key={member.id} member={member} className="size-5" fallbackClassName="text-[9px]" />
				))}
			</AvatarGroup>
			<span className="truncate">{countLabel}</span>
		</span>
	);
}

function MemberListRow({ member }: { member: SelectableMember }) {
	return (
		<Item size="xs" className="p-0">
			<ItemMedia>
				<MemberAvatar member={member} className="size-5" />
			</ItemMedia>
			<ItemContent>
				<ItemTitle className="gap-1 whitespace-nowrap">
					<span>{member.label}</span>
					{member.isCurrentUser ? <span className="font-normal text-muted-foreground">(You)</span> : null}
				</ItemTitle>
			</ItemContent>
		</Item>
	);
}

function MemberSelectionRow({ option }: { option: MemberSelectionItem }) {
	if (isNoMembersOption(option)) {
		return (
			<span className="flex min-w-0 items-center gap-2">
				<UsersGlyph className="text-muted-foreground" />
				<span className="truncate">{option.label}</span>
			</span>
		);
	}

	return <MemberListRow member={option} />;
}

export const MemberSelection: Story = {
	render: () => {
		const [selectedMembers, setSelectedMembers] = React.useState<SelectableMember[]>(selectableMembers.slice(0, 5));

		function handleMembersChange(nextMembers: MemberSelectionItem[]) {
			if (nextMembers.some(isNoMembersOption)) {
				setSelectedMembers([]);
				return;
			}

			setSelectedMembers(nextMembers.filter((member): member is SelectableMember => !isNoMembersOption(member)));
		}

		return (
			<Field className="max-w-xs">
				<Combobox
					multiple
					items={memberSelectionOptions}
					value={selectedMembers}
					onValueChange={handleMembersChange}
					itemToStringValue={(item: MemberSelectionItem) => (isNoMembersOption(item) ? item.searchText : item.label)}
					isItemEqualToValue={isMemberSelectionItemEqual}
					autoHighlight
				>
					<ComboboxTrigger render={<Button type="button" variant="outline" className="w-full justify-between font-normal" />}>
						<ComboboxValue placeholder="Members">
							{(selected: SelectableMember[]) => <MembersTriggerSummary selectedMembers={selected ?? []} />}
						</ComboboxValue>
					</ComboboxTrigger>

					<ComboboxContent className="max-w-(--anchor-width) min-w-(--anchor-width)">
						<ComboboxInput showTrigger={false} placeholder="Select members" className="mb-1" />
						<ComboboxEmpty>No members found.</ComboboxEmpty>
						<ComboboxList>
							<ComboboxItem value={noMembersOption}>
								<MemberSelectionRow option={noMembersOption} />
							</ComboboxItem>
							<ComboboxSeparator />

							{selectableMembers.map((member) => (
								<ComboboxItem key={member.id} value={member}>
									<MemberSelectionRow option={member} />
								</ComboboxItem>
							))}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</Field>
		);
	},
	parameters: {
		layout: 'padded',
	},
};
