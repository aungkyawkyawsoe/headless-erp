/**
 * Migration-set dry-run — validates the numbered migration ledger is well-formed
 * WITHOUT a database, so a malformed migration fails in CI instead of on the next
 * worker cold start.
 *
 * The migration "set" is the union of every declarative migration definition:
 *   - core schema migrations:   `packages/core/src/db/migrations.ts` (MIGRATIONS)
 *   - plugin / module migrations: every `migrations: [...]` block under
 *     `apps/api/src/plugins/**` and `apps/api/src/domain-modules/**`
 * Both feed the SAME `_migrations` ledger, keyed by `name`: core through
 * `MigrationRunner` (packages/core), plugins through `PluginMigrationService`.
 *
 * Three checks, all hard failures:
 *   1. NUMBERED  — every migration name is `<3 digits>_<slug>` (the ordering key).
 *   2. UNIQUE    — no duplicate name anywhere in the set. `_migrations` is keyed by
 *                  name: a duplicate in one list double-applies within a single run,
 *                  and a duplicate against an already-applied name silently no-ops.
 *   3. ONE STATEMENT per entry — a `sql` value must be a single SQL statement. D1
 *                  prepares each entry (`db.run` for plugins, `db.batch` for core)
 *                  and rejects a multi-statement string; a leading `%`-free
 *                  multi-statement batch is exactly what a stray `;` produces.
 *
 * TRUTHFUL NOTE on "single-line": core migrations run through `db.batch()` and
 * plugin migrations through `db.run()` — both take a *prepared* statement, where a
 * multi-line SINGLE statement is valid (several plugin migrations span lines and
 * ship in production today). The newline hazard is specific to `db.exec()`, which
 * splits its input on newlines (see AGENTS.md); `db.exec` is used for ad-hoc DDL
 * elsewhere, not for the migration set. So this check enforces ONE STATEMENT per
 * entry (the real invariant) and merely COUNTS multi-line entries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_MIGRATIONS = 'packages/core/src/db/migrations.ts';
const SCAN_DIRS = ['apps/api/src/plugins', 'apps/api/src/domain-modules'];

const SQL_START = /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|PRAGMA|WITH|SELECT|ANALYZE|REINDEX|VACUUM)\b/i;
const NUMBERED_NAME = /^\d{3}_[a-z0-9_]+$/;

// ─── Source scanning ────────────────────────────────────

/** Walk a directory tree, returning `.ts` files (migration definitions live in TS). */
function walkTs(dir) {
	const out = [];
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walkTs(full));
		else if (e.name.endsWith('.ts')) out.push(full);
	}
	return out;
}

/**
 * Scan TS source for string/template literals, and return a same-length copy where
 * comments and literal bodies are blanked out (newlines kept). Positions/line
 * numbers are preserved so we can locate a literal and its surrounding code
 * without being fooled by `//` or `'` inside a literal.
 */
function scanLiterals(src) {
	const literals = [];
	const chars = src.split('');
	const mask = (from, to) => {
		for (let k = from; k < to && k < chars.length; k++) if (chars[k] !== '\n') chars[k] = ' ';
	};
	let i = 0;
	let line = 1;
	const n = src.length;
	while (i < n) {
		const ch = src[i];
		const nx = src[i + 1];
		if (ch === '/' && nx === '/') {
			const s = i;
			while (i < n && src[i] !== '\n') i++;
			mask(s, i);
			continue;
		}
		if (ch === '/' && nx === '*') {
			const s = i;
			i += 2;
			while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
				if (src[i] === '\n') line++;
				i++;
			}
			i += 2;
			mask(s, i);
			continue;
		}
		if (ch === "'" || ch === '"') {
			const quote = ch;
			const s = i;
			const at = line;
			i++;
			let value = '';
			while (i < n) {
				const c = src[i];
				if (c === '\\') {
					value += src[i + 1] ?? '';
					i += 2;
					continue;
				}
				if (c === quote) {
					i++;
					break;
				}
				if (c === '\n') line++;
				value += c;
				i++;
			}
			mask(s, i);
			literals.push({ value, start: s, line: at });
			continue;
		}
		if (ch === '`') {
			const s = i;
			const at = line;
			i++;
			let value = '';
			let brace = 0;
			while (i < n) {
				const c = src[i];
				if (c === '\\') {
					value += src[i + 1] ?? '';
					i += 2;
					continue;
				}
				if (brace === 0 && c === '`') {
					i++;
					break;
				}
				if (c === '$' && src[i + 1] === '{') {
					brace++;
					value += '${';
					i += 2;
					continue;
				}
				if (brace > 0) {
					if (c === '{') brace++;
					else if (c === '}') brace--;
				}
				if (c === '\n') line++;
				value += c;
				i++;
			}
			mask(s, i);
			literals.push({ value, start: s, line: at });
			continue;
		}
		if (ch === '\n') line++;
		i++;
	}
	return { literals, masked: chars.join('') };
}

