# ADR-0491: Supply Snapshot Store & Replay

Status: Accepted  
Date: 2026-05-09  
Scope: diagnostics / fresh-data / supply-snapshot  
Execution impact: NONE  
Live execution allowed: false  
Policy promotion mode: OBSERVE / SHADOW_ONLY  
Operator approval required: true

## Context

ADR-0473 through ADR-0490 established Fresh Data Supply observation lines for SectorEnergy master/indexCode supply, InvestorFlow sampling, semantic net-buy normalization, program-trading samples, source freshness dual clocks, operator actions, and runtime audit visibility.

Fresh supply samples can now be generated and displayed, but the system still needs a dedicated sanitized store/replay layer that can preserve non-raw diagnostic snapshots, replay previous scans, compare current and previous snapshots, support holiday/non-trading-day diagnosis, and provide reproducible evidence when providers are unavailable.

## Decision

ADR-0491 adds `server/trading/signalScanner/supplySnapshotStoreReplayAdr0491.ts` as the SSOT for sanitized supply snapshot storage and replay.

The layer records and replays diagnostic-only snapshots for:

1. InvestorFlow sample acquisition summaries.
2. SemanticNetBuy normalized samples.
3. ProgramTrading stock/market samples.
4. SectorEnergy master/indexCode supply summaries.
5. Freshness dual-clock states.
6. Provider attempt summaries.
7. Operator action snapshot summaries.
8. FreshDataSupply domain summaries.

Snapshots are written to a bounded JSON store at `data/supply-snapshots/supply-snapshots.json` using atomic tmp-file replacement, capped retention, corrupt-row recovery, and try/catch isolation. Replay supports `LATEST`, `PREVIOUS_TRADING_DAY`, `BY_SCAN_ID`, `BY_DATE`, and `WINDOW` modes for observation, comparison, and learning diagnostics only.

## Guardrails

ADR-0491 is not a live execution ADR.

- It does not persist raw provider payloads.
- It stores only sanitized summaries: status, signal, confidence, coverage, freshness, provider, attempt counts, top gaps, recommended actions, related ADRs, and compact summaries.
- It does not change live execution, KIS orders, requiredScore, Gate thresholds, Gate weights, Kelly sizing, or live buy policy.
- Replayed snapshots must not feed live Gate decisions.
- Stored/replayed data must remain OBSERVE or SHADOW_ONLY.
- Replay does not auto-unblock STRONG_BUY.
- UNKNOWN remains UNKNOWN.
- Provider issues remain separated from market signals and are not converted to bearish signals.
- Stale, missing, or partial replay data is not bearish.
- Replay failure is isolated and must not stop scan, Shadow Learning, Runtime Pipeline Audit, or Telegram commands.
- Promotion beyond OBSERVE/SHADOW_ONLY requires a future ADR and explicit operator approval.

## Integrations

ADR-0491 supports these diagnostic consumers:

- ADR-0476 observation ledger records `SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491` rows.
- ADR-0484 supply coverage recovery can use replay as a diagnostic baseline only.
- ADR-0485 supply advisory readiness can use replayed observations as evidence only; it still cannot promote supply data.
- ADR-0487 FreshData output can include snapshot-store status.
- ADR-0480 Operator Action Queue maps write failure, replay unavailable, stale snapshot, and healthy store statuses.
- ADR-0478 compact `/scan_blockers` includes an ADR-0491 SupplySnapshot line.
- ADR-0479 detail registry exposes `/adr_trace 0491` metadata through the ADR-0491 registry entry.
- Runtime Pipeline Audit includes ADR-0491 status, retained count, replay availability, and `executionImpact=NONE` evidence.

## Consequences

Before ADR-0491, Fresh Data Supply samples were collected and displayed but not stored or replayed through a dedicated sanitized snapshot layer.

After ADR-0491:

- sanitized supply snapshots are recorded;
- latest, previous-day, scan-id, date, and window replay are available for diagnostics;
- ADR-0484 can use replay as a diagnostic baseline;
- ADR-0485 can use replay as readiness evidence only;
- `/scan_blockers` shows snapshot store status;
- FreshData/detail outputs can expose replay availability;
- live trading remains unchanged.

Final invariant: the engine remains alive, Shadow Learning continues, execution impact remains NONE, live execution remains unchanged, and ADR-0491 only stores and replays sanitized diagnostic supply snapshots — never raw payloads or live trading signals.
