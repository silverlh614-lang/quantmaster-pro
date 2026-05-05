/**
 * @responsibility 종목 단위 진입 검증 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가
 */
import type { ScanCounters } from './scanDiagnostics.js';
import { getSectorByCode } from '../../screener/sectorMap.js';
import { isOpenShadowStatus } from '../entryEngine.js';
import { decideProbingSlotBudget, buildArmKey, type BanditDecision } from '../../learning/probingBandit.js';
import { saveWatchlist } from '../../persistence/watchlistRepo.js';
import type { ApprovalQueueState } from './approvalQueue.js';
import type { RunAutoSignalScanOptions } from './index.js';

// ADR-0134: barrel exports 복원
// ADR-0188 (lint baseline cleanup): perSymbol/index.ts 의 SSOT 통합 barrel 을 그대로 re-export.
// 이전엔 buyListLoop + intradayLoop 만 re-export 하여 helpers.SymbolExitContext + types.BuyListLoopMutables/
// IntradayLoopMutables/BuyListLoopContext/IntradayLoopContext 가 누락 — entryGates/types.ts +
// approvalQueue/applyApprovalReservation.ts + signalScanner.ts 의 import 경로 단절.
import { evaluateBuyList as executeBuyList } from './perSymbol/buyListLoop.js';
import { evaluateIntradayList as executeIntradayList } from './perSymbol/intradayLoop.js';
export * from './perSymbol/index.js';

export async function evaluateMainCandidates(
  candidates: any,
  context: any,
  counters: ScanCounters,
  queueState: ApprovalQueueState
): Promise<void> {
  const { buyList, swingList } = candidates;
  const {
    watchlist, shadows, shadowMode, totalAssets, effectiveMaxPositions,
    regime, regimeConfig, macroState, vixGating, fomcProximity,
    kellyMultiplier, accountKellyMultiplier, sellOnlyExc, volumeClock,
    conditionWeights, supplyHealthSnapshot
  } = context;

  const _banditCandidateArms: string[] = [];
  for (const w of buyList) {
    const sig = (w.gateScore ?? 0) >= 9 ? 'STRONG_BUY' : 'BUY';
    _banditCandidateArms.push(buildArmKey({ signalType: sig, profileType: w.profileType ?? null }));
  }
  _banditCandidateArms.push('PROBING:X');
  const banditDecision: BanditDecision = decideProbingSlotBudget(_banditCandidateArms);
  if (banditDecision.budget > 1) {
    console.log(
      `[AutoTrade/Bandit] PROBING 동적 예산 ×${banditDecision.budget} (base 1) — ${banditDecision.rationale}`,
    );
  }

  for (const s of shadows) {
    if (!isOpenShadowStatus(s.status) || s.watchlistSource === 'INTRADAY') continue;
    const sec = getSectorByCode(s.stockCode) || '미분류';
    const val = s.shadowEntryPrice * s.quantity;
    queueState.currentSectorValue.set(sec, (queueState.currentSectorValue.get(sec) ?? 0) + val);
  }

  let watchlistMutated = false;
  const _reservedSlotsBox = { value: queueState.reservedSlots };
  const _probingReservedSlotsBox = { value: queueState.probingReservedSlots };
  const _orderableCashBox = { value: queueState.orderableCash };
  const _watchlistMutatedBox = { value: watchlistMutated };

  await executeBuyList({
    buyList,
    swingList,
    watchlist,
    shadows,
    shadowMode,
    totalAssets,
    effectiveMaxPositions,
    regime,
    regimeConfig,
    macroState,
    vixGating,
    fomcProximity,
    kellyMultiplier,
    accountKellyMultiplier,
    banditDecision,
    sellOnlyExc,
    volumeClock,
    conditionWeights,
    supplyHealthSnapshot,
    scanCounters: counters,
    mutables: {
      liveBuyQueue: queueState.liveBuyQueue,
      reservedSlots: _reservedSlotsBox,
      probingReservedSlots: _probingReservedSlotsBox,
      reservedTiers: queueState.reservedTiers,
      reservedIsMomentum: queueState.reservedIsMomentum,
      reservedBudgets: queueState.reservedBudgets,
      reservedSectorValues: queueState.reservedSectorValues,
      pendingSectorValue: queueState.pendingSectorValue,
      currentSectorValue: queueState.currentSectorValue,
      orderableCash: _orderableCashBox,
      watchlistMutated: _watchlistMutatedBox,
    },
  });

  queueState.reservedSlots = _reservedSlotsBox.value;
  queueState.probingReservedSlots = _probingReservedSlotsBox.value;
  queueState.orderableCash = _orderableCashBox.value;
  queueState.watchlistMutated = _watchlistMutatedBox.value;
}

export async function evaluateIntradayCandidates(
  candidates: any,
  context: any,
  counters: ScanCounters,
  queueState: ApprovalQueueState,
  options?: RunAutoSignalScanOptions
): Promise<void> {
  const { intradayList: intradayBuyList } = candidates;
  const {
    watchlist, shadows, shadowMode, totalAssets, accountKellyMultiplier,
    kellyMultiplier, regime, regimeConfig, macroState, conditionWeights, supplyHealthSnapshot
  } = context;

  const intradayMutables = { orderableCash: { value: queueState.orderableCash } };
  await executeIntradayList({
    intradayBuyList, shadows, shadowMode, totalAssets, accountKellyMultiplier,
    kellyMultiplier, regime, regimeConfig, macroState, conditionWeights,
    supplyHealthSnapshot,
    options: options ?? {},
    scanCounters: counters,
    mutables: intradayMutables,
  });
  queueState.orderableCash = intradayMutables.orderableCash.value;

  if (queueState.watchlistMutated) {
    saveWatchlist(watchlist);
  }
}