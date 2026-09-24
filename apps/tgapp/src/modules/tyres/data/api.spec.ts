import { afterEach, describe, expect, it, vi } from 'vitest';

import { effectiveAtOf, effectiveDateOf, fetchTyreEvents, freeFitmentTargets, TYRE_EVENT_LABELS } from './api';
import type { VehicleMasterRow } from '@/shared/lookups/types';
import type { TyreCardModel } from './types';

/**
 * The lifecycle timeline's TITLE copy.
 *
 * The store floor reads this timeline to answer "where has this unit been", so the
 * titles are Burmese (the operator's language) while the engine identifier — the
 * canonical `mro_serial_events.event` value — stays one level down. These pin the
 * shipped wording, so reverting a title to English (or inventing a 13th kind with a
 * placeholder label) fails here rather than shipping silently.
 */

const { serialEvents } = vi.hoisted(() => ({ serialEvents: vi.fn() }));

// The data module reaches the engine through the SHARED mro helper and the app-wide
// SDK client; both are stubbed so this spec exercises ONLY the row → line mapping
// (the shared client pulls in auth/offline/localStorage machinery a node run has no
// business booting).
vi.mock('@/shared/mro', () => ({
	mroApi: { serialEvents },
	MRO_LOCATION_LABELS: { main_store: 'Main store' },
}));
vi.mock('@/shared/api/sdk', () => ({ sdk: {} }));

type TyreEventKind = keyof typeof TYRE_EVENT_LABELS;

/** Run ONE raw event row through the real read path (`fetchTyreEvents`). */
async function lineFor(row: Record<string, unknown>) {
	serialEvents.mockResolvedValue({ rows: [row] });
	const [line] = await fetchTyreEvents('serial-1');
	return line;
}

/** The user-supplied wording — the CONTRACT, restated here on purpose: a spec that
 *  asserted `title === TYRE_EVENT_LABELS[kind]` would pass even if the map were
 *  reverted to English. */
const EXPECTED: Record<TyreEventKind, string> = {
	purchased: 'စတိုသို့ရောက်ရှိ',
	returned: 'စတိုသို့ပြန်ပို့',
	issued: 'ဝန်ထမ်းသို့ပစည်းထုတ်ပေး',
	reissued: 'အခြားတစ်ဦးထံ ပစ္စည်းလွဲပြောင်း',
	fitted: 'ပစ္စည်းထုတ်ယူ',
	store_transferred: 'အခြား စတိုသို့ လွဲပြောင်းခြင်း',
	rotated: 'ကားတွင်း နေရာရွှေ့',
	refitted: 'အခြားကားသို့ ပြောင်းရွေ့',
	unseated: 'ကားတွင် ခနဖြုတ်သိမ်း',
	written_off: 'စွန့်ပစ် / ဖျက်သိမ်း',
	adjusted: 'စာရင်းညှိ ပယ်ဖျက်',
	checked: 'တိုင်းတာစစ်ဆေးခြင်း',
};

/** Myanmar script block — the alphabet every shipped title must contain. */
const MYANMAR = /[\u1000-\u109f]/;

afterEach(() => {
	vi.clearAllMocks();
});

describe('fetchTyreEvents — the timeline title is Burmese', () => {
	it('renders each kind with its shipped Burmese label', async () => {
		for (const [kind, expected] of Object.entries(EXPECTED) as [TyreEventKind, string][]) {
			expect(TYRE_EVENT_LABELS[kind]).toBe(expected);
			expect((await lineFor({ id: 'e1', event: kind }))?.title).toBe(expected);
		}
	});

	it('ships NO English title — every label is Myanmar script', () => {
		for (const [kind, label] of Object.entries(TYRE_EVENT_LABELS)) {
			expect(label, `${kind} is not Burmese`).toMatch(MYANMAR);
		}
	});

	it('a seat-less fit is a TRAY placement, not a wheel fit', async () => {
		const tray = await lineFor({ id: 'e1', event: 'fitted', to_vehicle: { id: 'v1', plate_no: '1TLR-8919' } });
		const wheel = await lineFor({ id: 'e2', event: 'fitted', to_vehicle: { id: 'v1', plate_no: '1TLR-8919' }, to_slot: 'drive-l' });

		expect(tray?.title).toBe('ကားတွင် ဖြုတ်သိမ်း');
		expect(wheel?.title).toBe(TYRE_EVENT_LABELS.fitted);
	});

	it('drops an event the module does not know, rather than rendering a blank row', async () => {
		expect(await lineFor({ id: 'e1', event: 'teleported' })).toBeUndefined();
	});
});

