# ADR-0489: Investor Flow Sample Acquisition Probe

Date: 2026-05-09

## Status

Accepted

## Context

ADR-0487 started the Fresh Data Supply Layer and ADR-0488 stabilized SectorEnergy master supply and supply UNKNOWN policy. The remaining gap before adding further supply lines is proving that semantic investor-flow sample acquisition can be observed without becoming a live trading input.

## Decision

ADR-0489 creates a non-live Investor Flow Sample Acquisition Probe.

The probe records whether semantic investor-flow samples are available and can reference related supply evidence, but it does not replace the semantic investor-flow selected provider. Related program-trading evidence remains supporting evidence only.

All outputs remain diagnostic:

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `policyPromotionMode='SHADOW_ONLY'`
- `operatorApprovalRequired=true`

## Guardrails

ADR-0489 does not change live execution, Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, KIS order behavior, STRONG_BUY behavior, or provider promotion. UNKNOWN remains UNKNOWN. Provider issues remain separated from market signals and are not bearish.

Promotion beyond SHADOW_ONLY requires a future ADR and operator approval.
