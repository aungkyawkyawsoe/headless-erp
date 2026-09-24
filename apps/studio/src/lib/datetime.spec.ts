import { describe, expect, it } from 'vitest';
import { epochOf, formatDatetimeMmt, mmtDateOf, mmtTimeOf, toUtcDatetime } from './datetime';

describe('epochOf', () => {
	it('parses ISO-8601 with an explicit Z', () => {
		expect(epochOf('2026-09-23T04:30:00.000Z')).toBe(Date.parse('2026-09-23T04:30:00.000Z'));
	});
	it('parses SQLite CURRENT_TIMESTAMP (UTC, no zone marker) as UTC', () => {
		expect(epochOf('2026-09-23 04:30:00')).toBe(Date.parse('2026-09-23T04:30:00Z'));
	});
	it('parses an unzoned T shape as UTC (the engine stores verbatim)', () => {
		expect(epochOf('2026-09-23T04:30')).toBe(Date.parse('2026-09-23T04:30:00Z'));
		expect(epochOf('2026-09-23T04:30:00')).toBe(Date.parse('2026-09-23T04:30:00Z'));
	});
	it('returns NaN for unparsable text', () => {
		expect(Number.isNaN(epochOf('not-a-date'))).toBe(true);
	});
});

describe('formatDatetimeMmt', () => {
	it('shifts a UTC instant to Myanmar time (UTC+6:30), minute precision', () => {
		expect(formatDatetimeMmt('2026-09-23T04:30:00.000Z')).toBe('2026-09-23 11:00');
	});
	it('rolls the MMT calendar day forward past 17:30 UTC', () => {
		expect(formatDatetimeMmt('2026-09-23T18:30:00Z')).toBe('2026-09-24 01:00');
	});
	it('reads the SQLite CURRENT_TIMESTAMP shape as the same instant', () => {
		expect(formatDatetimeMmt('2026-09-23 04:30:00')).toBe('2026-09-23 11:00');
	});
	it('reads the unzoned T shape as the same instant', () => {
		expect(formatDatetimeMmt('2026-09-23T04:30')).toBe('2026-09-23 11:00');
	});
	it('renders empty values as an em-dash', () => {
		expect(formatDatetimeMmt(null)).toBe('—');
		expect(formatDatetimeMmt(undefined)).toBe('—');
		expect(formatDatetimeMmt('')).toBe('—');
	});
	it('falls back to the raw text for unparsable values, never blanking a row', () => {
		expect(formatDatetimeMmt('odd-value')).toBe('odd-value');
	});
});

describe('mmtDateOf / mmtTimeOf (the edit path)', () => {
	it('yields the MMT calendar day as a local-midnight Date', () => {
		const d = mmtDateOf('2026-09-23T18:30:00Z');
		expect(d).toBeDefined();
		expect(d?.getFullYear()).toBe(2026);
		expect(d?.getMonth()).toBe(8); // September
		expect(d?.getDate()).toBe(24); // rolls forward past 17:30 UTC
	});
	it('yields the MMT HH:MM the TimePicker edits', () => {
		expect(mmtTimeOf('2026-09-23T04:30:00.000Z')).toBe('11:00');
		expect(mmtTimeOf('2026-09-23T18:30:00Z')).toBe('01:00');
	});
	it('is empty/undefined for blank values', () => {
		expect(mmtDateOf(null)).toBeUndefined();
		expect(mmtDateOf('')).toBeUndefined();
		expect(mmtDateOf('garbage')).toBeUndefined();
		expect(mmtTimeOf(null)).toBe('');
		expect(mmtTimeOf('garbage')).toBe('');
	});
});

describe('toUtcDatetime (the write path)', () => {
	it('stores an MMT calendar day + clock time as the UTC ISO instant', () => {
		expect(toUtcDatetime('2026-09-23', '11:00')).toBe('2026-09-23T04:30:00.000Z');
		expect(toUtcDatetime('2026-09-24', '01:00')).toBe('2026-09-23T18:30:00.000Z');
	});
	it('round-trips: what the operator picked is exactly what the cell shows', () => {
		const stored = toUtcDatetime('2026-09-23', '11:00');
		expect(formatDatetimeMmt(stored)).toBe('2026-09-23 11:00');
	});
});
