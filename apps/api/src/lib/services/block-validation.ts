/**
 * Page-block normalization — the ONE validator for a page block tree.
 *
 * The vocabulary is `BLOCK_REGISTRY` (SSOT). Until now nothing that wrote a page
 * through the engine checked its blocks against that registry, so an unknown
 * `type` was accepted and then rendered as nothing — a silent no-op. This drops
 * what the renderer cannot draw and reports it, the same drop-and-warn contract
 * `normalizeFields` uses for a field list, so the manifest path, the patch path
 * and any future writer all agree.
 */
import { BLOCK_REGISTRY, isContainerType, type BlockRegistryEntry } from '@mmbix/ui-views/block-registry';

const BY_TYPE: Map<string, BlockRegistryEntry> = new Map(BLOCK_REGISTRY.map((b) => [b.type, b]));

/** A block after normalization — layout/config always present, children validated. */
export interface NormalizedBlock {
	id: string;
	type: string;
	label?: string;
	layout: Record<string, unknown> & { order: number };
	config: Record<string, unknown>;
	children?: NormalizedBlock[];
}

export function isKnownBlockType(type: string): boolean {
	return BY_TYPE.has(type);
}

/** The block vocabulary an agent may reference (see `factory://blocks`). */
export function blockVocabulary(): Array<{
	type: string;
	label: string;
	group: string;
	container: boolean;
	resolve?: string;
	defaults: Record<string, unknown>;
	allowedChildren?: string[] | null;
}> {
	return BLOCK_REGISTRY.map((b) => ({
		type: b.type,
		label: b.label,
		group: b.group,
		container: isContainerType(b.type),
		...(b.resolve ? { resolve: b.resolve } : {}),
		defaults: b.defaults,
		...(b.allowedChildren !== undefined ? { allowedChildren: b.allowedChildren } : {}),
	}));
}

const MAX_BLOCKS = 500;
const MAX_DEPTH = 12;

/**
 * Validate + normalize an untrusted block list. Unknown types and illegal nesting
 * are DROPPED with a warning — never invented, never silently kept.
 */
export function normalizeBlocks(owner: string, input: unknown, warnings: string[], depth = 0): NormalizedBlock[] {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) {
		warnings.push(`${owner}: blocks must be an array`);
		return [];
	}
	if (depth > MAX_DEPTH) {
		warnings.push(`${owner}: blocks nested deeper than ${MAX_DEPTH} — dropped`);
		return [];
	}
	const out: NormalizedBlock[] = [];
	input.slice(0, MAX_BLOCKS).forEach((raw, i) => {
		const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
		const type = typeof b?.type === 'string' ? b.type : '';
		if (!b || !type) {
			warnings.push(`${owner}: dropped a block with no type`);
			return;
		}
		const entry = BY_TYPE.get(type);
		if (!entry) {
			warnings.push(`${owner}: dropped block with unknown type "${type}" (see factory://blocks)`);
			return;
		}
		const id = typeof b.id === 'string' && b.id ? b.id : `${owner.replace(/[^a-zA-Z0-9]+/g, '_')}_${i}`;
		const rawLayout = b.layout && typeof b.layout === 'object' && !Array.isArray(b.layout) ? (b.layout as Record<string, unknown>) : {};
		const layout = { ...rawLayout, order: typeof rawLayout.order === 'number' ? rawLayout.order : i };
		const config = b.config && typeof b.config === 'object' && !Array.isArray(b.config) ? (b.config as Record<string, unknown>) : {};

		let children: NormalizedBlock[] | undefined;
		const rawChildren = b.children;
		if (rawChildren !== undefined) {
			if (!isContainerType(type)) {
				warnings.push(`${owner}: block "${type}" is not a container — dropped its children`);
			} else {
				children = normalizeBlocks(`${owner}/${type}`, rawChildren, warnings, depth + 1);
				if (entry.allowedChildren && entry.allowedChildren.length) {
					const allowed = new Set(entry.allowedChildren);
					for (const child of children) {
						if (!allowed.has(child.type)) warnings.push(`${owner}: block "${type}" cannot contain "${child.type}" — dropped`);
					}
					children = children.filter((child) => allowed.has(child.type));
				}
			}
		}

		out.push({
			id,
			type,
			...(typeof b.label === 'string' ? { label: b.label } : {}),
			layout,
			config,
			...(children && children.length ? { children } : {}),
		});
	});
	return out;
}
