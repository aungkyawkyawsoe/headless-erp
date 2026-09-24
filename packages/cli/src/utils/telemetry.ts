import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { debug } from './format.js';

// ── Types ───────────────────────────────────────────────

export interface TelemetryEvent {
	command: string;
	timestamp: string;
	version: string;
	os: string;
	nodeVersion: string;
	durationMs?: number;
	errorType?: string;
	flags?: string[]; // flag NAMES only, never values
}

interface TelemetryConfig {
	enabled: boolean;
	apiUrl?: string;
}

// ── Paths ───────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.headless_telemetry_config.json');
const EVENTS_PATH = path.join(os.homedir(), '.headless_telemetry.json');

// ── Module State ────────────────────────────────────────

let _enabled = false;
let _apiUrl: string | undefined;
let _version = '0.0.0';
let _events: TelemetryEvent[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _dirty = false;

// ── Config Persistence ──────────────────────────────────

function readConfig(): TelemetryConfig {
	try {
		const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
		return JSON.parse(raw) as TelemetryConfig;
	} catch {
		return { enabled: false };
	}
}

function saveConfig(config: TelemetryConfig): void {
	try {
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
	} catch {
		// Silently ignore write failures (e.g. read-only filesystem)
	}
}

// ── Event Persistence ───────────────────────────────────

function loadEvents(): TelemetryEvent[] {
	try {
		const raw = fs.readFileSync(EVENTS_PATH, 'utf-8');
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Flush events to disk — debounced to avoid hammering the filesystem. */
function flushEvents(): void {
	if (_flushTimer) clearTimeout(_flushTimer);
	_flushTimer = setTimeout(() => {
		if (!_dirty) return;
		_dirty = false;
		try {
			fs.writeFileSync(EVENTS_PATH, JSON.stringify(_events, null, 2) + '\n', 'utf-8');
		} catch {
			// Silently ignore
		}
	}, 500);
}

/** Send a single event to the configured remote endpoint. Fire-and-forget. */
function sendEvent(event: TelemetryEvent): void {
	if (!_apiUrl) return;
	fetch(_apiUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(event),
	}).catch(() => {
		// Silently ignore send failures — telemetry is best-effort
	});
}

// ── Event Builder ───────────────────────────────────────

function buildEvent(command: string): TelemetryEvent {
	return {
		command,
		timestamp: new Date().toISOString(),
		version: _version,
		os: `${os.platform()} ${os.release()}`,
		nodeVersion: process.version,
	};
}

function addEvent(event: TelemetryEvent): void {
	if (!_enabled) return;
	_events.push(event);
	_dirty = true;
	flushEvents();
	sendEvent(event);
}

// ── Public API ──────────────────────────────────────────

/**
 * Initialize telemetry. Called once on CLI startup.
 *
 * @param enabled  Whether telemetry is enabled (from explicit flags or persisted config).
 *                 When `undefined`, falls back to the persisted config on disk.
 * @param apiUrl   Optional remote endpoint to send events to. Defaults to null (local-only).
 * @param version  CLI version string (e.g. from package.json).
 */
export function initTelemetry(enabled?: boolean, apiUrl?: string, version?: string): void {
	if (version) _version = version;

	const persisted = readConfig();

	// Explicit flag takes precedence over persisted config
	if (enabled !== undefined) {
		_enabled = enabled;
		if (enabled !== persisted.enabled) {
			persisted.enabled = enabled;
			saveConfig(persisted);
		}
	} else {
		_enabled = persisted.enabled;
	}

	_apiUrl = apiUrl || persisted.apiUrl;
	_events = loadEvents();

	debug(`Telemetry: ${_enabled ? 'enabled' : 'disabled'}${_apiUrl ? ` → ${_apiUrl}` : ' (local only)'}`);
}

/**
 * Track a CLI command invocation.
 *
 * Only flag **names** are recorded — flag **values** are NEVER collected.
 */
export function trackCommand(command: string, flags: Record<string, unknown>): void {
	if (!_enabled) return;
	const event = buildEvent(command);
	event.flags = Object.keys(flags).filter((k) => k !== 'telemetry' && k !== 'noTelemetry');
	if (event.flags.length === 0) delete event.flags;
	addEvent(event);
}

/** Get aggregate telemetry statistics (local events only). */
export function getTelemetryStats(): { totalEvents: number; commands: Record<string, number> } {
	const commands: Record<string, number> = {};
	for (const event of _events) {
		commands[event.command] = (commands[event.command] || 0) + 1;
	}
	return { totalEvents: _events.length, commands };
}

/** Enable telemetry and persist the preference. */
export function enableTelemetry(apiUrl?: string): void {
	_enabled = true;
	if (apiUrl) _apiUrl = apiUrl;
	saveConfig({ enabled: true, apiUrl: _apiUrl });
}

/** Disable telemetry and persist the preference. */
export function disableTelemetry(): void {
	_enabled = false;
	saveConfig({ enabled: false, apiUrl: _apiUrl });
}

/** Check whether telemetry is currently enabled. */
export function isTelemetryEnabled(): boolean {
	return _enabled;
}

/** Get the privacy notice shown to users when first enabling telemetry. */
export function getPrivacyNotice(): string {
	return [
		'',
		'📊 Telemetry Privacy Notice',
		'─────────────────────────────',
		'When enabled, telemetry collects ONLY:',
		'  • Command name (e.g. "dev", "plugin create")',
		'  • Timestamp',
		'  • CLI version',
		'  • OS platform & release',
		'  • Node.js version',
		'  • Flag names used (never flag values)',
		'  • Error type (never stack traces or messages)',
		'  • Command duration',
		'',
		'We NEVER collect:',
		'  • Personal data or credentials',
		'  • SQL queries, database contents, or collection names',
		'  • Auth tokens',
		'  • File paths or environment variables',
		'  • Flag values',
		'',
		'Data is stored locally at ~/.headless_telemetry.json',
		'and is only sent if you configure a telemetry endpoint.',
		'',
		'To disable: headless config telemetry off',
		'',
	].join('\n');
}