/**
 * The AGE every timeline row prints — and the order it sits in — comes from the
 * row's EFFECTIVE date, never from when the row happened to be written. `event_date`
 * is that effective day (the API resolves it for every event); a day alone cannot
 * say when INSIDE the day, so a row whose effective day IS its record day keeps the
 * record time's precision, and a back-dated one ages from its own day.
 */
describe('effectiveAtOf — the timestamp a lifecycle row is aged and ordered by', () => {
	const created = '2026-09-20T11:57:21.687Z';

	it('keeps the minute precision when the effective day IS the record day', () => {
		expect(effectiveAtOf({ event_date: '2026-09-20', created_at: created })).toBe(created);
	});

	it('uses the effective DAY when it differs — a wear dated last month ages from last month', () => {
		expect(effectiveAtOf({ event_date: '2026-08-15', created_at: created })).toBe('2026-08-15');
		expect(effectiveAtOf({ event_date: '2026-08-15', created_at: null })).toBe('2026-08-15');
	});

	it('falls back to the record time for a row with no effective date — never to nothing', () => {
		expect(effectiveAtOf({ event_date: null, created_at: created })).toBe(created);
		expect(effectiveAtOf({ event_date: '   ', created_at: created })).toBe(created);
		expect(effectiveAtOf({ event_date: null, created_at: null })).toBeNull();
	});

	it('a resolved row ages from the effective date it was given (the API always sends one)', async () => {
		const line = await lineFor({ id: 'e1', event: 'checked', event_date: '2026-08-15', created_at: created });
		expect(line?.timestamp).toBe('2026-08-15');
		// …and the same-day case keeps the recorded moment.
		const sameDay = await lineFor({ id: 'e2', event: 'rotated', event_date: '2026-09-20', created_at: created });
		expect(sameDay?.timestamp).toBe(created);
	});
});

/**
 * The DATE a row prints — the day its transition TOOK EFFECT, which the API resolves
 * per event: the operator's back-dated wear day for a fit/un-seat, else the governing
 * document's own date (a receipt's `purchase_date`, an issue's `effective_date`, …),
 * else the day it was recorded. The client only ever reads it — a second, locally
 * derived "date" would let the printed day and the aged day drift apart.
 */
describe('effectiveDateOf — the day a row prints', () => {
	it('prints the effective day the API resolved, not the record day', () => {
		expect(effectiveDateOf({ event_date: '2026-06-05', created_at: '2026-09-20T11:57:21.687Z' })).toBe('2026-06-05');
	});

	it('tolerates a full timestamp on the field rather than printing 10 characters of noise', () => {
		expect(effectiveDateOf({ event_date: '2026-06-05T00:00:00.000Z', created_at: null })).toBe('2026-06-05');
	});

	it('falls back to the record day for a row that predates the field', () => {
		expect(effectiveDateOf({ event_date: null, created_at: '2026-09-20T11:57:21.687Z' })).toBe('2026-09-20');
		expect(effectiveDateOf({ event_date: '   ', created_at: null })).toBeNull();
	});

	it('carries the resolved day onto the line the row renders', async () => {
		const line = await lineFor({
			id: 'e1',
			event: 'purchased',
			ref_kind: 'inbound',
			ref_doc: 'INB-00004',
			event_date: '2026-06-05',
			created_at: '2026-09-20T02:43:33.199Z',
		});
		expect(line?.effectiveDate).toBe('2026-06-05');
		// The age beside it is measured TO that same day, never to the record time.
		expect(line?.timestamp).toBe('2026-06-05');
	});
});

