import { SEARCH_MIN_CHARS } from '@/shared/constants';

/**
 * The blank prompt a DB-backed picker shows BEFORE its term is long enough to
 * search — ONE component so every bottom sheet reads the same. `noun` tailors
 * the copy ("search", "find a vehicle", "search items").
 *
 * Opened with nothing typed, a picker must never dump a whole directory (or fire
 * a query): it shows this line and waits.
 */
export function PickerSearchHint({ noun = 'search' }: { noun?: string }) {
	return (
		<p className="px-3 py-8 text-center text-sm leading-myanmar text-muted-foreground">
			Type at least {SEARCH_MIN_CHARS} characters to {noun}.
		</p>
	);
}
