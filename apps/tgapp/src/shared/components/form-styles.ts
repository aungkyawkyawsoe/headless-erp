/**
 * The app's form-control styles — ONE definition per control shape.
 *
 * `fieldClass` was re-declared with the SAME literal in 24 modules (plus an
 * `h-10` outlier), `labelClass` in 15, `noteClass` in 4. A single drifted copy
 * is invisible until two screens sit side by side. These constants are the
 * single source; modules import and alias them (`FIELD_CLASS as fieldClass`) so
 * a call site never carries its own copy.
 *
 * The label uses the `text-sub` token — `index.css` names it as the app's L2
 * register and explicitly flags a raw `text-sm` as drift. `FormField`'s default
 * caption is this same constant, so a hand-rolled field and a `FormField` now
 * render an identical caption.
 */

/** Single-line input / select / textarea (1 row) skin. */
export const FIELD_CLASS =
	'h-11 w-full rounded-lg border border-input bg-card px-3 text-sm leading-myanmar text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60';

/** A multi-line note/textarea — the same vocabulary, grown to a block. */
export const NOTE_CLASS =
	'min-h-24 w-full resize-none rounded-lg border border-input bg-card px-3 py-2.5 text-sm leading-myanmar text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60';

/** A picker-type control laid out as one row (value + clear/chevron affordance). */
export const PICKER_FIELD_CLASS =
	'flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-sm leading-myanmar text-foreground outline-none focus-within:border-ring/60';

/**
 * TWO fields in ONE row — the header PAIR a stock document is read for (WHO it
 * came from beside WHERE it landed on a receipt; WHEN beside WHERE on an issue).
 *
 * A `grid` of exactly two cells, which works because the sheets behind the pickers
 * are PORTAL-ONLY: a `<Sheet>` renders no element of its own (base-ui's
 * `Dialog.Portal` returns `null` until it opens, and its content lands in `body`),
 * so the only in-flow children of the row are the two fields put in it. A third
 * in-flow child would silently claim a cell.
 *
 * Used only for fields whose control states a single value — a hint line, a chip
 * row or a whole block stays full width on its own row.
 */
export const FIELD_ROW_CLASS = 'grid grid-cols-2 gap-2';

/** The field caption — the `text-sub` token. `FormField` defaults to this. */
export const FIELD_LABEL_CLASS = 'mb-1.5 block text-sub font-semibold leading-myanmar text-foreground';
