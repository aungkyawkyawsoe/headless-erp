// @vitest-environment jsdom
/**
 * PolicyPanel — the Studio's runtime-policy control plane, driven through a
 * real DOM.
 *
 * This is the half `policy-form.spec.ts` cannot cover: that the switches the
 * operator actually clicks load the stored policy, and that Save PUTs the body
 * the API expects. The mapping itself is unit-tested separately.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../lib/api', () => ({
	getCollectionDetail: vi.fn(),
	getCollectionPolicies: vi.fn(),
	setCollectionPolicies: vi.fn(),
}));

import { getCollectionDetail, getCollectionPolicies, setCollectionPolicies } from '../lib/api';
import PolicyPanel from './PolicyPanel';

const mockDetail = vi.mocked(getCollectionDetail) as unknown as Mock;
const mockGetPolicies = vi.mocked(getCollectionPolicies) as unknown as Mock;
const mockSetPolicies = vi.mocked(setCollectionPolicies) as unknown as Mock;

/** The panel now reads its schema through Query, so every render needs a client. */
function renderWithClient(ui: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
	return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Route the policy read + write through their typed API functions. */
function mockPolicies(policy: unknown, opts: { putFails?: boolean } = {}) {
	mockGetPolicies.mockResolvedValue(policy as never);
	mockSetPolicies.mockImplementation((() =>
		opts.putFails ? Promise.reject(new Error('Collection not found')) : Promise.resolve(policy as never)) as never);
}

function mockSchema(fields: Array<{ encrypted?: boolean }> = []) {
	mockDetail.mockResolvedValue({ schema_json: { fields } } as never);
}

function putCalls() {
	return mockSetPolicies.mock.calls;
}

function lastPut() {
	const calls = putCalls();
	const [_token, slug, body] = calls[calls.length - 1] as [string, string, Record<string, unknown>];
	return { path: `/api/collections/${slug}/policies`, body };
}

const offlineSwitch = () => screen.getByRole('switch', { name: 'Offline reads' });
const offlineMaxAge = () => screen.getByLabelText('Offline max age seconds') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save policies/i });
const saveDisabled = () => (saveButton() as HTMLButtonElement).disabled;

/** The Save button is disabled until the policy GET resolves. */
async function renderLoaded() {
	const view = renderWithClient(<PolicyPanel token="tk" slug="items" />);
	await waitFor(() => expect(saveDisabled()).toBe(false));
	return view;
}

beforeEach(() => {
	mockDetail.mockReset();
	mockGetPolicies.mockReset();
	mockSetPolicies.mockReset();
	mockSchema();
});

afterEach(() => cleanup());

describe('PolicyPanel — loading the stored policy', () => {
	it('shows the engine defaults for a collection with no policy', async () => {
		mockPolicies({});
		await renderLoaded();

		expect(offlineSwitch().getAttribute('aria-checked')).toBe('false');
		expect(offlineMaxAge().value).toBe('86400');
		expect((screen.getByLabelText('Cache TTL seconds') as HTMLInputElement).value).toBe('60');
		expect(screen.getByRole('switch', { name: 'Self-tuning indexes' }).getAttribute('aria-checked')).toBe('true');
	});

	it('reflects an enabled offline-reads policy from the API', async () => {
		mockPolicies({ offline_reads: { enabled: true, max_age_s: 3600 }, cache: { enabled: false, ttl_s: 300 } });
		await renderLoaded();

		expect(offlineSwitch().getAttribute('aria-checked')).toBe('true');
		expect(offlineMaxAge().value).toBe('3600');
		expect(screen.getByRole('switch', { name: 'Response cache' }).getAttribute('aria-checked')).toBe('false');
	});
});

describe('PolicyPanel — toggling and saving', () => {
	it('PUTs the checked offline-reads switch to the collection policy endpoint', async () => {
		mockPolicies({});
		await renderLoaded();

		fireEvent.click(offlineSwitch());
		expect(offlineSwitch().getAttribute('aria-checked')).toBe('true');

		fireEvent.click(saveButton());

		await waitFor(() => expect(putCalls()).toHaveLength(1));
		const { path, body } = lastPut();
		expect(path).toBe('/api/collections/items/policies');
		expect(body.offline_reads).toEqual({ enabled: true, max_age_s: 86_400 });
		// One save writes all three features (the API merges per feature).
		expect(body.auto_index).toEqual({ enabled: true, mode: 'auto' });
		expect(body.cache).toEqual({ enabled: true, ttl_s: 60 });
	});

	it('can turn offline reads back OFF (the toggle is reversible, not one-way)', async () => {
		mockPolicies({ offline_reads: { enabled: true, max_age_s: 120 } });
		await renderLoaded();

		fireEvent.click(offlineSwitch());
		expect(offlineSwitch().getAttribute('aria-checked')).toBe('false');

		fireEvent.click(saveButton());
		await waitFor(() => expect(putCalls()).toHaveLength(1));
		expect(lastPut().body.offline_reads).toEqual({ enabled: false, max_age_s: 120 });
	});

	it('repairs an emptied max-age field instead of sending a value the API rejects', async () => {
		mockPolicies({ offline_reads: { enabled: true, max_age_s: 3600 } });
		await renderLoaded();

		fireEvent.change(offlineMaxAge(), { target: { value: '' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(putCalls()).toHaveLength(1));
		expect(lastPut().body.offline_reads).toEqual({ enabled: true, max_age_s: 1 });
	});

	it('reports success and notifies the parent so the schema refreshes', async () => {
		mockPolicies({});
		const onSaved = vi.fn();
		renderWithClient(<PolicyPanel token="tk" slug="items" onSaved={onSaved} />);
		await waitFor(() => expect(saveDisabled()).toBe(false));

		fireEvent.click(saveButton());

		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
		expect(await screen.findByText(/applied at runtime/i)).toBeTruthy();
	});

	it('surfaces a failed save instead of pretending it worked', async () => {
		mockPolicies({}, { putFails: true });
		const onSaved = vi.fn();
		renderWithClient(<PolicyPanel token="tk" slug="items" onSaved={onSaved} />);
		await waitFor(() => expect(saveDisabled()).toBe(false));

		fireEvent.click(saveButton());

		expect(await screen.findByText('Collection not found')).toBeTruthy();
		expect(onSaved).not.toHaveBeenCalled();
		expect(screen.queryByText(/applied at runtime/i)).toBeNull();
	});
});

describe('PolicyPanel — encrypted-field warning', () => {
	it('warns only once offline reads are switched on for an encrypted collection', async () => {
		mockPolicies({});
		mockSchema([{ encrypted: true }, { encrypted: true }, { encrypted: false }]);
		await renderLoaded();

		expect(screen.queryByRole('alert')).toBeNull();

		fireEvent.click(offlineSwitch());

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/2 encrypted fields/);
	});

	it('stays quiet for a collection with nothing encrypted', async () => {
		mockPolicies({});
		mockSchema([{ encrypted: false }, {}]);
		await renderLoaded();

		fireEvent.click(offlineSwitch());

		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('reads the warning signal from a PASSED schema without a second collection read', async () => {
		mockPolicies({});
		mockSchema([{ encrypted: true }]);
		const schema = { schema_json: { fields: [{ encrypted: true }, { encrypted: true }] } } as never;

		renderWithClient(<PolicyPanel token="tk" slug="items" schema={schema} />);
		await waitFor(() => expect(saveDisabled()).toBe(false));

		fireEvent.click(offlineSwitch());

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/2 encrypted fields/);
		// The parent already held the schema — the panel must not re-read it.
		expect(mockDetail).not.toHaveBeenCalled();
	});
});
