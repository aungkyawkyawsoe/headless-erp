import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../card';
import { AppWindowIcon, CodeIcon } from 'lucide-react';

/**
 * A set of layered sections of content—known as tab panels—that are displayed
 * one at a time.
 */
const meta: Meta<typeof Tabs> = {
	title: 'Components/Tabs',
	component: Tabs,
	parameters: {
		layout: 'centered',
		docs: {
			description: {
				component: 'A tabs component. Supports horizontal and vertical orientations, multiple variants, disabled tabs, and icon triggers.',
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
				story: 'A basic tabs component with a list of triggers and content panels. Use `defaultValue` to set the initially active tab.',
			},
		},
	},
	render: () => (
		<Tabs defaultValue="account" className="w-100">
			<TabsList>
				<TabsTrigger value="account">Account</TabsTrigger>
				<TabsTrigger value="password">Password</TabsTrigger>
			</TabsList>
			<TabsContent value="account">
				<Card>
					<CardHeader>
						<CardTitle>Account</CardTitle>
						<CardDescription>Make changes to your account here. Click save when you are done.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Account settings content goes here.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="password">
				<Card>
					<CardHeader>
						<CardTitle>Password</CardTitle>
						<CardDescription>Change your password here. After saving, you will be logged out.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Password settings content goes here.</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	),
};

// ── Line ─────────────────────────────────────────────────

export const Line: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use the `variant="line"` prop on `TabsList` for a line style indicator instead of the default filled background.',
			},
		},
	},
	render: () => (
		<Tabs defaultValue="overview" className="w-100">
			<TabsList variant="line">
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="analytics">Analytics</TabsTrigger>
				<TabsTrigger value="reports">Reports</TabsTrigger>
			</TabsList>
			<TabsContent value="overview">
				<Card>
					<CardHeader>
						<CardTitle>Overview</CardTitle>
						<CardDescription>View your key metrics and recent project activity.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Overview content goes here.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="analytics">
				<Card>
					<CardHeader>
						<CardTitle>Analytics</CardTitle>
						<CardDescription>View detailed analytics data.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Analytics content goes here.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="reports">
				<Card>
					<CardHeader>
						<CardTitle>Reports</CardTitle>
						<CardDescription>Generate and view reports.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Reports content goes here.</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	),
};

// ── Vertical ─────────────────────────────────────────────

export const Vertical: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Use `orientation="vertical"` for vertical tabs with triggers stacked on the left and content on the right.',
			},
		},
	},
	render: () => (
		<Tabs defaultValue="account" orientation="vertical" className="w-125">
			<TabsList>
				<TabsTrigger value="account">Account</TabsTrigger>
				<TabsTrigger value="password">Password</TabsTrigger>
				<TabsTrigger value="notifications">Notifications</TabsTrigger>
			</TabsList>
			<TabsContent value="account">
				<Card>
					<CardHeader>
						<CardTitle>Account</CardTitle>
						<CardDescription>Make changes to your account here.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Account settings content.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="password">
				<Card>
					<CardHeader>
						<CardTitle>Password</CardTitle>
						<CardDescription>Change your password here.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Password settings content.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="notifications">
				<Card>
					<CardHeader>
						<CardTitle>Notifications</CardTitle>
						<CardDescription>Manage your notification preferences.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Notifications settings content.</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	),
};

// ── Disabled ─────────────────────────────────────────────

export const Disabled: Story = {
	parameters: {
		docs: {
			description: {
				story: 'Add the `disabled` prop to a `TabsTrigger` to disable that tab. Disabled tabs cannot be selected.',
			},
		},
	},
	render: () => (
		<Tabs defaultValue="home" className="w-100">
			<TabsList>
				<TabsTrigger value="home">Home</TabsTrigger>
				<TabsTrigger value="disabled" disabled>
					Disabled
				</TabsTrigger>
			</TabsList>
			<TabsContent value="home">
				<Card>
					<CardHeader>
						<CardTitle>Home</CardTitle>
						<CardDescription>This is the home tab content.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Welcome to the home tab.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="disabled">
				<Card>
					<CardHeader>
						<CardTitle>Disabled</CardTitle>
						<CardDescription>This tab is disabled.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">You should not be able to see this.</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	),
};

// ── Icons ────────────────────────────────────────────────

export const Icons: Story = {
	parameters: {
		docs: {
			description: {
				story:
					'Add icons to `TabsTrigger` for visual identification. Use `data-icon="inline-start"` or `data-icon="inline-end"` for proper spacing.',
			},
		},
	},
	render: () => (
		<Tabs defaultValue="preview" className="w-100">
			<TabsList>
				<TabsTrigger value="preview">
					<AppWindowIcon data-icon="inline-start" />
					Preview
				</TabsTrigger>
				<TabsTrigger value="code">
					<CodeIcon data-icon="inline-start" />
					Code
				</TabsTrigger>
			</TabsList>
			<TabsContent value="preview">
				<Card>
					<CardHeader>
						<CardTitle>Preview</CardTitle>
						<CardDescription>Preview your changes in real-time.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Preview content goes here.</CardContent>
				</Card>
			</TabsContent>
			<TabsContent value="code">
				<Card>
					<CardHeader>
						<CardTitle>Code</CardTitle>
						<CardDescription>View and edit the source code.</CardDescription>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">Code editor content goes here.</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	),
};