/**
 * The row's RIGHT half — the other PERSON on the movement, or nobody.
 * `eventPartyOf` owns the precedence (see `labels.spec.ts` for the rule in isolation);
 * what is pinned HERE is that a row carries the other party it resolved, and that a
 * movement with nobody else on it renders no right-hand side at all.
 */
describe('party — the other person on the movement', () => {
	it('names an approver the governing document recorded', async () => {
		const line = await lineFor({
			id: 'e1',
			event: 'issued',
			ref_kind: 'goods_issue',
			ref_doc: 'OUT-00009',
			approved_by: { id: 'p9', name_en: 'Daw Mya' },
		});
		expect(line?.approvedBy).toBe('Daw Mya');
		expect(line?.party).toEqual({ label: 'Approved by', name: 'Daw Mya' });
	});

	it('names the person a unit was handed to', async () => {
		const line = await lineFor({
			id: 'e1',
			event: 'issued',
			ref_kind: 'issue',
			to_employee: { id: 'p1', name_en: 'Ma Ei Mon' },
		});
		expect(line?.party).toEqual({ label: 'Issued to', name: 'Ma Ei Mon' });
	});

	it('carries NO party on a movement nobody had to approve', async () => {
		// A kiosk fit: `ref_kind` is the engine's own marker and `ref_doc` is the serial.
		// The row states no right-hand side — "No approval needed" only restated what the
		// fit's own kind already says.
		const line = await lineFor({ id: 'e1', event: 'fitted', ref_kind: 'fit', ref_doc: 'TY_12', to_slot: 'drv1-lo' });
		expect(line?.party).toBeNull();
	});

	it('carries no party for a document-backed movement with no approver', async () => {
		// An OUT-/INB- row whose approver is absent (a direct store issue, a legacy row)
		// says nothing rather than claiming an approval rule the record cannot prove.
		expect((await lineFor({ id: 'e2', event: 'purchased', ref_kind: 'inbound', to_location: 'main_store' }))?.party).toBeNull();
		expect(
			(await lineFor({ id: 'e3', event: 'rotated', ref_kind: 'goods_issue', to_vehicle: { id: 'v1', plate_no: 'X-1' } }))?.party,
		).toBeNull();
	});
});

describe('fetchTyreEvents — the actor is the row\u2019s identity', () => {
	it('resolves the actor\u2019s name and photo from `by_user`', async () => {
		const line = await lineFor({ id: 'e1', event: 'issued', by_user: { id: 'u1', name_en: 'Ma Ei Mon', avatar: '/api/media/abc.jpg' } });

		expect(line?.actor).toEqual({ name: 'Ma Ei Mon', photo: '/api/media/abc.jpg' });
	});

	it('falls back to the Burmese name, and to no photo when the directory has none', async () => {
		const line = await lineFor({ id: 'e1', event: 'issued', by_user: { id: 'u1', name_en: null, name_mm: 'ဦးလှထွန်း' } });

		expect(line?.actor).toEqual({ name: 'ဦးလှထွန်း', photo: null });
	});

	it('an event with no recorded actor carries NO actor — never a nameless one', async () => {
		// A kiosk action from a controller-less session, or an INB- receipt: the
		// timeline must keep the event glyph rather than invent a person.
		expect((await lineFor({ id: 'e1', event: 'fitted', to_slot: 'drive-l' }))?.actor).toBeNull();
		expect((await lineFor({ id: 'e2', event: 'purchased' }))?.actor).toBeNull();
	});
});

