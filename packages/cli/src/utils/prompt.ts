/**
 * Guided-mode prompt helpers (clack).
 *
 * Pattern: every CLI command that takes an argument should fall back to an
 * interactive prompt when the argument is omitted AND the terminal is a TTY —
 * so `headless client deploy` alone walks the user through the choices.
 *
 * All helpers return `null` / `[]` when the terminal is NOT interactive, so
 * callers keep their existing non-interactive error paths for CI/scripts.
 */
import * as p from '@clack/prompts';
import { isConnectionError, connectionHint } from './api.js';

export interface Choice<T extends string | number | boolean = string> {
	value: T;
	label: string;
	hint?: string;
}

export function isInteractive(): boolean {
	return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
}

/** @clack/prompts' Option<T> — the lib doesn't export it (its Option type is a
 *  deferred conditional over the value generic), so derive it from the select
 *  signature and cast once (the double-cast is required because the conditional
 *  doesn't resolve for a generic T). Runtime shape is unchanged. */
type ClackOption<T extends string | number | boolean> = Parameters<typeof p.select<T>>[0]['options'][number];

/** Single-select. Returns the chosen value, or null when non-TTY / cancelled. */
export async function guideSelect<T extends string | number | boolean = string>(message: string, choices: Choice<T>[]): Promise<T | null> {
	if (!isInteractive()) return null;
	const value = await p.select({ message, options: choices as unknown as ClackOption<T>[] });
	if (p.isCancel(value)) {
		p.cancel('Cancelled');
		return null;
	}
	return value as T;
}

/** Multi-select (space to toggle, enter to confirm). Returns [] when non-TTY / cancelled. */
export async function guideMultiselect<T extends string | number | boolean = string>(
	message: string,
	choices: Choice<T>[],
	opts?: { required?: boolean },
): Promise<T[]> {
	if (!isInteractive()) return [];
	const value = await p.multiselect({
		message,
		options: choices as unknown as ClackOption<T>[],
		required: opts?.required ?? false,
	});
	if (p.isCancel(value)) {
		p.cancel('Cancelled');
		return [];
	}
	return (value as T[]) ?? [];
}

/**
 * Run a guided action ONLY in an interactive TTY; otherwise print the usage
 * hint and exit 1. This is the single "omit arg → prompt; script → usage"
 * gate that every command that takes an argument uses, replacing the
 * hand-copied `if (!isInteractive()) console.error('Usage: ...')` blocks.
 *
 * @param usage the non-interactive usage line to print (exact command + args)
 * @param run   the interactive body — callers prompt inside it
 */
export async function guardInteractive(usage: string, run: () => Promise<void>): Promise<void> {
	if (!isInteractive()) {
		console.error(`  Usage: ${usage}`);
		process.exit(1);
	}
	await run();
}

/**
 * Wrap an async action with the standard error handling: print a red error +
 * a connectivity hint when the failure is a network error. Single source of
 * truth for the ~15 duplicated `try/catch { console.error(pc.red(...)) }`
 * blocks across command files.
 */
export async function orError<T>(action: () => Promise<T>, ctx?: { usage?: string }): Promise<T | void> {
	try {
		return await action();
	} catch (err) {
		if (isConnectionError(err)) {
			console.error('Cannot connect to the API.');
			console.log(connectionHint());
		} else {
			console.error(err instanceof Error ? err.message : String(err));
		}
		if (ctx?.usage) console.log(`  Run "${ctx.usage}" for details.`);
		process.exitCode = 1;
	}
}

/** Yes/no confirmation. Returns null when non-TTY. */
export async function guideConfirm(message: string, initialValue = true): Promise<boolean | null> {
	if (!isInteractive()) return null;
	const value = await p.confirm({ message, initialValue });
	if (p.isCancel(value)) {
		p.cancel('Cancelled');
		return null;
	}
	return Boolean(value);
}
