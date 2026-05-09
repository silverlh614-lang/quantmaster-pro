# ADR-0481 — NAVER Investor Trend Collector Wiring

## Status
Accepted — SHADOW_ONLY diagnostic wiring.

## Context
ADR-0480 surfaces operator actions from scan diagnostics. One recurring P1 action was `InvestorFlow provider unwired → NAVER collector wiring`, with diagnostics such as `NAVER_INVESTOR_TREND: NOT_WIRED`, `selectedProvider: NONE`, `InvestorFlow: DATA_UNAVAILABLE`, and `coverage: 0/5`.

This is provider routing incompleteness, not confirmed bearish supply. Missing or unavailable NAVER data must remain `UNKNOWN` and must not become bullish or bearish evidence.

## Decision
ADR-0481 wires a NAVER investor trend collector layer as a candidate semantic investor-flow provider for ADR-0477. The collector normalizes sanitized semantic fields only:

- `foreignNetBuy`
- `institutionNetBuy`
- `individualNetBuy`
- `programNetBuy`
- source date, freshness, coverage, confidence, status, and signal

The implementation is `SHADOW_ONLY` and diagnostic-only. It does not persist raw NAVER payloads and does not fetch inside `/scan_blockers` formatters.

## Guardrails
ADR-0481 keeps these invariants:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

ADR-0481 does **not**:

- promote NAVER data to live execution or CORE
- change Gate thresholds, Gate weights, Kelly sizing, requiredScore, or live buy policy
- change KIS order behavior or import KIS order modules
- auto-unblock `STRONG_BUY`
- convert `UNKNOWN` to bullish
- convert provider issues to bearish
- treat missing NAVER data as bearish

Promotion beyond `SHADOW_ONLY` requires a future ADR and explicit operator approval.

## Routing Chain
ADR-0481 feeds the existing diagnostic chain:

1. NAVER Investor Trend Collector ADR-0481
2. InvestorFlow Provider Router ADR-0477
3. Supply Provider Warmup ADR-0473
4. Positive Source Wiring Dry Run ADR-0475
5. Dry-run Observation Ledger ADR-0476
6. Operator Action Queue ADR-0480
7. Compact `/scan_blockers` ADR-0478
8. Detail Registry ADR-0479

## Outcomes
Before ADR-0481, NAVER trend absence was represented as `NOT_WIRED`. After ADR-0481, the collector module replaces that wiring diagnostic with states such as:

- `WIRED`
- `DATA_AVAILABLE`
- `DATA_UNAVAILABLE`
- `PARTIAL`
- `EMPTY`
- `STALE`
- `PARSE_ERROR`
- `PROVIDER_ERROR`
- `NON_TRADING_DAY`
- `DISABLED`

This reduces `NOT_WIRED` noise. If NAVER is wired but empty/unavailable, ADR-0480 should use a lower-priority data availability/fallback action rather than keeping a P1 unwired action solely because NAVER was previously not wired.

## Signal Semantics
`BULLISH` is emitted only when verified/usable foreign and institution net-buy are both positive with `HIGH` or `MEDIUM` confidence.

`BEARISH` is emitted only when verified/usable foreign and institution net-buy are both negative with `HIGH` or `MEDIUM` confidence.

`UNKNOWN` remains `UNKNOWN` for `DATA_UNAVAILABLE`, `EMPTY`, `STALE`, `PARSE_ERROR`, `PROVIDER_ERROR`, and `NON_TRADING_DAY`. Provider issue remains separated from bearish market signal.

## Consequences
The engine remains alive, Shadow Learning remains visible, live execution remains unchanged, and NAVER wiring reduces provider-routing noise without creating false bullish or false bearish supply signals.
