---
id: 0513
title: Supply Gate semantic unwrap wiring
status: ACCEPTED
date: 2026-05-14
executionImpact: NONE
liveExecutionAllowed: false
policyPromotionMode: SHADOW_ONLY
operatorApprovalRequired: true
---

# ADR-0513 - Supply Gate Semantic Unwrap Wiring

## Context

InvestorFlowProviderRouter can be VERIFIED while Gate semantic availability is unusable
when the selected object is wrapper metadata instead of the extracted numeric investor
flow row.

Observed diagnostic:

- rootCause: `SUPPLY_ROUTER_VERIFIED_BUT_GATE_SEMANTIC_UNUSABLE`
- semanticReason: `ONLY_WRAPPER_OBJECT_SELECTED`
- nextAction: `WIRE_UNWRAPPED_ROW_TO_SEMANTIC_MAPPER`

## Decision

1. Router creates an explicit flat gate row with only numeric consumer fields:
   `foreignNetBuy`, `institutionNetBuy`, `programNetBuy`, `_source='ROUTER_EXTRACTED'`.
2. Semantic availability extracts flat rows before wrapper unwrapping and uses the
   effective flow for all evaluator checks.
3. `0` is valid neutral data and must not be treated as missing.
4. `ONLY_WRAPPER_OBJECT_SELECTED` is structural wiring noise, not a provider issue.
5. BEFORE/AFTER semantic evaluator diagnostics are emitted with a 60 second throttle.

## Safety Invariants

- `executionImpact='NONE'`
- `marketSignal=false`
- `providerIssue=false` for `ONLY_WRAPPER_OBJECT_SELECTED`
- no `autoTradeEngine` or KIS order path changes
- `INVESTOR_FLOW_WRAPPER_METADATA_KEYS` entries are not removed
- `unwrapInvestorFlowRows` logic remains unchanged

## Verification

- `rg "input\.flow" server/supply/investorFlowSemanticAvailability.ts` returns no matches.
- `server/supply/investorFlowSemanticWire.test.ts`
- `server/trading/signalScanner/investorFlowActualRowCarryWiring001.test.ts`
- `server/trading/signalScanner/gate1MinimumSignalForensicAdr0505.test.ts`
- `server/trading/signalScanner/investorFlowProviderRouterAdr0477.test.ts`
