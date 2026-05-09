# ADR-0486 - Supply Recovery Runtime Mount Verification

Date: 2026-05-09
Status: Accepted - SHADOW_ONLY runtime mount verification only

## Context

ADR-0481 through ADR-0485 exist on main, but recent Railway/Telegram runtime output can still show legacy diagnostics such as:

- `NAVER: NOT_WIRED`
- `Semantic NetBuy: schema ready / collector not wired`
- `readinessAuditEvidence=missing`

Those messages mean the runtime formatter or `ScanSummary` evidence path may still be stale even when the new modules are present.

## Decision

Add `server/trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.ts` as the SSOT for verifying whether ADR-0481 through ADR-0485 are mounted in the live `/scan_blockers` diagnostic path.

ADR-0486 inspects:

- ADR-0473 warmup formatter output.
- ADR-0481 NAVER collector status.
- ADR-0482 semantic net-buy normalizer status.
- ADR-0483 cache/source freshness evidence.
- ADR-0484 supply recovery observation evidence.
- ADR-0485 readiness audit evidence.
- ADR-0478 compact output presence.
- ADR-0479 detail trace registry presence.
- Runtime Pipeline Audit evidence plumbing.

It emits compact and detail diagnostics only. It also feeds ADR-0480 operator actions, ADR-0476 sanitized observation rows, `/scan_blockers` compact output, ADR-0479 detail trace entries, and Runtime Pipeline Audit evidence.

## Guardrails

ADR-0486 does not add live trading behavior.

It does not:

- Promote supply data to ADVISORY, WEIGHTED, GATED, CORE, or live execution.
- Change Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, STRONG_BUY policy, or KIS order behavior.
- Auto-unblock STRONG_BUY.
- Convert UNKNOWN to bullish.
- Convert provider issues to bearish.
- Treat stale, partial, or missing data as bearish.
- Persist raw provider payloads.

All ADR-0486 outputs keep:

- `executionImpact = 'NONE'`
- `liveExecutionAllowed = false`
- `policyPromotionMode = 'SHADOW_ONLY'`
- `operatorApprovalRequired = true`

Mount verification failures are try/catch isolated and must not stop scans, Shadow Learning, Runtime Pipeline Audit, or Telegram commands.

## Runtime Output

When mounted:

```text
ADR-0486 RuntimeMount: MOUNTED | legacy=0 | missingEvidence=0 | impact=NONE
```

When stale formatter or missing evidence remains:

```text
ADR-0486 RuntimeMount: LEGACY_OUTPUT_DETECTED | legacy=2 | missingEvidence=1 | impact=NONE
   action: align ADR-0473 warmup formatter + Runtime Pipeline Audit input
```

Runtime Pipeline Audit includes diagnostic evidence such as:

```text
supplyRecoveryMount: ADR-0486 status=PARTIAL legacy=2 missingEvidence=1 diagnosticOnly=true executionImpact=NONE
```

## Consequences

Operators can distinguish "module exists" from "module is actually mounted in Railway runtime output." The engine remains alive, Shadow Learning continues, and live execution remains unchanged.
