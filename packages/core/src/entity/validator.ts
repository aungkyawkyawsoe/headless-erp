/**
 * Field Validator — Expression-Based Validation Engine
 *
 * Validates field values against rules declared in schema.
 * Rules are pure JSON — no code needed for business validation.
 *
 * Bundle: ~1KB, zero dependencies
 */

import { evaluateBoolean } from './expression';
import { EMAIL_RE } from '@mmbix/utils';
import type { ValidationRule } from '@mmbix/types';

// ─── Types ───────────────────────────────────────────────
// `ValidationRule` is canonical in @mmbix/types — this module ENFORCES it at
// runtime but never re-declares it (single source of truth).

export type { ValidationRule };

export interface ValidationError {
	field: string;
	message: string;
	rule?: string;
}

// ─── Validator ───────────────────────────────────────────

export class FieldValidator {
	/**
	 * Validate a single field value against its rules.
	 * @param fieldName - Field name (for error messages)
	 * @param value - The value to validate
	 * @param rules - Validation rules from schema
	 * @param allData - All field data (for cross-field rules like required_if, expression)
	 * @returns Array of validation errors (empty = valid)
	 */
	static validateField(
		fieldName: string,
		value: unknown,
		rules: ValidationRule[],
		allData: Record<string, unknown> = {},
	): ValidationError[] {
		const errors: ValidationError[] = [];

		for (const rule of rules) {
			const err = this._checkRule(fieldName, rule, value, allData);
			if (err) errors.push(err);
		}

		return errors;
	}

	/**
	 * Validate all fields in a data object against a schema.
	 * @param fields - Field definitions with optional validation rules
	 * @param data - The data to validate
	 * @returns Array of validation errors (empty = valid)
	 */
	static validateAll(fields: Array<{ name: string; validation?: ValidationRule[] }>, data: Record<string, unknown>): ValidationError[] {
		const errors: ValidationError[] = [];

		for (const field of fields) {
			if (!field.validation || field.validation.length === 0) continue;
			const value = data[field.name];
			const fieldErrors = this.validateField(field.name, value, field.validation, data);
			errors.push(...fieldErrors);
		}

		return errors;
	}

	/** Check if there are ANY errors */
	static isValid(errors: ValidationError[]): boolean {
		return errors.length === 0;
	}

	/** Format errors into a human-readable message */
	static formatErrors(errors: ValidationError[]): string {
		return errors.map((e) => `"${e.field}": ${e.message}`).join('; ');
	}

	// ── Private ──────────────────────────────────────────

	private static _checkRule(
		fieldName: string,
		rule: ValidationRule,
		value: unknown,
		allData: Record<string, unknown>,
	): ValidationError | null {
		const msg = (defaultMsg: string) => rule.message || defaultMsg;

		switch (rule.type) {
			case 'required': {
				if (value === undefined || value === null || value === '') {
					return { field: fieldName, message: msg(`${fieldName} is required`), rule: 'required' };
				}
				return null;
			}

			case 'min': {
				if (value === undefined || value === null || value === '') return null; // skip empty — required enforces presence
				const num = Number(value);
				if (isNaN(num) || num < rule.value) {
					return { field: fieldName, message: msg(`${fieldName} must be at least ${rule.value}`), rule: 'min' };
				}
				return null;
			}

			case 'max': {
				if (value === undefined || value === null || value === '') return null; // skip empty — required enforces presence
				const num = Number(value);
				if (isNaN(num) || num > rule.value) {
					return { field: fieldName, message: msg(`${fieldName} must be at most ${rule.value}`), rule: 'max' };
				}
				return null;
			}

			case 'min_length': {
				if (value === undefined || value === null || value === '') return null; // skip empty — required enforces presence
				const str = String(value);
				if (str.length < rule.value) {
					return {
						field: fieldName,
						message: msg(`${fieldName} must be at least ${rule.value} characters`),
						rule: 'min_length',
					};
				}
				return null;
			}

			case 'max_length': {
				if (value === undefined || value === null || value === '') return null; // skip empty — required enforces presence
				const str = String(value);
				if (str.length > rule.value) {
					return {
						field: fieldName,
						message: msg(`${fieldName} must be at most ${rule.value} characters`),
						rule: 'max_length',
					};
				}
				return null;
			}

			case 'regex': {
				const str = String(value ?? '');
				// Skip empty values — presence is enforced by the 'required' rule
				if (str === '') return null;
				try {
					if (!new RegExp(rule.pattern).test(str)) {
						return { field: fieldName, message: msg(`${fieldName} has an invalid format`), rule: 'regex' };
					}
				} catch {
					return { field: fieldName, message: `Invalid regex pattern: ${rule.pattern}`, rule: 'regex' };
				}
				return null;
			}

			case 'email': {
				const str = String(value ?? '');
				// Skip empty values — presence is enforced by the 'required' rule
				if (str === '') return null;
				if (!EMAIL_RE.test(str)) {
					return { field: fieldName, message: msg(`${fieldName} must be a valid email`), rule: 'email' };
				}
				return null;
			}

			case 'url': {
				const str = String(value ?? '');
				// Skip empty values — presence is enforced by the 'required' rule
				if (str === '') return null;
				try {
					new URL(str);
				} catch {
					return { field: fieldName, message: msg(`${fieldName} must be a valid URL`), rule: 'url' };
				}
				return null;
			}

			case 'in': {
				if (rule.values && !rule.values.includes(value)) {
					const list = rule.values.map(String).join(', ');
					return { field: fieldName, message: msg(`${fieldName} must be one of: ${list}`), rule: 'in' };
				}
				return null;
			}

			case 'expression': {
				try {
					// Safe evaluation with value and data in scope (workerd-safe — no new Function)
					const ok = evaluateBoolean(rule.formula, { value, data: allData });
					if (!ok) {
						return { field: fieldName, message: rule.message, rule: 'expression' };
					}
				} catch (err) {
					return {
						field: fieldName,
						message: `Expression error: ${err instanceof Error ? err.message : String(err)}`,
						rule: 'expression',
					};
				}
				return null;
			}

			case 'required_if': {
				const otherVal = allData[rule.field];
				if (otherVal === rule.value) {
					if (value === undefined || value === null || value === '') {
						return {
							field: fieldName,
							message: msg(`${fieldName} is required when ${rule.field} is ${String(rule.value)}`),
							rule: 'required_if',
						};
					}
				}
				return null;
			}

			case 'unique': {
				// Uniqueness is enforced outside this validator: CollectionService
				// runs a DB pre-check (_validateFieldConstraints) AND the column gets
				// a real UNIQUE index (applyFieldDefinitions). The standalone
				// validator has no DB handle, so it reports that the rule requires
				// the DB check rather than silently passing.
				return {
					field: fieldName,
					message: msg(`${fieldName} must be unique — uniqueness is checked against the database`),
					rule: 'unique',
				};
			}

			default:
				return null;
		}
	}
}
