/**
 * The transport's header contract — the ONE place every authed call funnels through.
 *
 * Regression it pins: `apiFetch` used to spread `opts` AFTER building the header
 * object, and `updateCollectionFields` always passes a `headers` key (an `If-Match`,
 * or literally `undefined`). Either value replaced the whole object, so every schema
 * save from the Collections / App workbench went out WITHOUT `Authorization` → the
 * API answered 401 → the Studio dropped the session and the login screen came back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, apiRead, setUnauthorizedHandler, updateCollectionFields, type FieldDefinition } from './api';

const FIELD: FieldDefinition = { name: 'probe_scratch', type: 'text', label: 'Probe Scratch' };

function okResponse(data: unknown): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

/** The init of the FIRST request a stubbed fetch saw. */
function firstInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
	return fetchMock.mock.calls[0][1] as RequestInit;
}
const headerOf = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

afterEach(() => {
	vi.unstubAllGlobals();
	setUnauthorizedHandler(null);
});

describe('apiFetch — the caller’s headers never drop the session', () => {
	it('keeps the bearer when the caller passes an explicit `headers: undefined`', async () => {
		const fetchMock = vi.fn(async () => okResponse([FIELD]));
		vi.stubGlobal('fetch', fetchMock);

		await updateCollectionFields('tk', 'test', [FIELD]);

		const init = firstInit(fetchMock);
		expect(headerOf(init, 'Authorization')).toBe('Bearer tk');
		expect(headerOf(init, 'Content-Type')).toBe('application/json');
	});

	it('merges If-Match WITH the bearer instead of replacing it', async () => {
		const fetchMock = vi.fn(async () => okResponse([FIELD]));
		vi.stubGlobal('fetch', fetchMock);

		await updateCollectionFields('tk', 'test', [FIELD], undefined, 3);

		const init = firstInit(fetchMock);
		expect(headerOf(init, 'Authorization')).toBe('Bearer tk');
		expect(headerOf(init, 'If-Match')).toBe('"3"');
	});

	it('still lets a caller override a default header', async () => {
		const fetchMock = vi.fn(async () => okResponse({}));
		vi.stubGlobal('fetch', fetchMock);

		await api('tk', '/api/x', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });

		const init = firstInit(fetchMock);
		expect(headerOf(init, 'Content-Type')).toBe('text/plain');
		expect(headerOf(init, 'Authorization')).toBe('Bearer tk');
	});

	it('sends the bearer on a plain read (no opts at all)', async () => {
		const fetchMock = vi.fn(async () => okResponse([]));
		vi.stubGlobal('fetch', fetchMock);

		await apiRead('tk', '/api/collections');

		expect(headerOf(firstInit(fetchMock), 'Authorization')).toBe('Bearer tk');
	});
});
