/**
 * Safe Expression Evaluator — barrel.
 *
 * The implementation lives in `./expression/` (registry · tokenizer · parser);
 * this file keeps the historic import path (`@mmbix/core` re-exports from
 * './entity/expression') stable for every consumer.
 */
export * from './expression/index';