/** Bracket-match every `[ ... ]` opened by a regex match that ends on `[`. */
function arrayRegions(masked, re) {
	const regions = [];
	re.lastIndex = 0;
	let m;
	while ((m = re.exec(masked))) {
		const open = m.index + m[0].length - 1;
		let depth = 0;
		let end = masked.length;
		for (let i = open; i < masked.length; i++) {
			if (masked[i] === '[') depth++;
			else if (masked[i] === ']') {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		regions.push([open, end]);
	}
	return regions;
}

const inAny = (regions, pos) => regions.some(([a, b]) => pos > a && pos < b);

function collect() {
	const files = [path.join(ROOT, CORE_MIGRATIONS), ...SCAN_DIRS.flatMap((d) => walkTs(path.join(ROOT, d)))];
	const migrations = [];
	const statements = [];
	for (const abs of files) {
		const rel = path.relative(ROOT, abs);
		let src;
		try {
			src = fs.readFileSync(abs, 'utf-8');
		} catch {
			continue;
		}
		const { literals, masked } = scanLiterals(src);
		const migRegions = arrayRegions(masked, /migrations\s*:\s*\[/g);
		const ddlRegions = arrayRegions(masked, /(?:const|let|var)\s+\w*DDL\w*\s*=\s*\[/g);
		// Core migrations are declared in `const MIGRATIONS: Migration[] = [ … ]` (no
		// `migrations:` key), so scope `.raw()` detection to that array — otherwise the
		// runner's own runtime `QueryBuilder.raw(INSERT INTO _roles …)` is miscounted.
		const coreRegions = arrayRegions(masked, /const\s+MIGRATIONS\b[^=]*=\s*\[/g);
		const isCore = rel === CORE_MIGRATIONS;
		for (const lit of literals) {
			const prefix = masked.slice(Math.max(0, lit.start - 48), lit.start);
			const isNameField = /(^|[^\w$])name\s*:\s*$/.test(prefix);
			const inMig = inAny(migRegions, lit.start);
			const inDdl = inAny(ddlRegions, lit.start);
			const isRawArg = isCore && /\braw\s*\(\s*$/.test(prefix) && inAny(coreRegions, lit.start);
			const looksSql = SQL_START.test(lit.value);
			if (isNameField && NUMBERED_NAME.test(lit.value)) migrations.push({ name: lit.value, file: rel, line: lit.line });
			else if (isNameField && inMig && lit.value.trim()) migrations.push({ name: lit.value, file: rel, line: lit.line });
			else if (looksSql && !lit.value.includes('${') && (inMig || inDdl || isRawArg))
				statements.push({ sql: lit.value, file: rel, line: lit.line });
		}
	}
	return { migrations, statements };
}

// ─── Pure validation (self-tested below) ────────────────

/** Number of statements in a SQL string, ignoring `;` inside strings and comments. */
function countStatements(sql) {
	let masked = '';
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i];
		const nx = sql[i + 1];
		if (ch === '-' && nx === '-') {
			while (i < sql.length && sql[i] !== '\n') i++;
			continue;
		}
		if (ch === '/' && nx === '*') {
			i += 2;
			while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		if (ch === "'" || ch === '"') {
			const quote = ch;
			i++;
			while (i < sql.length) {
				if (sql[i] === '\\') {
					i += 2;
					continue;
				}
				if (sql[i] === quote) {
					i++;
					break;
				}
				i++;
			}
			masked += ' ';
			continue;
		}
		masked += ch;
		i++;
	}
	return masked
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean).length;
}

function validateSet(migrations, statements) {
	const errors = [];
	const seen = new Map();
	for (const m of migrations) {
		if (!NUMBERED_NAME.test(m.name)) {
			errors.push(`${m.file}:${m.line}: migration name "${m.name}" is not numbered — expected "<3 digits>_<slug>"`);
		}
		const prev = seen.get(m.name);
		if (prev)
			errors.push(
				`${m.file}:${m.line}: duplicate migration name "${m.name}" (also ${prev.file}:${prev.line}) — \`_migrations\` is keyed by name`,
			);
		else seen.set(m.name, m);
	}
	let multiline = 0;
	for (const s of statements) {
		const t = s.sql.trim();
		if (!t) {
			errors.push(`${s.file}:${s.line}: empty migration statement`);
			continue;
		}
		const count = countStatements(t);
		if (count > 1) {
			const first = t.split('\n')[0].trim().slice(0, 60);
			errors.push(`${s.file}:${s.line}: migration entry holds ${count} statements (must be ONE) — split it. Starts: ${first}`);
		}
		if (t.includes('\n')) multiline++;
	}
	return { errors, stats: { migrations: migrations.length, statements: statements.length, multiline } };
}

// ─── Self-test — prove the guard rejects each malformed shape ───

function selfTest() {
	const name = (n) => ({ name: n, file: 'x', line: 1 });
	const sql = (q) => ({ sql: q, file: 'x', line: 1 });
	const ok = (cond, label) => {
		if (!cond) {
			console.error(`✗ self-test failed: ${label}`);
			process.exit(1);
		}
	};
	ok(validateSet([name('001_a')], [sql('CREATE TABLE t (a INTEGER)')]).errors.length === 0, 'well-formed set should pass');
	ok(validateSet([name('001_a')], [sql('CREATE TABLE t (a INTEGER);')]).errors.length === 0, 'trailing semicolon is fine');
	ok(
		validateSet([name('001_a')], [sql('CREATE TABLE t (\n  a INTEGER,\n  b INTEGER\n)')]).errors.length === 0,
		'multi-line single statement is fine',
	);
	ok(
		validateSet([name('001_a')], [sql("INSERT INTO t VALUES ('a;b')")]).errors.length === 0,
		'semicolon inside a string is not a separator',
	);
	ok(validateSet([name('add_users')], []).errors.length === 1, 'non-numbered name should fail');
	ok(validateSet([name('001_a'), name('001_a')], []).errors.length === 1, 'duplicate name should fail');
	ok(
		validateSet([], [sql('CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER)')]).errors.length === 1,
		'multi-statement entry should fail',
	);
	ok(validateSet([], [sql('   ')]).errors.length === 1, 'empty statement should fail');
}

// ─── Run ────────────────────────────────────────────────

selfTest();

const { migrations, statements } = collect();
const { errors, stats } = validateSet(migrations, statements);

if (errors.length > 0) {
	console.error('✗ migration set is malformed:');
	for (const e of errors) console.error(`  ${e}`);
	process.exit(1);
}
console.log(
	`✓ migration set well-formed — ${stats.migrations} numbered names (unique), ${stats.statements} statements (one per entry` +
		`${stats.multiline > 0 ? `; ${stats.multiline} span multiple lines, valid via prepared run/batch` : ''})`,
);
