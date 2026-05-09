# ADR-0489 — Investor Flow Sample Acquisition Probe

## Status

Accepted — diagnostic-only foundation.

## Context

ADR-0489 follows the investor-flow diagnostic chain (ADR-0473, ADR-0475, ADR-0476, ADR-0477, ADR-0480, ADR-0481, ADR-0482, ADR-0483, ADR-0484, ADR-0485) and the Fresh Data Supply direction intended for ADR-0487/0488.

The system can explain missing/stale supply data, but investor-flow may still show `selectedProvider=NONE`, `DATA_UNAVAILABLE`, `signal=UNKNOWN`, low coverage, uncertain NAVER/CACHE/KIS/KRX sample availability, and no recent semantic net-buy sample.

## Decision

Implement `server/trading/signalScanner/investorFlowSampleAcquisitionAdr0489.ts` as the SSOT for a strictly non-live investor-flow sample acquisition probe.

The probe attempts sanitized sample acquisition in this provider order:

1. NAVER investor trend (ADR-0481 output)
2. CACHE / previous trading day semantic sample
3. KIS only when semantically compatible
4. KRX when available
5. INTERNAL_REPLAY sanitized sample

Each attempt records provider, status, source date, age, cache hit, field coverage, normalization, signal, confidence, providerIssue, marketSignal=false, and diagnostics. Samples pass through ADR-0482 semantic net-buy normalization before selection.

A sample may be selected only when it is acquired or high-quality partial, normalized, HIGH/MEDIUM confidence, semantically valid, and fresh enough for observation. Provider mismatch, provider error, parse error, data unavailable, sample empty, non-trading day, and rate-limited attempts are not selected.

## Guardrails

ADR-0489 is not a trading-signal ADR. It does not promote samples to ADVISORY, WEIGHTED, GATED, CORE, or live execution; change Gate thresholds, Gate weights, Kelly sizing, requiredScore, STRONG_BUY policy, or KIS order behavior; import KIS order modules or order-path modules; use acquired samples in live Gate decisions; auto-unblock STRONG_BUY; convert UNKNOWN to bullish; convert provider issue to bearish; treat stale/missing/partial samples as bearish; or persist raw provider payloads.

All outputs keep `executionImpact='NONE'`, `liveExecutionAllowed=false`, `policyPromotionMode='OBSERVE' | 'SHADOW_ONLY'`, and `operatorApprovalRequired=true`.

Probe failure is try/catch isolated and must not stop scan, Shadow Learning, Runtime Pipeline Audit, or Telegram commands.

## Integrations

ADR-0489 feeds diagnostics only:

- ADR-0477 can consume `selectedSample` through a router-compatible mapping while remaining SHADOW_ONLY.
- ADR-0487 can include `INVESTOR_FLOW_SAMPLE_PROBE` as a Fresh Data SUPPLY snapshot.
- ADR-0484 can use sample acquisition metrics for coverage observations.
- ADR-0485 can treat repeated acquisition as readiness evidence only; it must not promote supply data.
- ADR-0480 can create or update investor-flow sample acquisition operator actions.
- ADR-0476 can record sanitized `INVESTOR_FLOW_SAMPLE_ACQUISITION_ADR0489` observation rows.
- ADR-0478 compact output can show an `ADR-0489 InvestorFlowProbe` line.
- ADR-0479 trace/detail registry can expose the provider attempt chain through `/adr_trace 0489` compatible metadata.
- Runtime Pipeline Audit can show ADR-0489 as diagnostic evidence only.

## Consequences

Before ADR-0489, the system had collector/router/normalizer/freshness diagnostics but did not explicitly answer whether an investor-flow sample could be acquired.

After ADR-0489, the system can report whether a sanitized investor-flow sample was acquired, which provider supplied it, what coverage and confidence it has, and what next diagnostic action is required. Live trading remains unchanged.

Promotion beyond OBSERVE/SHADOW_ONLY requires a future ADR and operator approval.
