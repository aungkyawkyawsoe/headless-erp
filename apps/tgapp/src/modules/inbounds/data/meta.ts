import type { InboundType } from './types';

/**
 * The inbound flow's per-type metadata — the single source the shared list /
 * create UI reads. All three inbound kinds (ဝယ်ယူမှု / ရှေးစာရင်း / ပြန်အမ်း)
 * are the SAME `mro_inbounds` document flow and differ only in `type` + this
 * copy — the create form's semantics line + the card's small type tag.
 */
export interface InboundTypeMeta {
	/** The card's small type tag (e.g. ဝယ်). */
	tagLabel: string;
	/** The type's full Burmese label (the create form's chooser). */
	label: string;
	/** What THIS kind of inbound is FOR (the form's intro line). */
	semantics: string;
	/** The form's intro note for this kind (Burmese). */
	hint: string;
	/**
	 * WHO the goods come from for this kind — the form's counterparty field. A
	 * purchase has a VENDOR; a return has the EMPLOYEE who handed the goods back
	 * and an opening balance the employee handing the existing stock over. The
	 * engine enforces the same split (`required_if` rules on
	 * `mro_inbounds.supplier` / `handed_by`), so the label here and the rule there
	 * can never disagree.
	 */
	party: InboundPartyMeta;
}

/** The counterparty field a kind renders — one vendor OR one employee, never both. */
export interface InboundPartyMeta {
	/** Which picker to render: the supplier directory, or the personnel search. */
	kind: 'supplier' | 'employee';
	/** The `mro_inbounds` column the chosen id is written to. */
	field: 'supplier' | 'handed_by';
	/** The field's label — the kind's own MEANING, not a shared generic "Party". */
	label: string;
	/** Empty-field placeholder. */
	placeholder: string;
}

export const INBOUND_TYPE_META: Record<InboundType, InboundTypeMeta> = {
	purchase: {
		tagLabel: 'Purchase',
		label: 'Purchase',
		semantics: 'Receive the goods bought from a supplier into stock',
		hint: 'Standard purchase (GRN) — goods are received and the new batch/serial units enter stock.',
		party: {
			kind: 'supplier',
			field: 'supplier',
			label: 'Supplier',
			placeholder: 'Select supplier',
		},
	},
	legacy: {
		tagLabel: 'Opening',
		label: 'Opening',
		semantics: 'Enter the existing balance as the opening stock',
		hint: 'Opening balance — the same stock effect as a Purchase.',
		party: {
			kind: 'employee',
			field: 'handed_by',
			label: 'Handed over by',
			placeholder: 'Select employee',
		},
	},
	return: {
		tagLabel: 'Return',
		label: 'Return',
		semantics: 'Receive previously-issued goods coming back',
		hint: 'Only previously-issued (issued) serials can return — they are re-instocked at the receiving store.',
		party: {
			kind: 'employee',
			field: 'handed_by',
			label: 'Returned by',
			placeholder: 'Select employee',
		},
	},
};

/** The create-form chooser's option order (canonical: ဝယ် → ရှေး → ပြန်အမ်း). */
export const INBOUND_TYPE_VALUES: readonly InboundType[] = ['purchase', 'legacy', 'return'];
