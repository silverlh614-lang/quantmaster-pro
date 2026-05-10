# ADR-0499 ProviderHealth vs MarketSignal Classifier Migration

## Status

Accepted — 2026-05-10

## Context

ADR-0487~0498 created Fresh Data, SectorEnergy, Supply Snapshot, Promotion Audit, Investor Flow, and normalized status surfaces.

Several diagnostic paths still classify provider failures, empty samples, stale data, or missing fields locally. Local classification can drift and may accidentally turn data absence into bearish evidence.

ADR-0497 introduced `classifyProviderMarketSeparationAdr0497()` as the shared diagnostic taxonomy authority for separating provider-health evidence from market-signal direction. ADR-0499 migrates existing diagnostic interpretation paths toward that common classifier.

The core principle is: provider problem is not market signal. KIS API error is not supply bearish, NAVER empty response is not foreign/institution selling, missing sector `indexCode` is not sector weakness, DART delay is not fundamental deterioration, STALE data is not bearish, `null` is not `0`, and missing samples are not net sell.

## Decision

Introduce ADR-0499 adapter/migration helpers that normalize existing provider/data-health states into ADR-0497 `ProviderHealthStatusAdr0497` and `MarketSignalDirectionAdr0497`.

Use the shared ADR-0497 classifier as the final authority for provider issue vs market signal separation. Preserve existing diagnostic output behavior where possible, but normalize the semantics so provider/data availability issues invalidate requested market signals instead of becoming bearish evidence.

All changes are diagnostic-only. ADR-0499 does not change live trading behavior, scan candidate selection, Gate pass/fail, promotion readiness results, data-line stages, scheduler behavior, snapshot persistence behavior, investor-flow numeric calculations, or sector-energy boost behavior.

## Target migration surfaces

- Fresh Data status view-model inputs from ADR-0498.
- SectorEnergy diagnostic mapping, especially missing master/indexCode/fallback states.
- Investor-flow sample acquisition and semantic net-buy diagnostics.
- Program trading data-line diagnostics.
- Supply snapshot/replay summary diagnostics.
- Promotion audit input summaries where provider issue vs market signal is shown.
- Runtime Pipeline Audit compact evidence where provider/data health appears.

ADR-0499 initially adds the shared adapter and conservatively wires the ADR-0498 FreshDataStatusViewModel path. Deeper diagnostic surfaces should call the ADR-0497 classifier or ADR-0499 adapter in future low-risk migrations rather than implementing local provider/market classification.

## Guardrails

- `executionImpact` remains `NONE`.
- `liveExecutionAllowed` remains `false`.
- No KIS order path import or invocation.
- No Gate threshold, condition weight, Kelly, `requiredScore`, `STRONG_BUY`, `sectorBoost`, `supplyBoost`, or order path change.
- No automatic data-line stage mutation.
- No raw provider payload persistence.
- Provider issue is not market signal.
- `UNKNOWN` remains `UNKNOWN`.
- `null` is never converted to zero.
- `NET_SELL` diagnostic values are not live sell signals.
- Display or classifier failure must be try/catch isolated and must not stop scans, Telegram commands, Runtime Pipeline Audit, Shadow Learning, scheduler diagnostics, or snapshot recording.

## Consequences

Provider errors, empty responses, stale responses, parse errors, and missing fields become diagnostic provider-health evidence, not bearish market signals.

Future ADRs should call the ADR-0497 classifier or ADR-0499 adapter rather than local provider/market classification.

ADR-0500 can aggregate empty scan root causes using normalized provider-vs-market semantics.