describe('fetchTyreEvents — the approver is the movement\u2019s authority', () => {
	it('states the approver of the document that authorised it', async () => {
		const line = await lineFor({ id: 'e1', event: 'refitted', ref_doc: 'ATR-00001', approved_by: { id: 'u2', name_en: 'U Hla Tun' } });

		expect(line?.approvedBy).toBe('U Hla Tun');
	});

	it('shows no approver where no document authorised the movement', async () => {
		// A kiosk fit is performed, not approved — an approval line here would be a
		// claim the record cannot support.
		expect((await lineFor({ id: 'e1', event: 'fitted', ref_doc: 'TY_13', to_slot: 'drive-l' }))?.approvedBy).toBeNull();
		expect((await lineFor({ id: 'e2', event: 'purchased', ref_doc: 'INB-00001' }))?.approvedBy).toBeNull();
	});
});

/**
 * The row's LEADING FACE — which of the row's two people fronts it.
 *
 * Pinned here rather than in the component spec for a platform reason: base-ui's
 * avatar only emits its `<img>` after a load event, which never fires under jsdom,
 * so a rendered timeline can never prove WHOSE photo landed in the slot. The choice
 * is therefore made once, at this layer, and a DOM run would only ever see the
 * fallback — the assertion has to live where the decision does.
 */
describe('fetchTyreEvents — the leading slot fronts a PERSON whenever the row has one', () => {
	it('fronts the ACTOR when the directory has their photo', async () => {
		const line = await lineFor({
			id: 'e1',
			event: 'refitted',
			by_user: { id: 'u1', name_en: 'Ma Ei Mon', avatar: '/api/media/mon.jpg' },
			approved_by: { id: 'u2', name_en: 'U Hla Tun', avatar: '/api/media/hla.jpg' },
		});

		expect(line?.face).toEqual({ name: 'Ma Ei Mon', photo: '/api/media/mon.jpg', monogram: 'ME' });
	});

	it('falls through to the APPROVER when the actor has no photo', async () => {
		// The case this rule exists for: the person who did the thing is not in the
		// directory, but the one who authorised it is — a real face beats a glyph.
		const line = await lineFor({
			id: 'e1',
			event: 'refitted',
			by_user: { id: 'u1', name_en: 'U Soe Naing', avatar: null },
			approved_by: { id: 'u2', name_en: 'U Hla Tun', avatar: '/api/media/hla.jpg' },
		});

		expect(line?.actor).toEqual({ name: 'U Soe Naing', photo: null });
		expect(line?.face).toEqual({ name: 'U Hla Tun', photo: '/api/media/hla.jpg', monogram: 'UH' });
	});

	it('labels the photo with the name of the person it actually shows', async () => {
		// The bug a bare photo string invites: the approver's face under the actor's
		// name. Name and photo come out of `faceOf` bound together, so the alt text is
		// the second half of the SAME fact.
		const line = await lineFor({
			id: 'e1',
			event: 'refitted',
			by_user: { id: 'u1', name_en: 'U Soe Naing', avatar: null },
			approved_by: { id: 'u2', name_en: 'U Hla Tun', avatar: '/api/media/hla.jpg' },
		});

		expect(line?.face?.name).toBe(line?.approvedBy);
		expect(line?.face?.name).not.toBe(line?.actor?.name);
	});

	it('a photo-less person still fronts the row — with their MONOGRAM, not a glyph', async () => {
		// The glyph is identical on every row of its kind, so it says which EVENT
		// happened (the title directly above already says that) and nothing about WHO.
		// Initials differ per person, so the slot keeps answering its one question —
		// and this is the case that made most real rows show an abstract icon.
		const line = await lineFor({
			id: 'e1',
			event: 'returned',
			by_user: { id: 'u1', name_en: 'U Hla Tun', avatar: null },
			approved_by: { id: 'u2', name_en: 'U Soe Naing' },
		});

		expect(line?.face).toEqual({ name: 'U Hla Tun', photo: null, monogram: 'UH' });
	});

	it('an unspaced Burmese name monograms to its single leading glyph', async () => {
		const line = await lineFor({
			id: 'e1',
			event: 'issued',
			by_user: { id: 'u1', name_en: null, name_mm: 'ဦးလှထွန်း', avatar: null },
		});

		expect(line?.face?.monogram).toBe('ဦ');
		expect(line?.face?.name).toBe('ဦးလှထွန်း');
	});

	it('no actor and no approver is NO face — the one case that keeps the glyph', async () => {
		// A kiosk fit / an INB- receipt: nobody picturable is on the row at all, so
		// there is no person to name and the glyph is the honest answer.
		expect((await lineFor({ id: 'e1', event: 'fitted', ref_doc: 'TY_13', to_slot: 'drive-l' }))?.face).toBeNull();
		expect((await lineFor({ id: 'e2', event: 'purchased', ref_doc: 'INB-00001' }))?.face).toBeNull();
	});

	it('trims an empty-string photo rather than rendering a broken image', async () => {
		const line = await lineFor({
			id: 'e1',
			event: 'issued',
			by_user: { id: 'u1', name_en: 'Ma Ei Mon', avatar: '   ' },
			approved_by: { id: 'u2', name_en: 'U Hla Tun', avatar: '/api/media/hla.jpg' },
		});

		expect(line?.actor?.photo).toBeNull();
		expect(line?.face?.photo).toBe('/api/media/hla.jpg');
	});
});

