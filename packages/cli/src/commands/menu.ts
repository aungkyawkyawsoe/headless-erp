/**
 * headless menu — manage module menu trees via the backend API.
 *
 * Menus are stored in the DB (_module_menus, hierarchy: Module → Group → Item)
 * and rendered by the admin UI. This command lets you build menus from the CLI:
 *
 *   headless menu list                # guided: pick module → show tree
 *   headless menu list <module>       # non-interactive
 *   headless menu add                 # guided: module → parent → label → type → target
 *   headless menu remove              # guided: pick an item to delete
 */

import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { printTable } from '../utils/format.js';
import { api } from '../utils/api.js';

// ─── Types ────────────────────────────────────────────────

interface ModuleInfo {
	slug: string;
	name: string;
	description?: string | null;
}

interface MenuNode {
	id: string;
	label: string;
	label_my?: string | null;
	icon?: string | null;
	type: string;
	target?: string | null;
	children?: MenuNode[];
}

// ─── Tree helpers ─────────────────────────────────────────

/** Flatten a menu tree into selectable rows with indentation. */
function flattenTree(
	nodes: MenuNode[],
	depth = 0,
	out: Array<{ node: MenuNode; indent: string }> = [],
): Array<{ node: MenuNode; indent: string }> {
	for (const n of nodes) {
		out.push({ node: n, indent: '  '.repeat(depth) });
		if (n.children?.length) flattenTree(n.children, depth + 1, out);
	}
	return out;
}

// ─── Commands ─────────────────────────────────────────────

async function pickModule(message = 'Which module?'): Promise<ModuleInfo> {
	const mods = await api<ModuleInfo[]>('/api/modules');
	if (!mods.length) throw new Error('No modules found. Create one first via the admin UI or API.');
	if (!process.stdout.isTTY) return mods[0];
	const picked = (await p.select({
		message,
		options: mods.map((m) => ({ value: m.slug, label: m.name, hint: m.description ?? undefined })),
	})) as string;
	if (p.isCancel(picked)) process.exit(0);
	return mods.find((m) => m.slug === picked)!;
}

async function pickMenuNode(slug: string): Promise<{ parent_id: string | null; label: string } | null> {
	const tree = await api<MenuNode[]>(`/api/modules/${slug}/menus?all=true`);
	if (!tree.length) return null;
	const flat = flattenTree(tree);
	const picked = (await p.select({
		message: 'Attach under which item?',
		options: [
			{ value: '__root__', label: '(top level)' },
			...flat.map(({ node, indent }) => ({ value: node.id, label: `${indent}${node.label} (${node.type})` })),
		],
	})) as string;
	if (p.isCancel(picked)) process.exit(0);
	return picked === '__root__'
		? { parent_id: null, label: '(top level)' }
		: { parent_id: picked, label: flat.find((f) => f.node.id === picked)!.node.label };
}

// ─── headless menu list ───────────────────────────────────

async function menuList(moduleSlug?: string): Promise<void> {
	const mod = moduleSlug ? await api<ModuleInfo[]>('/api/modules').then((ms) => ms.find((m) => m.slug === moduleSlug)) : await pickModule();
	if (!mod) {
		console.error(pc.red(`  Module "${moduleSlug}" not found.`));
		process.exit(1);
	}

	const tree = await api<MenuNode[]>(`/api/modules/${mod.slug}/menus?all=true`);
	if (!tree.length) {
		console.log(pc.dim(`  No menu items yet for "${mod.name}". Add one: headless menu add`));
		return;
	}

	const rows = flattenTree(tree).map(({ node, indent }) => ({
		label: `${indent}${node.label}`,
		type: node.type,
		target: node.target ?? '',
		id: node.id,
	}));
	printTable(rows, ['label', 'type', 'target', 'id']);
}

// ─── headless menu add ────────────────────────────────────

async function menuAdd(): Promise<void> {
	const mod = await pickModule('Which module should the menu item belong to?');

	const parent = await pickMenuNode(mod.slug);
	if (parent) console.log(pc.dim(`  → parent: ${parent.label}`));

	const label = (await p.text({
		message: 'Menu label (shown in the sidebar)?',
		validate: (v) => ((v ?? '').trim().length ? undefined : 'Label is required'),
	})) as string;
	if (p.isCancel(label)) process.exit(0);

	const type = (await p.select({
		message: 'Item type?',
		options: [
			{ value: 'link', label: 'link', hint: 'Navigates to a URL or collection route' },
			{ value: 'group', label: 'group', hint: 'A section header that holds child items' },
			{ value: 'action', label: 'action', hint: 'Triggers a server action' },
		],
	})) as 'link' | 'group' | 'action';
	if (p.isCancel(type)) process.exit(0);

	let target: string | undefined;
	if (type === 'link') {
		target = (await p.text({
			message: 'Target (URL or route, e.g. /products or https://...)?',
			placeholder: '/products',
		})) as string;
		if (p.isCancel(target)) process.exit(0);
	}

	const icon = (await p.text({ message: 'Icon (lucide name, optional)?', placeholder: 'box' })) as string;
	if (p.isCancel(icon)) process.exit(0);

	const item = await api<MenuNode>(`/api/modules/${mod.slug}/menus`, {
		method: 'POST',
		body: {
			parent_id: parent?.parent_id ?? null,
			label,
			type,
			target: target?.trim() || undefined,
			icon: icon?.trim() || undefined,
		},
	});
	console.log(pc.green(`✓ Added menu item "${item.label}" (${item.type}) to ${mod.name}`));
}

// ─── headless menu remove ─────────────────────────────────

async function menuRemove(menuId?: string): Promise<void> {
	const mod = await pickModule();

	const tree = await api<MenuNode[]>(`/api/modules/${mod.slug}/menus?all=true`);
	if (!tree.length) {
		console.log(pc.dim(`  No menu items to remove for "${mod.name}".`));
		return;
	}

	let id = menuId;
	if (!id) {
		const flat = flattenTree(tree);
		const picked = (await p.select({
			message: 'Which item to remove?',
			options: flat.map(({ node, indent }) => ({ value: node.id, label: `${indent}${node.label} (${node.type})` })),
		})) as string;
		if (p.isCancel(picked)) process.exit(0);
		id = picked;
	}

	await api<{ deleted: boolean }>(`/api/modules/menus/${id}`, { method: 'DELETE' });
	console.log(pc.green(`✓ Removed menu item (children were deleted recursively).`));
}

// ─── Register ─────────────────────────────────────────────

export function registerMenuCommands(program: Command): void {
	const menu = program.command('menu').description('Manage module menu trees (Module → Group → Item)');

	menu
		.command('list [module]')
		.description('Show a module menu tree — guided when run without arguments')
		.action(async (moduleSlug?: string) => {
			try {
				await menuList(moduleSlug);
			} catch (err) {
				console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
				process.exit(1);
			}
		});

	menu
		.command('add')
		.description('Add a menu item (guided: module → parent → label → type → target)')
		.action(async () => {
			try {
				await menuAdd();
			} catch (err) {
				console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
				process.exit(1);
			}
		});

	menu
		.command('remove [id]')
		.description('Remove a menu item — guided when run without an id')
		.action(async (menuId?: string) => {
			try {
				await menuRemove(menuId);
			} catch (err) {
				console.error(pc.red('Error:'), err instanceof Error ? err.message : err);
				process.exit(1);
			}
		});
}
