# ADR-0533: Unified Forward Outcome Labeling Bus

@responsibility ADR-0533 records the learning-only forward outcome labeling bus for Gate3, Gate1, Near-Miss, counterfactual, and paper evidence.

## Status

Accepted.

## Context

The runtime scan loop and Gate1 positive-feature wiring are active, but forward outcome evidence is fragmented:

- Gate3 outcome seeds can remain pending with zero threshold evidence samples.
- Gate1 dry-run observations produce rows but need D1/D3/D5 maturation counts.
- Near-Miss outcomes already track D3/D5/D10, but their evidence is separate from Gate calibration diagnostics.
- Counterfactual and observational paper entries are learning evidence only and must never be mixed into executable PnL.

This blocks calibration evidence without justifying any Gate threshold, supply threshold, or sector-promotion relaxation.

## Decision

Create `server/learning/unifiedForwardOutcomeLabeler.ts` as a learning-only bus that normalizes supported ledgers into a common schema:

- `outcomeId`
- `sourceType`
- `symbol`
- `decisionType`
- `entryReferencePrice`
- `createdAt`
- `sourceSnapshotId`
- `gateScoreInputSnapshotId`
- `horizonStatus`
- `forwardReturnD1/D3/D5/D10`
- `label`
- `evidenceStatus`

The bus updates only due horizons, uses idempotency keys of `sourceType + outcomeId + symbol + horizon`, and exposes a compact status block for `/scan_blockers full` / `/gate_full`.

Gate3 threshold evidence is aggregated from Gate3 outcome seeds. Gate1 calibration evidence is aggregated from Gate1 dry-run observations. Near-Miss evidence is preserved as a separate sample count. Counterfactual and paper observational rows remain forward evidence only.

## Safety

- `executionImpact=NONE`
- `liveExecutionAllowed=false`
- no Gate threshold change
- no Gate3 RRR, price, volume, or lastTrigger relaxation
- no SectorEnergy unsafe-alias promotion
- provider failures stay provider issues, not bearish market signals
- counterfactual and observational paper rows are excluded from executable PnL/win-rate

## Rollback

Set `UNIFIED_FORWARD_OUTCOME_LABELER_ENABLED=false`.

If the older Gate3-only cron must also stop, set `GATE3_FORWARD_RETURN_CRON_ENABLED=false`.
