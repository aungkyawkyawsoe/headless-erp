import { describe, expect, it } from 'vitest';

import { notificationOf } from './map';

describe('notificationOf', () => {
	it('maps a full row to the card model', () => {
		expect(
			notificationOf({
				id: 'n1',
				title: '📝 ခွင့်လျှောက်လွှာ အသစ်',
				body: 'Aung မှ ခွင့် လျှောက်လွှာ တင်ထားပါသည်။',
				type: 'approval',
				reference_id: 'r1',
				read: 0,
				created_at: '2026-09-20T03:00:00.000Z',
			}),
		).toEqual({
			id: 'n1',
			title: '📝 ခွင့်လျှောက်လွှာ အသစ်',
			body: 'Aung မှ ခွင့် လျှောက်လွှာ တင်ထားပါသည်။',
			kind: 'approval',
			read: false,
			referenceId: 'r1',
			createdAt: '2026-09-20T03:00:00.000Z',
		});
	});

	it('treats read as true for 1 / true / "1" and false for 0 / null', () => {
		expect(notificationOf({ read: 1 }).read).toBe(true);
		expect(notificationOf({ read: true }).read).toBe(true);
		expect(notificationOf({ read: '1' }).read).toBe(true);
		expect(notificationOf({ read: 0 }).read).toBe(false);
		expect(notificationOf({}).read).toBe(false);
	});

	it('defaults an unknown/absent type to info and a missing title to a fallback', () => {
		expect(notificationOf({ type: 'weird' }).kind).toBe('info');
		expect(notificationOf({}).kind).toBe('info');
		expect(notificationOf({ type: 'reminder' }).kind).toBe('reminder');
		expect(notificationOf({}).title).toBe('အသိပေးချက်');
	});

	it('normalizes a non-string body / reference / created_at to safe defaults', () => {
		const model = notificationOf({ id: 5, body: null, reference_id: '', created_at: 123 });
		expect(model.id).toBe('');
		expect(model.body).toBe('');
		expect(model.referenceId).toBeNull();
		expect(model.createdAt).toBeNull();
	});
});
