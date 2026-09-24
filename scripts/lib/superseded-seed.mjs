/**
 * The fail-fast gate for MRO seeds that the catalog rework SUPERSEDED.
 *
 * The tracking policy moved from the SKU (`mro_item_model.tracking`) onto the
 * item-name master (`mro_item_name.tracking`), the free-text `mro_item_name.name`
 * column was retired, and `mro_item_model.item_name` is now REQUIRED. The demo /
 * stock-populate seeds below predate all three and would fail midway (or, worse,
 * create a half-built catalog) if run against the current schema.
 *
 * They are also out of step with where the catalog is now: the master data is
 * seeded by `seed-mro-catalog.mjs` (item names + their policies, SKUs)
 * and the stock screens are deliberately left BLANK (`reset-mro-stock.mjs`).
 *
 * So instead of silently 400-ing, each one stops immediately and names the
 * replacement. To revive demo stock for a test run, port the script forward:
 * resolve/create the parent `mro_item_name` (with its `tracking`) FIRST, then
 * create each SKU with `item_name` set — see `seed-mro-catalog.mjs` for the shape.
 */
export function refuseIfSuperseded({ script, replacement }) {
	console.error(`\n${script} is SUPERSEDED and no longer runs against the current MRO schema.`);
	console.error(`  - the tracking policy moved to mro_item_name.tracking (mro_item_model.tracking is gone)`);
	console.error(`  - mro_item_name.name was retired (use name_en / name_mm)`);
	console.error(`  - mro_item_model.item_name is now REQUIRED`);
	console.error(`\nUse instead:`);
	for (const line of replacement) console.error(`  · ${line}`);
	console.error('');
	process.exit(1);
}
