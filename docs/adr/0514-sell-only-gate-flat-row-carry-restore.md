---
id: 0514
title: SELL_ONLY gateSemanticFlatRow carry restore
status: ACCEPTED
date: 2026-05-14
executionImpact: NONE
liveExecutionAllowed: false
policyPromotionMode: SHADOW_ONLY
operatorApprovalRequired: true
---

# ADR-0514 - SELL_ONLY Gate Flat Row Carry Restore

## Context

During SELL_ONLY sessions, `SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC` could repeatedly show:

- `inputShape=WRAPPER`
- `foreignNetBuy=null`
- `institutionNetBuy=null`
- semantic reason `RAW_INVESTOR_ROW_MISSING`

The root cause was not the diagnostic log itself. The SELL_ONLY forensic collector
merged actual investor rows from the by-symbol payload but did not carry
`gateSemanticFlatRow`, so the flat row produced by the supply router was lost before
Gate semantic evaluation.

## Decision

1. `mergeActualRowCarryAdr0507` carries `gateSemanticFlatRow` from the by-symbol
   payload.
2. Stale by-symbol payloads preserve the base flat row and do not inject stale
   numbers into Gate semantic evaluation.
3. The collector exposes `gateSemanticFlatRow` on `kisFlow`.
4. `SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC` remains enabled. When the fallback shape is
   still `WRAPPER`, it includes `sellOnlyCarryBreakPoint` for root-cause tracing.

## Safety Invariants

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- no `autoTradeEngine` changes
- no KIS order path changes
- no Gate threshold or scoring formula changes
- no diagnostic log deletion
