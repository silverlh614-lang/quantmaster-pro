# ADR-0487 - Fresh Data Supply Layer Foundation

Date: 2026-05-09
Status: Accepted - OBSERVE/SHADOW_ONLY data supply foundation only

## Context

ADR-0473 through ADR-0486 built the diagnostic layer for supply and SectorEnergy data issues. The system can now explain missing, stale, partial, provider-error, and runtime-mount states, but it still needs one non-live foundation for fresh data lines before any future ADVISORY or live use.

## Decision

Add `server/trading/signalScanner/freshDataSupplyLayerAdr0487.ts` as the SSOT for a Fresh Data Supply Layer foundation.

ADR-0487 creates:

- A fresh data source registry.
- A sanitized snapshot contract.
- Domain summaries for SectorEnergy, Supply, Program Trading, Short/Credit, and support data.
- Compact `/scan_blockers` output.
- ADR-0479 detail trace entry and `/fresh_data_status` detail command.
- ADR-0480 operator action sources.
- ADR-0476 sanitized observation rows.
- Runtime Pipeline Audit diagnostic evidence.

The first priority domains are SectorEnergy and Supply. The registry starts with KRX sector index master, sector/indexCode mapping, stock-daily fallback support, NAVER investor trend, semantic net-buy, KIS/market program trading, FSS passive/active, short balance, credit balance, and optional price/volume support.

## Guardrails

ADR-0487 does not change live execution.

It does not:

- Promote any data source to ADVISORY, WEIGHTED, GATED, CORE, or live execution.
- Use fresh data directly in live Gate decisions.
- Change Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, STRONG_BUY policy, or KIS order behavior.
- Auto-unblock STRONG_BUY.
- Convert UNKNOWN to bullish.
- Convert provider issues to bearish.
- Treat stale, missing, or partial data as bearish.
- Persist raw provider payloads.

All ADR-0487 outputs keep:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'OBSERVE'` or `'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

Failures are try/catch isolated and must not stop scans, Shadow Learning, Runtime Pipeline Audit, or Telegram commands.

## Runtime Output

Default `/scan_blockers` includes compact evidence such as:

```text
ADR-0487 FreshData: OBSERVING | sector=PARTIAL 27.5% | supply=0/6 | impact=NONE
   action: build sector master + collect NAVER/KRX supply samples
```

or:

```text
ADR-0487 FreshData: READY_FOR_SHADOW | sector=80% | supply=5/6 | impact=NONE
```

Runtime Pipeline Audit includes diagnostic evidence such as:

```text
freshDataSupply: ADR-0487 status=OBSERVING sector=PARTIAL supply=DATA_UNAVAILABLE diagnosticOnly=true executionImpact=NONE
```

## Consequences

Operators get one foundation for data-line status across SectorEnergy and Supply without changing trading behavior. Future ADRs can build a sector-energy master supply line or investor-flow sample acquisition on this foundation, but promotion beyond OBSERVE/SHADOW_ONLY requires a future ADR and operator approval.
