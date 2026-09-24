/**
 * Schema Snapshot Differ — Infrastructure as Code for Data Models
 *
 * Compares two schema snapshots (e.g., dev vs production)
 * and generates a detailed diff with breaking change detection.
 *
 * Use cases:
 *   - CI/CD: PR checks for breaking schema changes
 *   - Release promotion: Dev → Staging → Production
 *   - Audit: Track schema evolution over time
 *
 * Bundle: ~1.5KB
 */

import type { EntitySchema, SchemaSnapshot, SchemaDiff, FieldDiff, FieldDefinition } from '@mmbix/types';

export class SchemaDiffer {
	/**
	 * Diff two schema snapshots.
	 *
	 * @param current - Current (target) schema (e.g., production)
	 * @param incoming - Incoming (source) schema (e.g., dev)
	 * @returns Detailed diff with safety assessment
	 */
	static diff(current: SchemaSnapshot, incoming: SchemaSnapshot): SchemaDiff {
		const currentCols = new Map(current.collections.map((c) => [c.slug, c]));
		const incomingCols = new Map(incoming.collections.map((c) => [c.slug, c]));

		// ── Collections Added ──
		const collectionsAdded = incoming.collections.filter((c) => !currentCols.has(c.slug));

		// ── Collections Removed (BREAKING!) ──
		const collectionsRemoved = current.collections.filter((c) => !incomingCols.has(c.slug)).map((c) => c.slug);

		// ── Collections Modified ──
		const collectionsModified: SchemaDiff['collectionsModified'] = [];
		const breakingChanges: string[] = [];

		for (const [slug, incomingCol] of incomingCols) {
			const currentCol = currentCols.get(slug);
			if (!currentCol) continue; // New collection — handled above

			const changes = this._diffCollection(currentCol, incomingCol);
			if (changes.length > 0) {
				collectionsModified.push({ slug, fieldChanges: changes });

				// Detect breaking changes
				for (const change of changes) {
					if (change.change === 'removed' || change.change === 'type_changed') {
						breakingChanges.push(`${slug}.${change.field}: ${change.change} (was ${change.oldValue}, now ${change.newValue})`);
					}
				}
			}
		}

		// ── Roles ──
		const currentRoles = new Set(current.roles.map((r) => r.name));
		const incomingRoles = new Set(incoming.roles.map((r) => r.name));
		const rolesAdded = incoming.roles.filter((r) => !currentRoles.has(r.name)).map((r) => r.name);
		const rolesRemoved = current.roles.filter((r) => !incomingRoles.has(r.name)).map((r) => r.name);

		// ── Permissions ──
		const permissionsChanged = this._diffPermissions(current.permissions, incoming.permissions);

		// ── Summary ──
		const totalChanges =
			collectionsAdded.length +
			collectionsRemoved.length +
			collectionsModified.reduce((s, c) => s + c.fieldChanges.length, 0) +
			rolesAdded.length +
			rolesRemoved.length +
			permissionsChanged.length;

		return {
			collectionsAdded,
			collectionsRemoved,
			collectionsModified,
			rolesAdded,
			rolesRemoved,
			permissionsChanged,
			summary: {
				totalChanges,
				breakingChanges,
				safeToApply: breakingChanges.length === 0 && collectionsRemoved.length === 0,
			},
		};
	}

	// ── Private ──────────────────────────────────────────

