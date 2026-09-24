// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { InspectSection, TyreDetailBody } from './tyre-detail-body';
import { fetchTyreEvents, recordTyreCheck } from '../data/api';
import type { TyreCardModel, TyreEventLine } from '../data/types';

// The engine writers + the session actor are stubbed: the section's job is to
// PREPARE a reading and refuse an impossible one, not to re-test the API.
vi.mock('../data/api', () => ({
	fetchMountedTyres: vi.fn(async () => []),
	fetchTyreEvents: vi.fn(async () => []),
	freeFitmentTargets: vi.fn(async () => []),
	issueAsset: vi.fn(),
	moveTyrePosition: vi.fn(),
	recordTyreCheck: vi.fn(),
}));
vi.mock('@/modules/attendance/data/api', () => ({
	fetchCurrentEmployee: vi.fn(async () => ({ id: 'emp-1', name: 'Aung Kyaw' })),
}));

// jsdom ships neither, and the modules this file pulls in touch both at import time.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
	}
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function unit(over: Partial<TyreCardModel> & { id: string }): TyreCardModel {
	return {
		kind: 'tyre',
		modelName: 'R268',
		serialNo: 'BR-9902',
		status: 'issued',
		itemNameEn: null,
		itemNameMm: null,
		plateNo: '5S-6467',
		slot: 'steer-l',
		employeeId: null,
		employeeName: null,
		locationLabel: null,
		treadMm: 8,
		psi: null,
		condition: null,
		referenceTreadMm: 14,
		...over,
	};
}

/** The SKU's NEW-tread baseline is 14 mm — the cap every reading is checked against. */
const TYRE = unit({ id: 'w1' });
/** A SKU whose catalog row carries no baseline — nothing to cap against. */
const NO_BASELINE = unit({ id: 'w2', referenceTreadMm: null });

function renderSection(tyre: TyreCardModel = TYRE) {
	const onRecorded = vi.fn();
	render(<InspectSection tyre={tyre} onRecorded={onRecorded} defaultOpen />);
	return onRecorded;
}

const treadField = () => screen.getByLabelText('Measured tread depth in millimetres') as HTMLInputElement;

/** Fill the tread reading and hit the save button. */
function record(tread: string) {
	fireEvent.change(treadField(), { target: { value: tread } });
	fireEvent.click(screen.getByRole('button', { name: /Save reading/ }));
}

describe('InspectSection — a tread check records tread, never pressure', () => {
	it('offers the tread field and NO pressure field', () => {
		renderSection();

		expect(treadField()).toBeTruthy();
		expect(screen.queryByLabelText('Measured pressure in psi')).toBeNull();
		expect(screen.queryByText(/Pressure/)).toBeNull();
	});

	it('saves the measurement through the one engine writer — tread only', async () => {
		vi.mocked(recordTyreCheck).mockResolvedValue({ serialId: 'w1', serial_no: 'BR-9902', event: 'checked', tread_mm: 12 });
		const onRecorded = renderSection();

		record('12');

		await waitFor(() => expect(recordTyreCheck).toHaveBeenCalledTimes(1));
		expect(recordTyreCheck).toHaveBeenCalledWith('w1', { actorId: 'emp-1', treadMm: 12, condition: null, note: undefined });
		await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
	});

	it('a condition grade alone is still a reading — tread is not forced on a grader', async () => {
		vi.mocked(recordTyreCheck).mockResolvedValue({ serialId: 'w1', serial_no: 'BR-9902', event: 'checked', condition: 'good' });
		renderSection();

		fireEvent.change(screen.getByLabelText('Asset condition grade'), { target: { value: 'good' } });
		fireEvent.click(screen.getByRole('button', { name: /Save reading/ }));

		await waitFor(() => expect(recordTyreCheck).toHaveBeenCalledTimes(1));
		expect(recordTyreCheck).toHaveBeenCalledWith('w1', { actorId: 'emp-1', treadMm: null, condition: 'good', note: undefined });
	});
});

