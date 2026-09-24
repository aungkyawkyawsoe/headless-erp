import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Walk up from a directory until a sentinel file is found.
 * Returns the first parent directory containing the sentinel.
 */
function findRoot(startDir: string, sentinel: string): string {
	let dir = startDir;
	while (true) {
		if (fs.existsSync(path.join(dir, sentinel))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error(`Could not find ${sentinel} from ${startDir}`);
		dir = parent;
	}
}

/** Package root: `packages/cli/` (contains its own `package.json`) */
export const packageRoot = findRoot(__dirname, 'package.json');

/** The CLI's own version, read from packages/cli/package.json (single source of truth). */
export function cliVersion(): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')) as { version?: string };
		return pkg.version || '0.0.0';
	} catch {
		return '0.0.0';
	}
}

/** Monorepo root: `headless/` (contains `pnpm-workspace.yaml`) */
export const monorepoRoot = findRoot(path.dirname(packageRoot), 'pnpm-workspace.yaml');

/**
 * Current project root — the workspace the user is standing in (CWD upward
 * until `pnpm-workspace.yaml`), falling back to the CLI's own monorepo.
 * The CLI operates on the current project (e.g. a `headless init` scaffold),
 * so project-scoped paths must resolve from CWD, not from the CLI package.
 */
export function projectRoot(): string {
	try {
		return findRoot(process.cwd(), 'pnpm-workspace.yaml');
	} catch {
		return monorepoRoot;
	}
}

/**
 * Ensure a directory exists (recursive mkdir -p).
 */
export function ensureDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Write a file, creating parent directories as needed.
 */
export function writeFile(filePath: string, content: string): void {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Write a file containing secrets (tokens, passwords, keys) — created with
 * mode 0600 (owner read/write only). `writeFileSync` mode only applies at
 * creation, so the mode is re-applied after the write to also tighten a
 * pre-existing file that was created with looser permissions.
 */
export function writeSecretFile(filePath: string, content: string): void {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 });
	try {
		fs.chmodSync(filePath, 0o600);
	} catch {
		/* chmod is best-effort (e.g. Windows) */
	}
}

/**
 * Read a file and return its contents, or null if it doesn't exist.
 */
export function readFile(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, 'utf-8');
	} catch {
		return null;
	}
}

/**
 * List directory entries (names only).
 */
export function listDir(dirPath: string): string[] {
	try {
		return fs.readdirSync(dirPath);
	} catch {
		return [];
	}
}

/**
 * List directory entries with full stats (directories only).
 */
export function listDirs(dirPath: string): string[] {
	try {
		return fs
			.readdirSync(dirPath, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		return [];
	}
}

/**
 * Read and compile a Handlebars template.
 * Templates are read from the `templates/` directory relative to the package root.
 */
export function readTemplate(name: string): string {
	const templatePath = path.join(packageRoot, 'templates', name);
	return fs.readFileSync(templatePath, 'utf-8');
}

/**
 * Get the absolute path to the API plugins directory.
 *
 * Resolved from the CURRENT project (CWD upward), not from the CLI's own repo,
 * so `plugin create` / `hook:add` scaffold into the user's project — the same
 * behavior getApiDir() already had.
 */
export function getPluginsDir(): string {
	return path.resolve(projectRoot(), 'apps', 'api', 'src', 'plugins');
}

/**
 * Get the absolute path to the API workers directory.
 */
export function getWorkersDir(): string {
	return path.resolve(projectRoot(), 'apps', 'api', 'src', 'workers');
}

/**
 * Get the absolute path to the API app directory.
 */
export function getApiDir(): string {
	return path.resolve(projectRoot(), 'apps', 'api');
}

/**
 * Get the absolute path to the apps directory.
 */
export function getAppsDir(): string {
	return path.resolve(projectRoot(), 'apps');
}

/**
 * Get the absolute path to a worker app directory.
 */
export function getWorkerAppDir(name: string): string {
	return path.resolve(projectRoot(), 'apps', `${name}-worker`);
}

/**
 * Get the absolute path to the gateway wrangler config.
 */
export function getGatewayWranglerPath(): string {
	return path.resolve(projectRoot(), 'apps', 'api', 'wrangler.jsonc');
}

// ─── Alias exports for wizard ─────────────────────────
// Project-scoped (not the CLI's own repo) so the create wizard targets the
// user's project when run from a scaffolded app.
export const ROOT = projectRoot();
export const PLUGINS_DIR = getPluginsDir();
export const WORKERS_DIR = getWorkersDir();

/** Read a manifest from a plugin directory (if exists). Returns null if not found. */
function readManifest(pluginDir: string): { name?: string; description?: string; workerGroup?: string } | null {
	const manifestPath = path.join(pluginDir, 'manifest.ts');
	const content = readFile(manifestPath);
	if (!content) return null;
	const m: Record<string, string> = {};
	const nameM = content.match(/name:\s*'([^']+)'/);
	const descM = content.match(/description:\s*'([^']+)'/);
	const groupM = content.match(/workerGroup:\s*'([^']+)'/);
	if (nameM) m.name = nameM[1];
	if (descM) m.description = descM[1];
	if (groupM) m.workerGroup = groupM[1];
	return Object.keys(m).length > 0 ? m : null;
}