/**
 * `freeFitmentTargets` — the RAW free-seat enumeration.
 *
 * It is deliberately fleet-wide, and its `sameVehicle` flag is the contract the
 * DIRECT move keys on: the tyre sheet keeps only the same-truck targets, because a
 * seat change that keeps the truck keeps the HOLDER — the only move the raw
 * `/move` route authorizes. Offering another truck's seat would be a dead button
 * (the route answers 403) — so the flag is pinned here, at the data layer, not left
 * to the component's one-line filter.
 */
describe('freeFitmentTargets — fleet-wide seats, with its own truck flagged', () => {
	const truck = (id: string, plate: string, slots: Array<{ id: string; label: string }>) =>
		({ id, plate_no: plate, wheel_slots: slots }) as unknown as VehicleMasterRow;
	const mountedOn = (plateNo: string, slot: string) => ({ id: `${plateNo}:${slot}`, plateNo, slot }) as unknown as TyreCardModel;

	const OWN = truck('v1', '5S-6467', [
		{ id: 'steer-l', label: 'FL1' },
		{ id: 'drv1-lo', label: 'RL1-O' },
		{ id: 'drv1-ro', label: 'RR1-O' },
	]);
	const OTHER = truck('v2', 'BR-9902', [
		{ id: 'steer-l', label: 'FL1' },
		{ id: 'drv1-lo', label: 'RL1-O' },
	]);
	// No wheels and no seats — not a tyre carrier, so it is never offered.
	const CAR = truck('v3', 'CAR-1', []);

	it('flags its OWN truck’s free seats `sameVehicle` and another truck’s not', () => {
		const targets = freeFitmentTargets({ plateNo: '5S-6467', slot: 'steer-l' }, [OWN, OTHER, CAR], []);

		// Its own truck's other free seats come first, flagged …
		expect(targets.filter((t) => t.sameVehicle).map((t) => t.slotId)).toEqual(['drv1-lo', 'drv1-ro']);
		// … and the other truck's seats are enumerated but NOT flagged — a filer's job.
		expect(targets.filter((t) => !t.sameVehicle).map((t) => t.plateNo)).toEqual(['BR-9902', 'BR-9902']);
	});

	it('drops the tyre’s own seat, every OCCUPIED one, and trucks that carry no tyres', () => {
		const targets = freeFitmentTargets({ plateNo: '5S-6467', slot: 'steer-l' }, [OWN, OTHER, CAR], [mountedOn('5S-6467', 'drv1-lo')]);

		expect(targets.map((t) => `${t.plateNo}::${t.slotId}`)).toEqual(['5S-6467::drv1-ro', 'BR-9902::steer-l', 'BR-9902::drv1-lo']);
	});
});