describe('InspectSection — a tyre can never be thicker than brand new', () => {
	it('caps the field at the SKU baseline and shows the cap', () => {
		renderSection();

		expect(treadField().max).toBe('14');
		expect(screen.getByText('max 14 mm')).toBeTruthy();
	});

	it('refuses a reading above the baseline — and writes nothing', async () => {
		renderSection();

		record('15');

		expect(await screen.findByText(/cannot exceed this tyre's new-tread reading of 14 mm/)).toBeTruthy();
		expect(recordTyreCheck).not.toHaveBeenCalled();
	});

	it('accepts the baseline itself — the cap is a ceiling, not an exclusive bound', async () => {
		vi.mocked(recordTyreCheck).mockResolvedValue({ serialId: 'w1', serial_no: 'BR-9902', event: 'checked', tread_mm: 14 });
		renderSection();

		record('14');

		await waitFor(() => expect(recordTyreCheck).toHaveBeenCalledTimes(1));
		expect(vi.mocked(recordTyreCheck).mock.calls[0][1].treadMm).toBe(14);
	});

	it('leaves the field uncapped when the SKU carries no baseline (nothing to compare against)', async () => {
		vi.mocked(recordTyreCheck).mockResolvedValue({ serialId: 'w2', serial_no: 'BR-9902', event: 'checked', tread_mm: 99 });
		renderSection(NO_BASELINE);

		expect(treadField().max).toBe('');
		expect(screen.queryByText(/^max /)).toBeNull();

		record('99');

		await waitFor(() => expect(recordTyreCheck).toHaveBeenCalledTimes(1));
	});
});

/** ONE already-resolved timeline line — the shape `fetchTyreEvents` produces. */
function line(over: Partial<TyreEventLine> = {}): TyreEventLine {
	return {
		id: 'e1',
		kind: 'issued',
		title: 'ဝန်ထမ်းသို့ပစည်းထုတ်ပေး',
		actor: { name: 'U Hla Tun', photo: null },
		approvedBy: null,
		party: null,
		face: null,
		detail: 'Main store → Ma Ei Mon',
		reference: 'OUT-00002',
		treadMm: null,
		psi: null,
		condition: null,
		effectiveDate: '2026-09-20',
		timestamp: '2026-09-20T09:16:29.434Z',
		...over,
	};
}

function renderBody(events: TyreEventLine[]) {
	vi.mocked(fetchTyreEvents).mockResolvedValue(events);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<TyreDetailBody tyre={TYRE} />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** The rendered text of the ONE paragraph whose content is exactly `text`.
 *  (`getByText` cannot see a `<p>` whose text is split by a child element — the
 *  names line's halves are `<span>`s — so these matchers read `textContent`.) */
const paragraph = (text: string) => screen.queryByText((content) => content === text);

/** One HALF of the card's footer — "Reported by U Hla Tun", "Approved by U Soe
 *  Naing", "Issued to Ma Ei Mon" — a `<span>` whose label and bold name are separate
 *  nodes, so it is matched on the span's own `textContent`. */
const nameChip = (text: string) => screen.queryByText((_content, element) => element?.tagName === 'SPAN' && element.textContent === text);

describe('TyreDetailBody — the timeline card identity and authority', () => {
	it('rides the actor name beside the movement, inside the avatar slot', async () => {
		// NOTE: the PHOTO itself cannot be asserted here — base-ui renders an
		// avatar `<img>` only once it has loaded (never in jsdom), so WHOSE face
		// fills the slot is pinned at the data layer (`data/api.spec.ts`, the
		// `faceOf` rule). What is pinned here is that the leading slot IS an avatar
		// and NOT a bare glyph.
		const { container } = renderBody([
			line({
				actor: { name: 'U Hla Tun', photo: '/api/media/abc.jpg' },
				face: { name: 'U Hla Tun', photo: '/api/media/abc.jpg', monogram: 'UH' },
			}),
		]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(nameChip('Reported by U Hla Tun')).toBeTruthy();
		expect(container.querySelector('[data-slot="avatar"]')).toBeTruthy();
	});

	it('fronts the row with a face even when the ACTOR is photo-less — the approver\u2019s', async () => {
		// The rule the data layer decides and this slot merely renders: a row whose
		// actor has no photo still gets a real face from the approver. The component
		// half is that the slot is fed by `face` rather than by `actor.photo`.
		const { container } = renderBody([
			line({
				actor: { name: 'U Soe Naing', photo: null },
				approvedBy: 'U Hla Tun',
				face: { name: 'U Hla Tun', photo: '/api/media/hla.jpg', monogram: 'UH' },
			}),
		]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(nameChip('Reported by U Soe Naing')).toBeTruthy();
		expect(container.querySelector('[data-slot="avatar"]')).toBeTruthy();
	});

	it('an actor the directory cannot picture shows their MONOGRAM, not the event glyph', async () => {
		// The case that made most real rows show an abstract icon: nobody on the row has
		// a directory photo. The initials still name the person; a glyph would only
		// repeat the title directly above it.
		const { container } = renderBody([line({ face: { name: 'U Hla Tun', photo: null, monogram: 'UH' } })]);

		await screen.findByText('Main store → Ma Ei Mon');
		const fallback = container.querySelector('[data-slot="avatar-fallback"]');
		expect(fallback?.textContent).toContain('UH');
		expect(fallback?.textContent).toContain('U Hla Tun');
		expect(fallback?.querySelector('svg')).toBeNull();
	});

	it('keeps the event glyph only when NOBODY is on the row', async () => {
		const { container } = renderBody([
			line({ kind: 'purchased', title: 'စတိုသို့ရောက်ရှိ', actor: null, detail: 'Main store', face: null }),
		]);

		await screen.findByText('စတိုသို့ရောက်ရှိ');
		expect(container.querySelector('[data-slot="avatar-fallback"]')?.querySelector('svg')).toBeTruthy();
	});

	it('labels EACH person on the card — reporter left, the authority behind it right', async () => {
		renderBody([line({ approvedBy: 'U Soe Naing', party: { label: 'Approved by', name: 'U Soe Naing' } })]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		// The people are no longer appended to the movement text: each carries its own
		// label, so a name can never read as part of the place it moved through. The
		// footer's left half holds both, separated by a middle dot.
		expect(nameChip('Reported by U Hla Tun · Approved by U Soe Naing')).toBeTruthy();
		expect(paragraph('Main store → Ma Ei Mon · U Hla Tun')).toBeNull();
	});

	it('names the person it was HANDED TO when no document approved the move', async () => {
		renderBody([line({ party: { label: 'Issued to', name: 'Ma Ei Mon' } })]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(nameChip('Reported by U Hla Tun · Issued to Ma Ei Mon')).toBeTruthy();
	});

	it('leaves an empty right-hand side EMPTY — no "no approval needed" filler', async () => {
		// The complaint this fixes: a fit or an inspection row printed
		// "No approval needed" on every row that carried no document, which restated
		// what the row's own kind already says and buried the rows that DO carry a
		// name. A row with nobody else on it now states nothing at all.
		renderBody([line({ party: null })]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(nameChip('Reported by U Hla Tun')).toBeTruthy();
		expect(screen.queryByText(/No approval needed/)).toBeNull();
	});

	it('gives every card the SAME three slots — title, its own fact, who is on it', async () => {
		// Cards differ in which facts they carry (a movement has a detail line, an
		// inspection has a reading) and the names slot is often half empty. Reserving
		// both slots is what makes the timeline read as a list instead of a ragged
		// column, so the anatomy is pinned here rather than left to the eye.
		const { container } = renderBody([line({ kind: 'checked', actor: null, detail: '', treadMm: 4.5, condition: 'fair' })]);

		await screen.findByText('Tread 4.5 mm · Fair');
		const card = container.querySelector('li > div');
		// The card is: the dated title <p>, the fact <p>, the footer div — exactly three.
		const bands = card?.querySelectorAll(':scope > div, :scope > p');
		expect(bands?.length).toBe(3);
		const title = card?.querySelector(':scope > p');
		const fact = card?.querySelector(':scope > p.min-h-\\[15px\\]');
		const footer = card?.querySelector(':scope > div.border-t');
		// The effective date leads the title …
		expect(title?.textContent).toContain('20-Sep-2026');
		// … the reading rides the fact slot (where a movement card states its detail) …
		expect(fact?.textContent).toContain('Tread 4.5 mm · Fair');
		// … and the footer is present but carries no names — nobody is on this row — only
		// how long ago it happened.
		expect(footer?.textContent).toMatch(/(just now|ago)/);
		expect(footer?.textContent).not.toContain('Reported by');
	});

	it('the approver outranks the hand-off — ONE other party per row, never two', async () => {
		renderBody([
			line({
				approvedBy: 'U Soe Naing',
				party: { label: 'Approved by', name: 'U Soe Naing' },
			}),
		]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(nameChip('Reported by U Hla Tun · Approved by U Soe Naing')).toBeTruthy();
		expect(nameChip('Issued to Ma Ei Mon')).toBeNull();
	});

	it('a movement nobody approved carries no approval line', async () => {
		renderBody([line()]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(screen.queryByText((_c, element) => /^Approved by/.test(element?.textContent ?? ''))).toBeNull();
	});

	it('states WHEN it took effect — the DATE leads the title, the age sits in the footer', async () => {
		// The card answers "when did this happen" twice: the effective DATE first, right
		// on the title line (an operator scanning the column meets the day before the
		// event names it), and the AGE in the footer for a glance — both measured from
		// the SAME instant, never from the moment the row was written (a receipt booked
		// in today for June stock took effect in June, and reads as June).
		const { container } = renderBody([line({ effectiveDate: '2026-06-05', timestamp: '2026-06-05' })]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(screen.getByText('05-Jun-2026')).toBeTruthy();
		// The date leads the Burmese title on the FIRST line …
		const title = container.querySelector('li > div > p');
		expect(title?.textContent).toContain('05-Jun-2026');
		expect(title?.textContent).toContain('ဝန်ထမ်းသို့ပစည်းထုတ်ပေး');
		// … and the age is the footer's right half, under the hairline, next to the names.
		const footer = container.querySelector('li > div > div.border-t');
		expect(footer?.textContent).toContain('Reported by U Hla Tun');
		expect(footer?.textContent).toMatch(/(just now|\d+ (minute|hour|day|week|month|year)s? ago)/);
		expect(footer?.textContent).not.toContain('05-Jun-2026');
		// … and the card is still exactly the three bands (title, fact, footer).
		expect(container.querySelector('li > div')?.querySelectorAll(':scope > div, :scope > p').length).toBe(3);
	});

	it('carries neither the source document nor the record timestamp', async () => {
		// Trimmed on purpose: a 4-line row (doc no. + full MMT timestamp under every
		// event) buried the facts the row exists to state — when it took effect, who
		// acted, who approved. The document number is still on the wire (`reference` /
		// `created_at`), so a future screen can bring it back without an API change.
		renderBody([line({ reference: 'OUT-00002', effectiveDate: null, timestamp: null })]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(paragraph('OUT-00002')).toBeNull();
		// A row with no effective date at all prints no stamp — never a placeholder.
		expect(screen.queryByText(/^\d{2}-[A-Z][a-z]{2}-\d{4}$/)).toBeNull();
	});

	it('an event with no actor still renders its Burmese title', async () => {
		renderBody([line({ kind: 'purchased', title: 'စတိုသို့ရောက်ရှိ', actor: null, detail: 'Main store', reference: 'INB-00001' })]);

		expect(await screen.findByText('စတိုသို့ရောက်ရှိ')).toBeTruthy();
		expect(paragraph('Main store')).toBeTruthy();
	});

	it('a card nobody is on keeps its footer EMPTY of names — never a placeholder reporter', async () => {
		const { container } = renderBody([line({ actor: null, approvedBy: null, party: null })]);

		expect(await screen.findByText('Main store → Ma Ei Mon')).toBeTruthy();
		expect(container.textContent).not.toContain('Reported by');
		// The footer still occupies its line — that is what keeps the height uniform —
		// carrying only the age (the names half stays empty).
		const footer = container.querySelector('li > div > div.border-t');
		expect(footer?.textContent).toMatch(/(just now|ago)/);
	});
});
