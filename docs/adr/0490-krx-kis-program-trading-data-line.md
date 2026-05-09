# ADR-0490: KRX/KIS Program Trading Data Line

Date: 2026-05-09

## Status

Accepted

## Context

QuantMaster Pro has completed the ADR-0473~0489 diagnostic and Fresh Data Supply chain. The diagnostic system is built, the Fresh Data Supply Layer has started, ADR-0488 repaired SectorEnergy/supply UNKNOWN observation, and ADR-0489 probes investor-flow sample acquisition in a non-live path.

Program trading data is a major supply source, but before it can be considered by any future policy it must be collected, normalized, freshness-checked, and exposed as a dedicated non-live data line.

Target data lines:

1. KIS stock-level program trading.
2. KIS/KRX market-level program trading.
3. KRX program-related fallback when available.
4. Cache/replay fallback for the previous trading day.
5. Normalized program net-buy sample for the Fresh Data Supply Layer.

## Decision

ADR-0490 adds `server/trading/signalScanner/programTradingDataLineAdr0490.ts` as the SSOT for a KRX/KIS Program Trading Data Line.

The module provides:

- `normalizeProgramTradingSampleAdr0490` for sanitized numeric parsing, unit normalization, buy-sell derived net-buy, freshness, coverage, quality, signal, and confidence metadata.
- `buildProgramTradingDataLineReportAdr0490` for stock/market sample selection, provider-attempt tracking, cache/internal replay fallback handling, coverage, gaps, and recommended next actions.
- Compact `/scan_blockers` output.
- ADR-0479 detail registry support for `/adr_trace 0490`, `/fresh_data_status`, `/supply_health_detail`, and `/operator_actions` consumers.
- ADR-0476 sanitized observation rows.
- ADR-0480 operator-action sources.
- Runtime Pipeline Audit evidence.

ADR-0490 feeds ADR-0487 Fresh Data Supply snapshots:

- `KIS_PROGRAM_TRADING`
- `MARKET_PROGRAM_TRADING`
- `PROGRAM_TRADING_SAMPLE`

ADR-0490 also feeds ADR-0489 as related supply evidence only, ADR-0484 coverage recovery counters, ADR-0485 supporting evidence only, ADR-0480 operator actions, ADR-0476 observation rows, ADR-0478 compact output, ADR-0479 detail registry, and Runtime Pipeline Audit.

## Guardrails

ADR-0490 is not a trading-signal ADR.

It does not:

- Change live execution.
- Import or call KIS order APIs.
- Change KIS order paths.
- Change `requiredScore=70`.
- Change Gate thresholds, Gate weights, Kelly sizing, live buy policy, sell policy, or portfolio sizing.
- Promote program trading data to ADVISORY, WEIGHTED, GATED, or CORE.
- Use program trading data directly in live Gate decisions.
- Auto-unblock STRONG_BUY.
- Convert UNKNOWN to bullish.
- Convert provider issues to bearish.
- Treat stale/missing/partial program data as bearish.
- Persist raw provider payloads.

All outputs keep:

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `policyPromotionMode='OBSERVE'` or `policyPromotionMode='SHADOW_ONLY'`
- `operatorApprovalRequired=true`

Provider fetch/probe failure is try/catch isolated and must not stop scan, Shadow Learning, Runtime Pipeline Audit, or Telegram commands. Any provider fetch must be explicitly non-live, rate-limited, and diagnostic-only.

## Status and Signal Policy

`ACCEPTED_EMPTY`, `NON_TRADING_DAY`, `PROVIDER_ERROR`, `PROVIDER_MISMATCH`, `RATE_LIMITED`, `DATA_UNAVAILABLE`, `EMPTY`, `PARSE_ERROR`, stale low-confidence data, and `UNKNOWN` all keep signal `UNKNOWN` and are not bearish.

`BULLISH` or `BEARISH` can only be emitted inside the OBSERVE/SHADOW_ONLY sample when a normalized or high-quality partial sample has HIGH/MEDIUM confidence and program net-buy is materially positive or negative. That signal is observation evidence only and does not affect live trading.

## Consequences

Before ADR-0490, program trading data was not represented as a dedicated Fresh Data Supply line and market program output could appear as `ACCEPTED_EMPTY` without structured observation.

After ADR-0490:

- `/scan_blockers` compact can show ProgramTrading data line status.
- `/supply_health_detail` and `/fresh_data_status` can expose stock/market program sample status through detail formatting.
- ADR-0487 FreshData includes program trading snapshots.
- ADR-0489 can reference program samples as related supply evidence without replacing semantic investor-flow samples.
- ADR-0484 can track program sample coverage, data unavailable, accepted empty, and stale counts.
- ADR-0480 operator actions become more precise.
- Live trading remains unchanged.

Promotion beyond OBSERVE/SHADOW_ONLY requires a future ADR and operator approval.
