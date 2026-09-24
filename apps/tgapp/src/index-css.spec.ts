/// <reference types="node" />
/**
 * Guards the mini app's Tailwind wiring.
 *
 * The app does NOT import the design system's prebuilt `styles.css` — that sheet
 * was compiled from every DS component and shipped a second, mostly-dead copy of
 * every DS rule (~250 kB of critical CSS). Instead `src/index.css` imports the DS
 * theme source and scans an explicit `@source` closure of the DS components the
 * app actually renders. If a DS import is added without the matching `@source`,
 * that component silently renders unstyled — this test makes that a failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(APP_SRC, '../../..');
const DS_SRC = path.join(ROOT, 'packages', 'design-system', 'src');
const INDEX_CSS = path.join(APP_SRC, 'index.css');

/** Recursively list .ts/.tsx files under a directory. */
function listFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) listFiles(p, acc);
		else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(p);
	}
	return acc;
}

/** Every `@source '<dir>'` path in index.css (the `not` exclusions skipped). */
function sourceDirs(): string[] {
	const css = readFileSync(INDEX_CSS, 'utf8');
	return [...css.matchAll(/@source\s+(?!not\b)'([^']+)'/g)].map((m) => path.resolve(path.dirname(INDEX_CSS), m[1]));
}

/** Resolves a design-system-internal import specifier to a source file. */
function resolveSpec(spec: string, fromFile: string): string | null {
	let base: string;
	if (spec.startsWith('@/utils')) base = path.join(DS_SRC, 'lib/utils', spec.slice('@/utils'.length));
	else if (spec.startsWith('@/hooks')) base = path.join(DS_SRC, 'lib/hooks', spec.slice('@/hooks'.length));
	else if (spec.startsWith('@/types')) base = path.join(DS_SRC, 'lib/types', spec.slice('@/types'.length));
	else if (spec.startsWith('@/date')) base = path.join(DS_SRC, 'lib/date', spec.slice('@/date'.length));
	else if (spec.startsWith('@/')) base = path.join(DS_SRC, 'components', spec.slice(2));
	else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
	else return null; // bare package import — not DS-internal
	const candidates = [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')];
	return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g;

describe('tgapp Tailwind source wiring', () => {
	it('never imports the prebuilt DS stylesheet or scans the DS dist', () => {
		const css = readFileSync(INDEX_CSS, 'utf8');
		expect(css).not.toContain('design-system/styles.css');
		// Scanning the compiled dist would re-emit every DS utility.
		expect(css).not.toMatch(/@source\s+'[^']*design-system\/dist/);

		for (const file of listFiles(APP_SRC)) {
			if (file === fileURLToPath(import.meta.url)) continue;
			expect(readFileSync(file, 'utf8')).not.toContain("'@mmbix/design-system/styles.css'");
		}
	});

	it('scans the transitive DS source closure of every DS subpath import', () => {
		const sources = sourceDirs();
		expect(sources.length).toBeGreaterThan(0);

		const entries = new Set<string>();
		for (const file of listFiles(APP_SRC)) {
			for (const m of readFileSync(file, 'utf8').matchAll(/['"]@mmbix\/design-system\/([a-z-]+)['"]/g)) {
				entries.add(m[1]);
			}
		}
		expect(entries.size).toBeGreaterThan(0);

		const seen = new Set<string>();
		const queue: string[] = [];
		const add = (file: string | null) => {
			if (!file || seen.has(file) || !file.startsWith(DS_SRC)) return;
			seen.add(file);
			queue.push(file);
		};
		for (const name of entries) add(resolveSpec(`@/${name}`, path.join(DS_SRC, 'components', name, 'index.tsx')));
		while (queue.length) {
			const file = queue.shift() as string;
			const text = readFileSync(file, 'utf8');
			let m: RegExpExecArray | null;
			IMPORT_RE.lastIndex = 0;
			while ((m = IMPORT_RE.exec(text))) add(resolveSpec(m[1], file));
		}

		const covered = (file: string) => sources.some((dir) => file === dir || file.startsWith(dir + path.sep));
		const uncovered = [...seen].filter((f) => !covered(f)).map((f) => path.relative(ROOT, f));
		expect(uncovered).toEqual([]);
	});
});
