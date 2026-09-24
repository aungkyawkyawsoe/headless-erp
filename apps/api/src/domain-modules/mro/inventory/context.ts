/**
 * The MRO use-case CONTEXT — one object carrying the db handle, the resolved
 * table names and the constructed collaborators, built once per call and handed
 * to a use-case class. This keeps every use-case constructor at a single argument
 * (rather than growing an arity-N parameter list) and guarantees each collaborator
 * is a single shared instance: ONE `DocReads`, ONE `Allocation` (the only FEFO
 * ordering), ONE `GuardedBatch` (the only guarded-batch engine).
 */
import type { D1Client } from '@mmbix/core';
import { Allocation } from './allocation';
import { DocReads } from './docs';
import { GuardedBatch } from './guarded-batch';
import type { Tables } from './types';

export interface MroContext {
	db: D1Client;
	tables: Tables;
	docs: DocReads;
	allocation: Allocation;
	guarded: GuardedBatch;
}

export function buildContext(db: D1Client, tables: Tables): MroContext {
	return { db, tables, docs: new DocReads(db, tables), allocation: new Allocation(db, tables), guarded: new GuardedBatch(db, tables) };
}
