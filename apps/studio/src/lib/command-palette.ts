/**
 * Command palette — the pure filter half.
 *
 * A palette is just a searchable list of actions; keeping the filter pure makes
 * it testable without a DOM and keeps the component a thin renderer. Matching is
 * a case-insensitive substring over label + keywords + group; an empty query
 * shows everything (in declaration order).
 */

export interface PaletteCommand {
	/** Stable id (React key + dedupe). */
	id: string;
	/** What the row shows. */
	label: string;
	/** Section header the row sits under. */
	group: string;
	/** Extra search terms (aliases, slugs). */
	keywords?: string;
	/** Invoked when the row is chosen. */
	run: () => void;
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
	const q = query.trim().toLowerCase();
	if (!q) return commands;
	return commands.filter((c) => `${c.label} ${c.keywords ?? ''} ${c.group}`.toLowerCase().includes(q));
}
