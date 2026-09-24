import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Types ───────────────────────────────────────────────

export interface ProfileConfig {
	apiUrl: string;
	authToken?: string;
	description?: string;
}

export interface HeadlessConfig {
	apiUrl?: string;
	authToken?: string;
	profile?: string;
	profiles?: Record<string, ProfileConfig>;
}

// ── Helpers ─────────────────────────────────────────────

function projectConfigPath(): string {
	return path.resolve('.headlessrc');
}

function userConfigPath(): string {
	return path.join(os.homedir(), '.headlessrc');
}

function readJsonFile(filePath: string): HeadlessConfig | null {
	try {
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw) as HeadlessConfig;
	} catch {
		return null;
	}
}

function writeJsonFile(filePath: string, data: HeadlessConfig): void {
	// Config may embed an auth token — write owner-only (0600) and re-apply the
	// mode after the write in case the file pre-existed with looser permissions.
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
	try {
		fs.chmodSync(filePath, 0o600);
	} catch {
		/* chmod is best-effort (e.g. Windows) */
	}
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: T): T {
	const result: Record<string, unknown> = { ...base };
	for (const key of Object.keys(override)) {
		const ov = override[key];
		const bv = result[key];
		if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
			result[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
		} else {
			result[key] = ov;
		}
	}
	return result as T;
}

// ── Config Loading ──────────────────────────────────────

/**
 * Read config from: env (MMBIX_API_URL / HEADLESS_API_URL) > cwd/.headlessrc > ~/.headlessrc (merged).
 * Project-level config takes precedence over user-level config; the env
 * vars override both, matching the documented resolution order.
 */
export function loadConfig(): HeadlessConfig {
	const userCfg = readJsonFile(userConfigPath());
	const projectCfg = readJsonFile(projectConfigPath());

	let merged: HeadlessConfig;
	if (!userCfg && !projectCfg) {
		merged = {};
	} else if (userCfg && !projectCfg) {
		merged = userCfg;
	} else if (projectCfg && !userCfg) {
		merged = projectCfg;
	} else {
		// Both exist — merge: project overrides user
		merged = deepMerge(
			userCfg as unknown as Record<string, unknown>,
			projectCfg as unknown as Record<string, unknown>,
		) as unknown as HeadlessConfig;
	}

	// Environment override wins over every file (HEADLESS_API_URL documented
	// as the top of the resolution order; MMBIX_API_URL is the legacy alias).
	const envUrl = process.env.HEADLESS_API_URL || process.env.MMBIX_API_URL;
	if (envUrl) merged.apiUrl = envUrl;

	return merged;
}

/**
 * Save config to the project-level .headlessrc (cwd).
 */
export function saveConfig(config: HeadlessConfig): void {
	writeJsonFile(projectConfigPath(), config);
}

/**
 * Get the active profile from config, resolving defaults.
 * Returns a ProfileConfig with sensible defaults applied.
 * Env overrides (HEADLESS_API_URL / MMBIX_API_URL) win over every file level.
 */
export function getCurrentProfile(config: HeadlessConfig): ProfileConfig {
	const envUrl = process.env.HEADLESS_API_URL || process.env.MMBIX_API_URL;
	const profileName = config.profile || 'default';
	const profiles = config.profiles || {};

	const profile = profiles[profileName] || {};

	return {
		apiUrl: envUrl || profile.apiUrl || config.apiUrl || 'http://localhost:8788',
		authToken: profile.authToken || config.authToken || undefined,
		description: profile.description || undefined,
	};
}
