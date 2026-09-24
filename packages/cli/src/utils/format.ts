import pc from 'picocolors';

// ── Global Options Context ──────────────────────────────

export interface FormatContext {
	json?: boolean;
	noColor?: boolean;
	dryRun?: boolean;
	verbose?: boolean;
}

let _ctx: FormatContext = {};

/** Set the global format context (called once at program start). */
export function setFormatContext(ctx: FormatContext): void {
	_ctx = ctx;
}

/** Get the current format context. */
export function getFormatContext(): FormatContext {
	return _ctx;
}

// ── Color-Aware Wrappers ────────────────────────────────

function c(fn: (s: string) => string, msg: string): string {
	return _ctx.noColor ? msg : fn(msg);
}

// ── Table ───────────────────────────────────────────────

/**
 * Print an array of objects as a formatted table.
 * If `columns` is provided, only those columns are shown (in that order).
 */
export function printTable(rows: object[], columns?: string[]): void {
	if (_ctx.json) {
		console.log(JSON.stringify(rows, null, 2));
		return;
	}

	if (rows.length === 0) {
		console.log(pc.dim('  (empty)'));
		return;
	}

	const keys = columns ?? Object.keys(rows[0]);

	// Calculate column widths
	const widths: Record<string, number> = {};
	for (const key of keys) {
		widths[key] = key.length;
		for (const row of rows) {
			const val = String((row as Record<string, unknown>)[key] ?? '');
			if (val.length > widths[key]) widths[key] = val.length;
		}
	}

	// Header
	const headerParts = keys.map((k) => pc.bold(k.padEnd(widths[k])));
	console.log('  ' + headerParts.join('  '));

	// Separator
	const sepParts = keys.map((k) => '─'.repeat(widths[k]));
	console.log('  ' + sepParts.join('  '));

	// Rows
	for (const row of rows) {
		const parts = keys.map((k) => {
			const val = String((row as Record<string, unknown>)[k] ?? '');
			return val.padEnd(widths[k]);
		});
		console.log('  ' + parts.join('  '));
	}
}

// ── Detail View ─────────────────────────────────────────

/**
 * Print a key-value detail view.
 * Keys are bold, values indented.
 */
export function printDetail(data: object): void {
	if (_ctx.json) {
		console.log(JSON.stringify(data, null, 2));
		return;
	}

	const maxKeyLen = Math.max(...Object.keys(data).map((k) => k.length));

	for (const [key, value] of Object.entries(data) as Array<[string, unknown]>) {
		const displayValue = value === undefined || value === null ? pc.dim('(none)') : String(value);
		console.log(`  ${pc.bold(key.padEnd(maxKeyLen))}  ${displayValue}`);
	}
}

// ── Message Helpers ─────────────────────────────────────

export function success(msg: string): void {
	console.log(c(pc.green, `✔ ${msg}`));
}

export function error(msg: string): void {
	console.error(c(pc.red, `✖ ${msg}`));
}

export function info(msg: string): void {
	console.log(c(pc.cyan, `ℹ ${msg}`));
}

// ── Verbose Logging ─────────────────────────────────────

export function debug(msg: string): void {
	if (_ctx.verbose) {
		console.log(c(pc.dim, `  [debug] ${msg}`));
	}
}
