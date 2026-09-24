/**
 * The action set ONE unit of a truck's on-board registry admits — the PURE rule the
 * registry list renders (`truck-inventory-list.tsx` → the unit's action menu). One
 * rule means a unit offers the same verbs however the list is reached, and an action
 * added here is offered everywhere.
 *
 * Types only (no React, no SDK), so the whole Poka-Yoke contract is unit-tested
 * without a running app: an action the engine would refuse is reported DISABLED
 * WITH ITS REASON and never silently dropped, and an enabled action never carries
 * a reason. Two invariants the spec pins for every combination:
 *
 *   1. `enabled === false` ⇒ a non-empty `reason` exists (an action is never inert
 *      without telling the operator why).
 *   2. `enabled === true` ⇒ no `reason` (nothing to explain).
 *
 * Five of the kinds ARE the action page's route segments
 * (`/app/tyres/vehicle/:id/action/:kind/:tyreId`), so a menu row and the full-screen
 * page it opens share one vocabulary and a rename cannot drift them apart. The
 * other three are their own surfaces: `wear` seats an un-worn tyre on a vacant wheel
 * of THIS truck, `transfer` files the governed request a superior must approve,
 * and `history` opens the serial's lifecycle page.
 *
 * There is deliberately NO `return` verb. A unit going back to a store is a CUSTODY
 * change like any other, and the governed `transfer` filer already offers the store
 * as one of its destinations (`custodyDestinationKinds`), so the menu routes the
 * operator into that ONE filer instead of carrying a second, parallel entry to the
 * same `mro_asset_requests` row.
 *
 * `transfer` and `scrap` are the two FILERS: each opens a full-screen form that
 * files an `mro_asset_requests` row a superior must approve and execute. A write-off
 * is filed by its own page (`scrap`), not by the transfer filer, because a write-off
 * names NO destination — the engine's kind guard refuses a request that carries both
 * a destination and the `write_off` flag.
 *
 * The state split mirrors the register's own: a unit's `kind` is DERIVED (a tyre
 * vs an `asset`), and a tyre is WORN (seated on a wheel) or UN-WORN (in the tray).
 * Only the rules live here — the icon and the wiring to a writer stay in the view.
 */

/** A unit's state on the truck — worn on a wheel, un-worn in the tray, or an
 *  `assets`-flagged unit (a jack, a toolbox) that never has a wheel. */
export type BoardUnitState = 'worn' | 'unworn' | 'asset';

/** Every action a registry unit can offer, in one vocabulary. */
export type BoardActionKind = 'history' | 'inspect' | 'move' | 'swap' | 'unseat' | 'scrap' | 'wear' | 'transfer';

export interface BoardAction {
	kind: BoardActionKind;
	/** The row's copy — what the action IS. */
	label: string;
	/** The one-line Burmese gloss under the label — what the action DOES, for the
	 *  operator who reads the app in Burmese. English stays the label so a verb is
	 *  recognisable to anyone; the gloss carries the meaning. */
	hint: string;
	enabled: boolean;
	/** Why the action cannot run now — required when `enabled` is false. */
	reason?: string;
}

/** Build an action, attaching the reason ONLY when it is actually disabled. */
function gated(kind: BoardActionKind, label: string, hint: string, enabled: boolean, reason: string): BoardAction {
	return enabled ? { kind, label, hint, enabled } : { kind, label, hint, enabled, reason };
}

/** An action that is always available for its state. */
function always(kind: BoardActionKind, label: string, hint: string): BoardAction {
	return { kind, label, hint, enabled: true };
}

/** What the truck's floor plan implies for a unit's action set:
 *  `vacantSeats` — how many wheel seats on THIS truck are still free (an un-worn tyre
 *  can only be WORN where there is room);
 *  `peers` — how many OTHER tyres are seated on this truck (a swap exchanges two
 *  wheel positions on ONE truck, so a swap needs a second mounted tyre here);
 *  `transferable` — whether the unit may be FILED for a governed move (the filer
 *  takes an ISSUED unit only, so the menu refuses anything else up front). */
export interface BoardActionContext {
	vacantSeats: number;
	peers: number;
	transferable: boolean;
}

/**
 * The action set for one registry unit, in render order. A WORN tyre gets the
 * full management set (measure it, rotate it, exchange it, take it off or write it
 * off, or ask a superior to move it — a store return is that same request, with the
 * store as its destination); an UN-WORN tyre gets what a
 * unit that is not on a wheel can actually do; an equipment unit only what an asset can. Each action
 * carries its English label AND a one-line Burmese gloss (the app's operator copy),
 * so the menu reads the same on a phone as it does in the workshop.
 */
export function onBoardActions(state: BoardUnitState, ctx: BoardActionContext): BoardAction[] {
	const history = always('history', 'Full history', 'မှတ်တမ်းအသေးစိတ်ကြည့်ရှုရန်');
	// A transfer is FILED, never executed here: a recorded superior decides it, and
	// the filer itself refuses a unit with no holder to record as the source. Its
	// destination is another TRUCK — a person is deliberately not offerable.
	const transfer = gated(
		'transfer',
		'Request a transfer',
		'အခြားကားသို့ ပြောင်းရွှေ့ခွင်းတောင်းရန်',
		ctx.transferable,
		'Only an issued unit can be moved between trucks — this one is not issued',
	);

	if (state === 'asset') return [history, transfer];

	if (state === 'worn') {
		return [
			history,
			always('inspect', 'Record inspection', 'ပန်းပွင့်အနက် တိုင်းတာစစ်ဆေးရန်'),
			always('move', 'Move to a wheel position', 'အခြားကားသို့ ပြောင်းရန်'),
			gated(
				'swap',
				'Swap with another tyre',
				'အခြားတာယာနှင့် နေရာချင်း လဲရန်',
				ctx.peers > 0,
				'The only tyre on this truck — nothing to swap with',
			),
			// A tyre comes OFF a wheel and stays on the truck — it is not "a spare", a
			// word this module retired: a tyre is ON A WHEEL or NOT YET on one.
			always('unseat', 'Take off wheel — keep on truck', 'ကားတွင် ခနဖြုတ်သိမ်း'),
			always('scrap', 'Request write-off', 'ဟောင်းနွမ်း ပျက်စီး၍ စွန့်ပစ်စာရင်းသွင်းရန်'),
			transfer,
		];
	}

	return [
		history,
		gated('wear', 'Wear on a wheel position', 'တာယာ တပ်ဆင်ရန်', ctx.vacantSeats > 0, 'No vacant wheel on this truck — take one off first'),
		always('scrap', 'Request write-off', 'ဟောင်းနွမ်း ပျက်စီး၍ စွန့်ပစ်စာရင်းသွင်းရန်'),
		transfer,
	];
}
