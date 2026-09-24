import { describe, expect, it } from 'vitest';

import { onBoardActions, type BoardActionContext, type BoardUnitState } from './board-actions';

/**
 * The on-board registry's Poka-Yoke contract: what a unit offers, and — for
 * anything it withholds — that the refusal is EXPLAINED rather than hidden.
 */
const STATES: BoardUnitState[] = ['worn', 'unworn', 'asset'];

/** The floor plan a unit sits on. Every case is an ISSUED unit unless it says
 *  otherwise — that is the only status the transfer filer accepts. */
function ctx(over: Partial<BoardActionContext> = {}): BoardActionContext {
	return { vacantSeats: 2, peers: 1, transferable: true, ...over };
}

describe('onBoardActions', () => {
	it('a worn tyre gets the full management set, the governed transfer last', () => {
		const actions = onBoardActions('worn', ctx());
		expect(actions.map((a) => a.kind)).toEqual(['history', 'inspect', 'move', 'swap', 'unseat', 'scrap', 'transfer']);
		expect(actions.every((a) => a.enabled)).toBe(true);
	});

	it('an un-worn spare gets what a tray spare can do — Wear first, transfer last', () => {
		expect(onBoardActions('unworn', ctx({ vacantSeats: 1, peers: 3 })).map((a) => a.kind)).toEqual([
			'history',
			'wear',
			'scrap',
			'transfer',
		]);
	});

	it('offers NO return row — going back to a store IS the governed transfer, with the store as its destination', () => {
		// The store return lives in the ONE filer (`TransferRequestSection` →
		// `custodyDestinationKinds`), so a second menu entry would open the same
		// `mro_asset_requests` write from a parallel path. Pinned for every state.
		for (const state of STATES) {
			const kinds = onBoardActions(state, ctx()).map((a) => a.kind);
			expect(kinds, `${state} must not offer a return`).not.toContain('return');
			expect(onBoardActions(state, ctx()).some((a) => /return to store/i.test(a.label))).toBe(false);
		}
	});

	it('an equipment unit only gets history and the governed transfer', () => {
		expect(onBoardActions('asset', ctx({ vacantSeats: 9, peers: 9 })).map((a) => a.kind)).toEqual(['history', 'transfer']);
	});

	it('Swap is refused — with a reason — when no other tyre is on this truck', () => {
		const swap = onBoardActions('worn', ctx({ peers: 0 })).find((a) => a.kind === 'swap')!;
		expect(swap.enabled).toBe(false);
		expect(swap.reason).toMatch(/nothing to swap/i);
	});

	it('Swap becomes available as soon as a second tyre is mounted here', () => {
		const swap = onBoardActions('worn', ctx({ peers: 1 })).find((a) => a.kind === 'swap')!;
		expect(swap.enabled).toBe(true);
		expect(swap.reason).toBeUndefined();
	});

	it('Wear is refused — with a reason — when the truck has no vacant wheel', () => {
		const wear = onBoardActions('unworn', ctx({ vacantSeats: 0 })).find((a) => a.kind === 'wear')!;
		expect(wear.enabled).toBe(false);
		expect(wear.reason).toMatch(/no vacant wheel/i);
	});

	it('Wear becomes available as soon as one wheel frees up', () => {
		const wear = onBoardActions('unworn', ctx({ vacantSeats: 1 })).find((a) => a.kind === 'wear')!;
		expect(wear.enabled).toBe(true);
		expect(wear.reason).toBeUndefined();
	});

	it('the governed transfer is refused — with a reason — for a unit that is not issued', () => {
		const transfer = onBoardActions('worn', ctx({ transferable: false })).find((a) => a.kind === 'transfer')!;
		expect(transfer.enabled).toBe(false);
		expect(transfer.reason).toMatch(/only an issued unit/i);
	});

	it('every disabled action explains itself, and no enabled action carries a reason', () => {
		for (const state of STATES) {
			for (const vacantSeats of [0, 1]) {
				for (const peers of [0, 1]) {
					for (const transferable of [false, true]) {
						for (const action of onBoardActions(state, { vacantSeats, peers, transferable })) {
							expect(action.label.length, `${state}/${action.kind} label`).toBeGreaterThan(0);
							// Every row carries its Burmese gloss — the operator reads the app in
							// Burmese, so a verb without its meaning is a half-translated menu.
							expect(action.hint.length, `${state}/${action.kind} hint`).toBeGreaterThan(0);
							if (action.enabled) {
								expect(action.reason, `${state}/${action.kind} must not carry a reason`).toBeUndefined();
							} else {
								expect(action.reason, `${state}/${action.kind} must explain the refusal`).toBeTruthy();
							}
						}
					}
				}
			}
		}
	});
});
