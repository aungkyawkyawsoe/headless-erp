# Compute Functions — `@mmbix/compute` Reference

> **Single source of truth for computation.** 150 pure, deterministic functions
> in 13 groups — registered into the safe expression evaluator so they work in
> **every declarative surface**: workflow guards, server-function rules, linkage
> `calculate`, formula fields, decision-table `compute` actions, KPI expressions
> — and directly importable from TypeScript anywhere (API worker, plugin
> workers, client app BFF, Studio browser, CLI).

Full inventory at runtime: `computeFunctionNames()` from `@mmbix/compute`.

## Function groups (150 functions)

| Group                | Functions                                                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **financial** (40)   | `NPV` `IRR` `PMT` `FV` `PV` `RATE` `NPER` `IPMT` `PPMT` `CUMIPMT` `CUMPRINC` `EFFECT` `NOMINAL` `XNPV` `XIRR` `MIRR` `SLN` `DDB` `SYD` `DB` `ROI` `MARGIN` `MARKUP` `CAGR` `SIMPLE_INTEREST` `COMPOUND_INTEREST` `BREAKEVEN` `WACC` `PAYBACK` `BALANCE` … |
| **statistical** (23) | `SUM` `COUNT` `MEAN` `MEDIAN` `STDEV` `STDEVP` `VARIANCE` `GEOMEAN` `HARMEAN` `MODE` `PERCENTILE` `QUARTILE` `LARGE` `SMALL` `RANK` `WEIGHTED_AVG` `CORREL` `SLOPE` `INTERCEPT` `FORECAST` `PERCENTRANK` `CLAMP`                                          |
| **datetime** (20)    | `DAYS_BETWEEN` `ADD_MONTHS` `EOMONTH` `YEAR` `MONTH` `DAY` `ISOWEEKNUM` `QUARTER` `DATEDIF` `NET_WORKDAYS` `WORKDAY` `WEEKDAY` `START_OF_MONTH` `END_OF_QUARTER` `END_OF_YEAR` `HOURS_BETWEEN` `MINUTES_BETWEEN` `IS_WEEKEND` `AGE_YEARS`                 |
| **string** (26)      | `UPPER` `LOWER` `TITLE_CASE` `TRIM` `LEN` `LEFT` `RIGHT` `MID` `CONCAT` `REPLACE` `STARTS_WITH` `ENDS_WITH` `CONTAINS` `PAD_LEFT` `PAD_RIGHT` `REPEAT` `JOIN` `SPLIT` `INDEX_OF` `LAST_INDEX_OF` `REVERSE` `NORMALIZE` `MASK` `SLUGIFY` `TRUNCATE`        |
| **currency**         | `CONVERT(amount, from, to, rates)` — direct rate or data-driven rate map, inverse fallback                                                                                                                                                                |
| **tax**              | `TAX` `TAX_TOTAL` `TAX_GROSS` `TAX_BRACKETS(amount, brackets)` — progressive brackets as data                                                                                                                                                             |
| **math**             | `ROUND` `ROUNDUP` `ROUNDDOWN` `MOD` `INT` `SIGN` `EVEN` `ODD`                                                                                                                                                                                             |
| **logic**            | `IF` `COALESCE` `IN` `BETWEEN` `SWITCH` `IS_EMPTY` `IS_NULL` `IS_NUMBER` `IS_INTEGER` `IS_TEXT` `IS_BOOLEAN`                                                                                                                                              |
| **array**            | `ARRAY_LENGTH` `ARRAY_GET` `ARRAY_FIRST` `ARRAY_LAST` `ARRAY_UNIQUE` `ARRAY_SORT`                                                                                                                                                                         |
| **pattern**          | `MATCHES(text, regex)` — validation guards                                                                                                                                                                                                                |
| **conversion**       | `PERCENT` `TO_NUMBER` `TO_TEXT` `TO_BOOLEAN`                                                                                                                                                                                                              |
| **timeseries**       | `MOVING_AVERAGE(values, w)` `MOVING_SUM(values, w)` `PERCENT_CHANGE(cur, prev)` `YOY_GROWTH(cur, prev)` `GROWTH_RATE(cur, prev)` `MAD(values)`                                                                                                            |
| **probability**      | `FACTORIAL` `COMBIN` `PERMUT` `BINOMDIST(k,n,p,cum?)` `POISSON(x,λ,cum?)` `NORMDIST(x,μ,σ,cum?)` `NORMINV(p,μ,σ)` `ZSCORE(x,μ,σ)` `CONFIDENCE(α,σ,n)`                                                                                                     |

