# ADR-0462 — SectorEnergy SSOT + Fallback Contamination Guard + GateRouter Semantics Fix

**Status**: Accepted
**Date**: 2026-05-08
**Predecessors**: ADR-0371, ADR-0372, ADR-0373, ADR-0423, ADR-0425, ADR-0426, ADR-0427, ADR-0430, ADR-0433, ADR-0451.

---

## 1. Problem

SectorEnergy 반복 진단이 `dataQuality=DEGRADED`, 낮은 `indexCodeCoverage`, `symmetryValidation=FAILED`, `fallbackUsed=STOCK_DAILY`, `leadershipConfidence=BLOCKED`, `sectorBoost=0` 로 나타났다.
핵심 결함은 provider 하나가 아니라 indexCode, alias, provider cache, fallback, validation, scoring, GateRouter semantics 가 하나의 SSOT 없이 분산되어 데이터 결손이 시장 약세 또는 execution HARD_BLOCK 처럼 오해될 수 있다는 점이다.

## 2. Decision

ADR-0462는 SectorEnergy를 CORE 매매 판단에 무리하게 연결하지 않고, 다음 경계를 고정한다.

1. SectorIndexMaster SSOT로 canonical sector / alias / indexCode / proxy / sourceTier를 통합한다.
2. alias resolver와 symmetry validator를 순수 함수로 분리하여 unresolved alias, duplicate alias, aggregate ignored를 audit으로 남긴다.
3. coverage denominator는 SectorIndexMaster에서만 파생한다.
4. STOCK_DAILY fallback은 diagnostic only이며 leadership score, sectorBoost, executionHardBlock에 기여하지 않는다.
5. SectorEnergy low coverage는 STRONG_BUY를 차단할 수 있지만 전체 engine hard block으로 승격하지 않는다.
6. GateDecisionRouter는 SELL_ONLY, HARD_BLOCK, SOFT_DEGRADE, learning/counterfactual lanes, executionImpact를 분리한다.
7. Provider cache empty/stale/error는 market signal이 아니라 provider issue로 기록한다.
8. Telegram/operator audit은 leadership blocked와 execution hard block을 별도 필드로 출력한다.

## 3. Implementation

신규/정비 SSOT 모듈:

- `server/clients/sectorIndexMaster.ts` — ADR-0462 canonical master wrapper, `SectorSourceTier`, `SectorDataConfidence`, `SectorIndexMasterItem`.
- `server/clients/sectorAliasResolver.ts` — alias → canonical, indexCode reverse lookup, aggregate audit.
- `server/clients/sectorCoverage.ts` — sector/indexCode/alias/provider coverage denominator SSOT.
- `server/clients/sectorSymmetryValidator.ts` — side-effect-free symmetry validation.
- `server/clients/fallbackContaminationGuard.ts` — STOCK_DAILY fallback diagnostic-only guard.
- `server/clients/sectorEnergyScorer.ts` — coverage/sourceTier based scorer semantics.
- `server/clients/sectorProviderHealth.ts` — provider cache health and warmup helper.
- `server/clients/sectorEnergyAuditAdr0462.ts` — audit schema and Telegram formatter.
- `server/trading/signalScanner/gateDecisionRouter.ts` — SELL_ONLY severity, lanes, counterfactual lane, executionImpact output.

## 4. Invariants

- Trading Engine shutdown 금지.
- SectorEnergy DEGRADED는 confidence downgrade / STRONG_BUY block일 수 있으나 executionHardBlock은 아니다.
- STOCK_DAILY fallback contribution to leadership score is always 0.
- Provider issue와 market weakness를 같은 reason으로 기록하지 않는다.
- Shadow Learning과 Counterfactual Learning은 HARD_BLOCK/SELL_ONLY/provider failure에서도 유지한다.
- Gate1 survivor가 없어도 가능한 universe summary/counterfactual path를 유지한다.
- Denominator는 validator/scorer/router가 독자 생성하지 않는다.

## 5. Test Coverage

`server/clients/sectorEnergyAdr0462.test.ts`와 `server/trading/signalScanner/gateDecisionRouterAdr0462.test.ts`가 다음을 고정한다.

- stock daily fallback does not affect leadership score.
- stock daily fallback does not create sectorBoost.
- stock daily fallback does not force executionHardBlock.
- low index coverage blocks STRONG_BUY but does not hard block engine.
- symmetry validation passes/fails for canonical/duplicate aliases.
- aggregate ignored is counted without scorer crash.
- denominator consistency across coverage/scorer/audit.
- provider cache empty is provider issue, not market signal.
- counterfactual learning persists under HARD_BLOCK and SELL_ONLY.
- SectorEnergy DEGRADED keeps engine alive.
- leadershipBlocked and executionHardBlock remain distinct.
