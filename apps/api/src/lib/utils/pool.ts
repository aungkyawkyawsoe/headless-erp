/**
 * Bounded-concurrency mapper for independent per-item work (bulk entity
 * writes). Runs `worker` over `inputs` with at most `concurrency` items in
 * flight at once, while the RESULT array stays in input order (each slot i is
 * produced by worker(inputs[i], i) — workers may finish out of order).
 *
 * Per-item error isolation is the CALLER's job: worker must catch its own
 * errors and return an outcome value, exactly like the serial `for` loops this
 * replaces (a thrown error rejects the whole pool). Only use this for items
 * that are truly independent — loops with sequential side effects (naming-
 * series numbering, aggregate recalc against a shared parent, duplicate ids
 * updating the same row) must stay serial.
 */
export async function poolMap<T, R>(
	inputs: readonly T[],
	concurrency: number,
	worker: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(inputs.length);
	let cursor = 0;
	const pump = async (): Promise<void> => {
		while (cursor < inputs.length) {
			// Read-then-increment is synchronous — no interleaving between pumps.
			const i = cursor;
			cursor += 1;
			results[i] = await worker(inputs[i], i);
		}
	};
	const runners = Array.from({ length: Math.min(concurrency, inputs.length) }, () => pump());
	await Promise.all(runners);
	return results;
}