> 💡 **Array literals** are supported in expressions — `IN(doc.status, ['new', 'approved'])`,
> `TAX_BRACKETS(doc.gross, [[0,0],[10000,0.05]])`, `NPV(0.1, [-1000, 500, 600])` — no
> need to pre-store lists in the document.

## Headless, tree-shaken, import-what-you-use

`@mmbix/compute` is **pure web-standard JavaScript** (Math/Date/String/Array/RegExp/JSON
only — zero workerd/Cloudflare APIs, zero IO), so it runs **anywhere**: API worker,
plugin workers, client app BFF, the Studio (browser), and the CLI.

Every group is a **sub-path export** — bundlers tree-shake so you ship only what
you import (measured, minified):

```ts
// UI/Studio (browser) — tiny, no core dependency:
import { pmt, npv } from '@mmbix/compute/financial'; // ~200 B for pmt
import { taxBrackets } from '@mmbix/compute/tax';
import { movingAverage } from '@mmbix/compute/timeseries';
import { meanOf, inList } from '@mmbix/compute/statistical';

// API worker — register everything once (workflow guards/rules use them by name):
import { registerComputeFunctions } from '@mmbix/compute'; // ~23 KB, all 150 functions

// Whole package minus registration (pure functions only):
import { pmt, convert, taxBrackets } from '@mmbix/compute'; // ~1 KB (tree-shaken)
```

| Import                                     | Measured bundle (minified) |
| ------------------------------------------ | -------------------------- |
| `@mmbix/compute/financial` (1 fn)          | **~0.2 KB**                |
| `@mmbix/compute` root (2 fns, tree-shaken) | **~1 KB**                  |
| `registerComputeFunctions()` (all 150)     | **~23 KB**                 |

Sub-path map (`package.json` → `exports`): `./financial` `./statistical`
`./datetime` `./string` `./currency` `./tax` `./math` `./logic` `./array`
`./pattern` `./conversion` `./timeseries` `./probability`

## Examples — all data, no code

```jsonc
// Currency-aware budget check (rates come from a field / document)
"guard": "CONVERT(doc.total, 'USD', 'MMK', doc.rates) < doc.budget"

// Progressive tax on a commission payout
"guard": "TAX_BRACKETS(doc.gross, doc.brackets) <= doc.tax_allowance"

// Loan affordability + workday SLA in one guard
"guard": "Math.abs(PMT(0.015, 12, doc.loan)) < doc.payment && NET_WORKDAYS(doc.start, TODAY()) <= 5"

// Conditional routing by customer tier
"guard": "IF(CONTAINS(doc.tier, 'VIP'), doc.total < 100000, doc.total < 10000)"

// Trend analysis in a decision table (trailing 3-month average vs target)
"compute": [{ "field": "trend", "expression": "MOVING_AVERAGE(doc.sales, 3)" }]

// 95% confidence half-width in a KPI definition
"compute": "CONFIDENCE(0.05, doc.stdev, doc.sample_size)"
```

## Registration contract

- `registerComputeFunctions()` is **idempotent** — safe to call more than once per isolate
- Function names are validated (`/^[A-Za-z_$][A-Za-z0-9_$]*$/`)
- Functions are **pure + deterministic** — no `Date.now()`, no `Math.random()`, no I/O
  (preserves evaluator guarantees: replayable guards, cacheable defaults)

## Package layout

| Path                                  | Contents                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `packages/compute/src/index.ts`       | Registry groups + `registerComputeFunctions()` + named exports |
| `packages/compute/src/functions/*.ts` | One group per file (financial, statistical, …)                 |
| `packages/compute/test/*.spec.ts`     | Deterministic value tests (Excel semantics, hand-verified)     |

See also: [Expression Evaluator](expression-evaluator.md) — the safe rule engine
these functions plug into.