/** List all plugins with their manifest info */
export function listPlugins(): Array<{ id: string; name?: string; group?: string }> {
	const dirs = listDir(PLUGINS_DIR);
	return dirs.map((id) => {
		const manifest = readManifest(path.join(PLUGINS_DIR, id));
		return { id, name: manifest?.name, group: manifest?.workerGroup || 'gateway' };
	});
}

/**
 * Discover all plugin manifests with full details.
 * Returns an array of plugin info objects.
 */
export interface PluginInfo {
	id: string;
	name: string;
	description: string;
	workerGroup: string;
	hasManifest: boolean;
}

export function discoverPlugins(): PluginInfo[] {
	const dirs = listDir(PLUGINS_DIR);
	return dirs
		.filter((dir) => fs.existsSync(path.join(PLUGINS_DIR, dir, 'manifest.ts')))
		.map((dir) => {
			const manifest = readManifest(path.join(PLUGINS_DIR, dir));
			return {
				id: dir,
				name: manifest?.name ?? dir,
				description: manifest?.description ?? '',
				workerGroup: manifest?.workerGroup ?? 'gateway',
				hasManifest: true,
			};
		});
}

/**
 * List all worker apps under apps/ matching *-worker pattern.
 */
export function listWorkerApps(): string[] {
	const appsDir = getAppsDir();
	const dirs = listDirs(appsDir);
	return dirs.filter((d) => d.endsWith('-worker'));
}

/**
 * Auto-assign the next available worker port starting from 8788.
 *
 * Scans every worker app under apps/ (both `<name>-worker` and the
 * `plugin-<id>` module convention) for a declared port — from wrangler.jsonc
 * (`"port"`) or a `wrangler dev --port N` dev script — and returns the first
 * free port.
 */
export function getNextWorkerPort(): number {
	const appsDir = getAppsDir();
	const workerDirs = listDirs(appsDir).filter((d) => d.endsWith('-worker') || d.startsWith('plugin-'));
	const usedPorts = new Set<number>();
	for (const dir of workerDirs) {
		const dirPath = path.join(appsDir, dir);
		const wranglerContent = readFile(path.join(dirPath, 'wrangler.jsonc'));
		if (wranglerContent) {
			const portMatch = wranglerContent.match(/"port"\s*:\s*(\d+)/);
			if (portMatch) usedPorts.add(Number(portMatch[1]));
		}
		const pkgContent = readFile(path.join(dirPath, 'package.json'));
		if (pkgContent) {
			const devPortMatch = pkgContent.match(/"dev"\s*:\s*"[^"]*--port\s+(\d+)/);
			if (devPortMatch) usedPorts.add(Number(devPortMatch[1]));
		}
	}
	// Default first port is 8788 (the API worker itself is pinned to 8788)
	for (let port = 8788; port < 8800; port++) {
		if (!usedPorts.has(port)) return port;
	}
	return 8800 + workerDirs.length;
}

/**
 * Copy a directory recursively.
 */
export function copyDir(src: string, dest: string): void {
	ensureDir(dest);
	const entries = fs.readdirSync(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDir(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

// ─── Register Handlebars helpers ──────────────────────

import Handlebars from 'handlebars';

/** {{upperCase "finance"}} → "FINANCE" */
Handlebars.registerHelper('upperCase', function (str: string) {
	if (typeof str !== 'string') return '';
	return str.toUpperCase();
});

/** {{pluginFactory "my-plugin"}} → "myPluginPlugin" (valid identifier) */
Handlebars.registerHelper('pluginFactory', function (str: string) {
	if (typeof str !== 'string') return '';
	return str.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase()) + 'Plugin';
});

/** {{kebabToPascal "my-feature"}} → "MyFeature" */
Handlebars.registerHelper('kebabToPascal', function (str: string) {
	if (typeof str !== 'string') return '';
	return str
		.split('-')
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join('');
});

/** {{lookup obj key}} — dictionary lookup */
Handlebars.registerHelper('lookup', function (obj: Record<string, string>, key: string) {
	return obj?.[key] ?? '';
});
