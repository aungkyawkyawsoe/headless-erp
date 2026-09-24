import { describe, expect, it } from 'vitest';

import { canAdminister, canReadCollection, isAdmin, type CapabilitySubject } from './capabilities';

const admin: CapabilitySubject = { is_admin: true };
const open: CapabilitySubject = { is_admin: false, granted_collections: '*' };
const unknown: CapabilitySubject = { is_admin: false };
const scoped: CapabilitySubject = { is_admin: false, granted_collections: ['orders', 'customers'] };

describe('capabilities', () => {
	it('isAdmin only for is_admin === true', () => {
		expect(isAdmin(admin)).toBe(true);
		expect(isAdmin(open)).toBe(false);
		expect(isAdmin(null)).toBe(false);
		expect(isAdmin(undefined)).toBe(false);
	});

	it('canAdminister mirrors isAdmin', () => {
		expect(canAdminister(admin)).toBe(true);
		expect(canAdminister(scoped)).toBe(false);
	});

	it('canReadCollection: admin + wildcard + unknown pass; a list is exact', () => {
		expect(canReadCollection(admin, 'anything')).toBe(true);
		expect(canReadCollection(open, 'anything')).toBe(true);
		expect(canReadCollection(unknown, 'anything')).toBe(true); // unknown ⇒ do not over-hide
		expect(canReadCollection(scoped, 'orders')).toBe(true);
		expect(canReadCollection(scoped, 'secrets')).toBe(false);
	});

	it('an unresolved subject denies (API is the real gate)', () => {
		expect(canReadCollection(null, 'orders')).toBe(false);
		expect(canReadCollection(undefined, 'orders')).toBe(false);
	});
});
