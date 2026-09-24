/**
 * DefaultResolver Unit Tests
 */
import { describe, it, expect } from 'vitest';
import { DefaultResolver } from '../defaults';

describe('DefaultResolver', () => {
	// --- Named Variables ---
	it('should resolve $NOW to ISO string', () => {
		const result = DefaultResolver.resolve('$NOW') as string;
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it('should resolve $TODAY to date string', () => {
		const result = DefaultResolver.resolve('$TODAY') as string;
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('should resolve $UUID to UUID v4', () => {
		const result = DefaultResolver.resolve('$UUID') as string;
		expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
	});

	it('should resolve $TIMESTAMP to number', () => {
		const result = DefaultResolver.resolve('$TIMESTAMP') as number;
		expect(typeof result).toBe('number');
		expect(result).toBeGreaterThan(1_700_000_000_000);
	});

	it('should resolve $USER_ID from context', () => {
		const result = DefaultResolver.resolve('$USER_ID', { user_id: 'user-123' });
		expect(result).toBe('user-123');
	});

	it('should resolve $USER_NAME from context', () => {
		const result = DefaultResolver.resolve('$USER_NAME', { user_name: 'John Doe' });
		expect(result).toBe('John Doe');
	});

	it('should resolve $USER_EMAIL from context', () => {
		const result = DefaultResolver.resolve('$USER_EMAIL', { user_email: 'test@example.com' });
		expect(result).toBe('test@example.com');
	});

	it('should resolve $ROLE_ID from context', () => {
		const result = DefaultResolver.resolve('$ROLE_ID', { role_id: 'admin-role' });
		expect(result).toBe('admin-role');
	});

	it('should return null for $USER_ID without context', () => {
		const result = DefaultResolver.resolve('$USER_ID');
		expect(result).toBeNull();
	});

	// --- $CURRENT_USER.field ---
	it('should resolve $CURRENT_USER.field', () => {
		const result = DefaultResolver.resolve('$CURRENT_USER.email', { email: 'test@test.com' });
		expect(result).toBe('test@test.com');
	});

	it('should resolve $CURRENT_USER.role_name', () => {
		const result = DefaultResolver.resolve('$CURRENT_USER.role_name', { role_name: 'Manager' });
		expect(result).toBe('Manager');
	});

	it('should return null for unknown $CURRENT_USER field', () => {
		const result = DefaultResolver.resolve('$CURRENT_USER.unknown_field');
		expect(result).toBeNull();
	});

	// --- Expressions ---
	it('should evaluate simple expression', () => {
		const result = DefaultResolver.resolve('=100 * 2');
		expect(result).toBe(200);
	});

	it('should evaluate expression with context', () => {
		// The expression is evaluated in a scope with ctx spread
		const r2 = DefaultResolver.resolve('=qty * 2', { qty: 5 });
		expect(r2).toBe(10);
	});

	it('should support UUID() in expressions', () => {
		const result = DefaultResolver.resolve('=UUID()') as string;
		expect(result).toMatch(/^[0-9a-f-]+$/i);
	});

	it('should support NOW() in expressions', () => {
		const result = DefaultResolver.resolve('=NOW()') as string;
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('should support Math in expressions', () => {
		const result = DefaultResolver.resolve('=Math.max(10, 20)');
		expect(result).toBe(20);
	});

	it('should return expression string on eval failure', () => {
		const result = DefaultResolver.resolve('=invalid( code');
		expect(result).toBe('=invalid( code');
	});

	// --- Non-string passthrough ---
	it('should passthrough numeric defaults', () => {
		expect(DefaultResolver.resolve(42)).toBe(42);
	});

	it('should passthrough boolean defaults', () => {
		expect(DefaultResolver.resolve(true)).toBe(true);
	});

	it('should passthrough null defaults', () => {
		expect(DefaultResolver.resolve(null)).toBeNull();
	});

	// --- Plain string passthrough ---
	it('should passthrough plain strings', () => {
		expect(DefaultResolver.resolve('hello world')).toBe('hello world');
	});

	// --- resolveAll ---
	it('should resolve defaults for missing fields', () => {
		const data = DefaultResolver.resolveAll(
			[
				{ name: 'id', default: '$UUID' },
				{ name: 'created_at', default: '$NOW' },
				{ name: 'qty', default: 1 },
			],
			{ name: 'Test' },
			{ user_id: 'u1' },
		);

		expect(data.name).toBe('Test'); // provided, not overridden
		expect(data.id).toMatch(/^[0-9a-f-]+$/i); // $UUID resolved
		expect(data.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // $NOW resolved
		expect(data.qty).toBe(1); // numeric default preserved
	});

	it('should not override provided values', () => {
		const data = DefaultResolver.resolveAll([{ name: 'status', default: 'draft' }], { status: 'published' });
		expect(data.status).toBe('published');
	});
});
