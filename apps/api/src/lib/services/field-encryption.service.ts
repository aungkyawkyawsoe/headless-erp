/**
 * Field Encryption Service — Transparent AES-GCM at Field Level
 *
 * Mark any field as encrypted=true in schema, and values are automatically
 * encrypted at rest (in D1) and decrypted on read. Uses Web Crypto API.
 *
 * Key management:
 *   - ENCRYPTION_KEY env var — REQUIRED, exactly 32 bytes as 64 hex chars.
 *     The legacy SECRET_KEY fallback and the passphrase/HKDF derivation path
 *     were REMOVED: a weak shared secret with a fixed salt enabled offline
 *     brute-force of encrypted fields. Without a proper ENCRYPTION_KEY the
 *     service stays disabled (no-op, exactly as when the key was missing).
 *   - Each encrypted value includes the IV (stored together)
 *
 * Format: "v1:base64(iv):base64(ciphertext)"
 *   v1 = version marker for future key rotation
 *   iv = 12-byte random nonce
 *   ciphertext = AES-256-GCM encrypted data
 *
 * Bundle: ~1KB, zero dependencies (Web Crypto API)
 */

const ENCRYPTION_VERSION = 'v1';
const IV_LENGTH = 12; // AES-GCM standard

// ─── Crypto Helpers ─────────────────────────────────────

async function getKey(env: Record<string, unknown>): Promise<CryptoKey> {
	const rawKey = env.ENCRYPTION_KEY as string | undefined;
	if (!rawKey) throw new Error('ENCRYPTION_KEY environment variable is required for field encryption');

	// Strict: exactly 32 bytes expressed as 64 hex chars. Anything else (base64,
	// passphrases, SECRET_KEY) is rejected — a derived key from a weak secret with
	// a fixed salt is offline-brute-forceable, so there is no safe derivation path.
	if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
		throw new Error('ENCRYPTION_KEY must be a 32-byte key as 64 hex characters (generate with: openssl rand -hex 32)');
	}

	const keyBytes = new Uint8Array(rawKey.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
	return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ─── Encryption Service ─────────────────────────────────

export class FieldEncryption {
	private static keyPromise: Promise<CryptoKey> | null = null;

	/** Initialize (call once on cold start) */
	static init(env: Record<string, unknown>): void {
		this.keyPromise = getKey(env);
		// Swallow rejection — missing ENCRYPTION_KEY disables encryption instead of crashing
		this.keyPromise.catch(() => {
			this.keyPromise = null;
		});
	}

	private static async _getKey(): Promise<CryptoKey> {
		if (!this.keyPromise) throw new Error('FieldEncryption not initialized. Call FieldEncryption.init(env) first.');
		return this.keyPromise;
	}

	/**
	 * Encrypt a plaintext value.
	 * Returns format: "v1:base64(iv):base64(ciphertext)"
	 */
	static async encrypt(plaintext: string): Promise<string> {
		if (!plaintext || plaintext === '') return plaintext;

		const key = await this._getKey();
		const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
		const encoded = new TextEncoder().encode(plaintext);

		const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

		const ivB64 = btoa(String.fromCharCode(...iv));
		const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));

		return `${ENCRYPTION_VERSION}:${ivB64}:${ctB64}`;
	}

	/**
	 * Decrypt a ciphertext value.
	 * Accepts format: "v1:base64(iv):base64(ciphertext)"
	 * Returns plaintext on success, original value on failure or if not encrypted.
	 *
	 * On failure the raw ciphertext is returned (fail-open), but a prominent
	 * warning is logged — callers (CollectionService) detect the still-encrypted
	 * marker and never present raw ciphertext as the value.
	 */
	static async decrypt(ciphertext: string): Promise<string> {
		if (!ciphertext || !ciphertext.startsWith(ENCRYPTION_VERSION + ':')) {
			return ciphertext; // Not encrypted or empty
		}

		try {
			const key = await this._getKey();
			const parts = ciphertext.split(':');
			if (parts.length < 3) return ciphertext;

			const iv = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
			const ct = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));

			const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
			return new TextDecoder().decode(decrypted);
		} catch {
			// Fail-open: return the original value, but never silently. A decrypt
			// failure usually means ENCRYPTION_KEY was rotated/missing.
			console.error(
				'[encryption] WARNING: field decrypt failed (missing/rotated ENCRYPTION_KEY?) — value cannot be read; raw ciphertext must not be served as data',
			);
			return ciphertext;
		}
	}

	/**
	 * Check if a value is encrypted (starts with version marker).
	 */
	static isEncrypted(value: string): boolean {
		return typeof value === 'string' && value.startsWith(ENCRYPTION_VERSION + ':');
	}

	/**
	 * Encrypt specific fields in a data object based on schema.
	 * Used before insert/update.
	 */
	static async encryptFields(
		data: Record<string, unknown>,
		fields: Array<{ name: string; encrypted?: boolean }>,
	): Promise<Record<string, unknown>> {
		const result = { ...data };

		for (const field of fields) {
			if (!field.encrypted) continue;
			const val = result[field.name];
			if (typeof val === 'string' && val.length > 0) {
				result[field.name] = await this.encrypt(val);
			}
		}

		return result;
	}

	/**
	 * Decrypt specific fields in a data object based on schema.
	 * Used after select.
	 */
	static async decryptFields(
		data: Record<string, unknown> | null,
		fields: Array<{ name: string; encrypted?: boolean }>,
	): Promise<Record<string, unknown> | null> {
		if (!data) return data;

		const result = { ...data };

		for (const field of fields) {
			if (!field.encrypted) continue;
			const val = result[field.name];
			if (typeof val === 'string' && this.isEncrypted(val)) {
				result[field.name] = await this.decrypt(val);
			}
		}

		return result;
	}

	/**
	 * Bulk decrypt — for list responses.
	 */
	static async decryptBulk(
		items: Record<string, unknown>[],
		fields: Array<{ name: string; encrypted?: boolean }>,
	): Promise<Record<string, unknown>[]> {
		const encryptedFields = fields.filter((f) => f.encrypted);
		if (encryptedFields.length === 0) return items;

		return Promise.all(items.map((item) => this.decryptFields(item, fields).then((r) => r!)));
	}
}
