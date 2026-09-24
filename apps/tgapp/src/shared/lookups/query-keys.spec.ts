import { describe, expect, it } from 'vitest';

import { qk as incidentsQk } from '@/modules/incidents/data/query-keys';
import { qk as insurancesQk } from '@/modules/insurances/data/query-keys';
import { qk as licensesQk } from '@/modules/licenses/data/query-keys';
import { qk as maintenancesQk } from '@/modules/maintenances/data/query-keys';
import { qk as odoQk } from '@/modules/odo/data/query-keys';
import { qk as fluidsQk } from '@/modules/fluids/data/query-keys';
import { masterQk } from './query-keys';

/**
 * The per-truck identity read must be ONE cache entry.
 *
 * Six modules (insurance / license / maintenance / incident / odo / fluid) each
 * had their own `qk.fleet` under their own namespace, so naming the same truck
 * from two module pages fetched `veh_fleets` twice and cached it twice. They all
 * read the identical projection (`id, plate_no, brand`), so they share
 * `masterQk.vehicle(id)`. This pins that — a new module's `qk.fleet` that forks
 * its own key would silently reintroduce the duplicate fetch.
 */
describe('vehicle identity — one shared cache entry', () => {
	it('every fleet module keys the per-truck identity identically', () => {
		const vehicleId = 'v-0001';
		const expected = masterQk.vehicle(vehicleId);

		const moduleKeys = [
			['insurances', insurancesQk],
			['licenses', licensesQk],
			['maintenances', maintenancesQk],
			['incidents', incidentsQk],
			['odo', odoQk],
			['fluids', fluidsQk],
		] as const;

		for (const [name, qk] of moduleKeys) {
			expect(qk.fleet(vehicleId), `${name}.qk.fleet must alias masterQk.vehicle`).toEqual(expected);
		}

		// Distinct trucks must still key distinctly (no accidental constant key).
		expect(masterQk.vehicle('v-0002')).not.toEqual(expected);
	});
});
