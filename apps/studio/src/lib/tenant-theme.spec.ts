import { describe, expect, it } from 'vitest';

import { tokensToCssVars } from './tenant-theme';

describe('tokensToCssVars', () => {
	it('keeps --custom-property keys verbatim', () => {
		expect(tokensToCssVars({ '--mmbix-primary': '#2563eb' })).toEqual({ '--mmbix-primary': '#2563eb' });
	});

	it('prefixes a bare key with --', () => {
		expect(tokensToCssVars({ primary: '#2563eb' })).toEqual({ '--primary': '#2563eb' });
	});

	it('drops blank keys/values and non-string values', () => {
		expect(tokensToCssVars({ '  ': '#fff', empty: '  ', n: 5 as unknown as string, ok: 'red' })).toEqual({ '--ok': 'red' });
	});

	it('tolerates null/undefined', () => {
		expect(tokensToCssVars(null)).toEqual({});
		expect(tokensToCssVars(undefined)).toEqual({});
	});
});
