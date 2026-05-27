# ADR-0537: kisClient/query.ts Decomposition (Sector Index + Pure Helpers)

@responsibility ADR-0537 records the byte-equivalent decomposition of kisClient/query.ts into sectorIndex + helpers leaf modules to clear the 1500-line baseline.

## Status

Accepted.

## Context

`server/clients/kisClient/query.ts` reached 2273 LoC — well past the 1,500-line
complexity limit (절대 규칙 #6). It was registered in
`scripts/check_complexity.js` `BASELINE_TECHNICAL_DEBT` (etched at 2132 LoC) and has
since grown +141 LoC, so `validate:complexity` only passes via the baseline
whitelist. The file is KIS L1 core (불변식 #2 — kisClient 단일 통로), so any change
must be byte-equivalent and preserve every existing import path.

The file mixes three separable responsibilities:

1. **KIS quote/supply queries** — current price, prev close, stock name, daily bars,
   investor flow, market supply, short sale, credit/loan (the module's core SSOT).
2. **Sector index domain** — `KIS_SECTOR_ISCD_MAP`, verify-mode flags, probe
   attempts, `fetchKisSectorIndexDaily/CurrentPrice/Probe` (~815 LoC, default-OFF,
   diagnostic/dry-run, `executionImpact=NONE`).
3. **Pure leaf helpers** — KIS bucket/row pickers, number/string extractors, date
   math, trend/percent (no module state, no provider calls).

## Decision

Extract two leaf modules; keep `query.ts` as the quote/supply SSOT + facade.

- `server/clients/kisClient/query/helpers.ts` — `@responsibility KIS 응답 파싱·추출
  순수 leaf 헬퍼` — `KisOutput` type + bucket/row pickers + KIS number/string
  extractors + KST date math + trend/percent. Depends only on `marketDayClassifier`
  (`isTradingDay`); no provider, no module state.
- `server/clients/kisClient/query/sectorIndex.ts` — `@responsibility KIS 국내업종
  지수 조회 — daily·current·probe (default-OFF, diagnostic)` — sector ISCD maps,
  verify policy, probe attempts, and the three sector fetchers. Imports the four
  leaf helpers it needs (`pickKisRowsByBucket`, `pickKisRows`, `extractKisNumber`,
  `extractKisNumberOptional`) from `helpers.ts`.

`query.ts` re-exports the sector surface with `export * from './sectorIndex.js'`, so
every existing import path is preserved byte-equivalent:

- `kisClient/index.ts` facade (`from './query.js'`) — unchanged.
- Four direct importers (`sectorIscdProbe.cmd.ts`, `KisSectorIndexVerifierAdapter.ts`,
  `kisSectorIndexCodeVerifier.ts`, `kisSectorEnergyProvider.ts`) — unchanged.

No dependency cycle: `helpers.ts` imports external only; `sectorIndex.ts` imports
`helpers.ts`; `query.ts` imports `helpers.ts` and re-exports `sectorIndex.ts`.

## Consequences

- `query.ts` 2273 → 1307 LoC, naturally under the 1,500 limit → removed from the
  `BASELINE_TECHNICAL_DEBT` catalog (regression guard auto-re-arms).
- Helper functions, previously module-private, become exported from `helpers.ts`.
  They are not re-exported from `query.ts` and not surfaced by the facade, so the
  public export surface is unchanged.
- No runtime behavior change (byte-equivalent code move). KIS/KRX quota untouched
  (0 new outbound calls). `executionImpact=NONE`. SourceSnapshot/Gate/Telegram/Shadow
  untouched.

## Alternatives Considered

- **Sector-only extraction** (leave helpers in place): query.ts would land at ~1449
  LoC — only 51 under the limit on an actively-growing file, regressing immediately.
  Rejected for insufficient margin.
- **God-function/whole-rewrite**: query.ts is already a collection of independent
  fetchers, not one god function, so a domain+leaf split is the minimal change.

## Migration Plan

1. Create `query/helpers.ts` (leaf functions, byte-exact bodies + export block).
2. Create `query/sectorIndex.ts` (sector block, byte-exact + imports).
3. Trim moved regions from `query.ts`; add `helpers.ts` import + `export *` of
   `sectorIndex.ts`; drop now-unused type imports.
4. Verify byte-equivalence (`git show HEAD:query.ts` range diff), `lint`,
   `validate:complexity`, `validate:responsibility`, and `query*.test.ts`.
5. Remove `query.ts` from `BASELINE_TECHNICAL_DEBT`; patch-history one-liner.