	private static _diffCollection(current: EntitySchema, incoming: EntitySchema): FieldDiff[] {
		const diffs: FieldDiff[] = [];

		const currentFields = this._parseSchema(current.schema_json);
		const incomingFields = this._parseSchema(incoming.schema_json);

		const currentMap = new Map(currentFields.map((f) => [f.name, f]));
		const incomingMap = new Map(incomingFields.map((f) => [f.name, f]));

		// Added fields
		for (const [name, field] of incomingMap) {
			if (!currentMap.has(name)) {
				diffs.push({ field: name, change: 'added', newValue: field.type });
			}
		}

		// Removed fields
		for (const [name, field] of currentMap) {
			if (!incomingMap.has(name)) {
				diffs.push({ field: name, change: 'removed', oldValue: field.type });
			}
		}

		// Modified fields
		for (const [name, incomingField] of incomingMap) {
			const currentField = currentMap.get(name);
			if (!currentField) continue;

			if (currentField.type !== incomingField.type) {
				diffs.push({
					field: name,
					change: 'type_changed',
					oldValue: currentField.type,
					newValue: incomingField.type,
				});
			} else {
				// Check for other modifications (required, index, default, etc.)
				const diff = this._diffField(currentField, incomingField);
				if (diff) diffs.push(diff);
			}
		}

		return diffs;
	}

	private static _diffField(current: FieldDefinition, incoming: FieldDefinition): FieldDiff | null {
		const changes: string[] = [];

		if (current.required !== incoming.required) changes.push(`required: ${current.required} → ${incoming.required}`);
		if (current.index !== incoming.index) changes.push(`index: ${current.index} → ${incoming.index}`);
		if (current.default !== incoming.default) changes.push(`default: ${current.default} → ${incoming.default}`);

		if (changes.length === 0) return null;

		return {
			field: incoming.name,
			change: 'modified',
			oldValue: JSON.stringify(current),
			newValue: JSON.stringify(incoming),
		};
	}

	/**
	 * Parse a collection's schema_json into field definitions.
	 *
	 * Throws on malformed JSON (or a non-array payload): returning [] here would
	 * make the diff look like "all fields removed" and flag spurious breaking
	 * changes / dangerous migrations. An empty array is only ever produced by a
	 * genuinely empty schema.
	 */
	private static _parseSchema(schemaJson: string): FieldDefinition[] {
		let parsed: unknown;
		try {
			parsed = JSON.parse(schemaJson);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			throw new Error(`SchemaDiffer: cannot parse schema_json (${detail}) — aborting diff to avoid a spurious "all fields removed" result`);
		}
		if (!Array.isArray(parsed)) {
			throw new Error('SchemaDiffer: schema_json must be a JSON array of field definitions');
		}
		return parsed as FieldDefinition[];
	}

	private static _diffPermissions(
		current: SchemaSnapshot['permissions'],
		incoming: SchemaSnapshot['permissions'],
	): SchemaDiff['permissionsChanged'] {
		const changes: SchemaDiff['permissionsChanged'] = [];

		const currentMap = new Map(current.map((p) => [`${p.role_id}:${p.collection_slug}`, p]));
		const incomingMap = new Map(incoming.map((p) => [`${p.role_id}:${p.collection_slug}`, p]));

		// New or modified permissions
		for (const [key, incPerm] of incomingMap) {
			const curPerm = currentMap.get(key);
			if (!curPerm) {
				changes.push({
					role_id: incPerm.role_id,
					collection_slug: incPerm.collection_slug,
					changes: ['added'],
				});
			} else {
				const fieldChanges: string[] = [];
				if (curPerm.can_read !== incPerm.can_read) fieldChanges.push('can_read');
				if (curPerm.can_write !== incPerm.can_write) fieldChanges.push('can_write');
				if (curPerm.can_create !== incPerm.can_create) fieldChanges.push('can_create');
				if (curPerm.can_delete !== incPerm.can_delete) fieldChanges.push('can_delete');
				if (curPerm.can_approve !== incPerm.can_approve) fieldChanges.push('can_approve');
				if (curPerm.can_submit !== incPerm.can_submit) fieldChanges.push('can_submit');

				if (fieldChanges.length > 0) {
					changes.push({
						role_id: incPerm.role_id,
						collection_slug: incPerm.collection_slug,
						changes: fieldChanges,
					});
				}
			}
		}

		// Removed permissions
		for (const [key, curPerm] of currentMap) {
			if (!incomingMap.has(key)) {
				changes.push({
					role_id: curPerm.role_id,
					collection_slug: curPerm.collection_slug,
					changes: ['removed'],
				});
			}
		}

		return changes;
	}
}
