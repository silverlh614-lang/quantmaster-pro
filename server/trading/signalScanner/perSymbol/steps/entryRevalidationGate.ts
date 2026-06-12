/**
 * @responsibility ADR-0019 entry revalidation gate extracted from buyListLoop.
 */

import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { logVisibilityEvent } from '../../../../utils/logger.js';
import { recordCounterfactual, COUNTERFACTUAL_DAILY_CAP } from '../../../../learning/counterfactualShadow.js';
import { recordRejection } from '../../../../learning/rejectionShadowTracker.js';
import { buildEntryConditionScores } from '../../../../learning/entryConditionScores.js';
import { evaluateServerGate } from '../../../../quantFilter.js';
import {
  applySectorScoreBoost,
  classifySectorTier,
  describeSectorBoost,
} from '../../../sectorScoreBoost.js';
import { getSectorByCode } from '../../../../screener/sectorMap.js';
import { getKstMarketElapsedMinutes } from '../../../entryEngine.js';
import { shouldIncrementFailCount } from '../../failureClassifier.js';
import { entryRevalidationStep } from '../../revalidationSteps/index.js';
import { isGate1RegimeAwareShadowEntryEnabled } from '../../../gate1ShadowEntryThreshold.js';
import type { BuyListLoopContext } from '../types.js';

export interface EntryRevalidationSkippedBatchItem {
  symbol: string;
  score?: number;
  reasons: string[];
}

/**
 * ADR-0608: 진입 재검증 게이트 결과. decision 은 기존 SKIP/CONTINUE 제어 흐름 보존,
 * entryThresholdMode 는 proceed(CONTINUE) 시 buildBuyTrade 스탬프용 라벨 carry.
 * 미설정(후방호환) = LEGACY 표본.
 */
export interface EntryRevalidationGateResult {
  decision: 'SKIP' | 'CONTINUE';
  entryThresholdMode?: import('../../../gate1ShadowEntryThreshold.js').EntryThresholdMode;
}

type ReCheckQuote = {
  dayOpen?: number;
  prevClose?: number;
  volume?: number;
  avgVolume?: number;
} | null;

export async function handleEntryRevalidationGate(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  gateResult: ReturnType<typeof evaluateServerGate> | null,
  conditionScores: ReturnType<typeof buildEntryConditionScores>,
  currentPrice: number,
  reCheckQuote: ReCheckQuote,
  stageLog: Record<string, string>,
  pushTrace: () => void,
  entryRevalidationSkippedBatch: EntryRevalidationSkippedBatchItem[],
  // ADR-0608: stockShadowMode — SHADOW(paper) 진입 경로 식별. ENV ON 시에만 진입 임계
  // regime-aware 분기. 후방호환: 미전달 시 false → LIVE legacy byte-equivalent.
  stockShadowMode = false,
): Promise<EntryRevalidationGateResult> {
  const sectorEnergyResult = ctx.macroState?.sectorEnergyResult ?? null;
  const sectorEnergyDataQuality = ctx.macroState?.sectorEnergyDataQuality;
  // ADR-0060: stock.sector 부재 시 getSectorByCode fallback (sectorConcentrationGate 동일 정책)
  const stockSectorLabel = stock.sector ?? getSectorByCode(stock.code);
  // ADR-0488: sectorBoostAllowed=false 종목(섹터인덱스 씨드 등)은 boost 차단
  const isSectorBoostAllowed = (stock as { sectorBoostAllowed?: boolean }).sectorBoostAllowed !== false;
  const sectorBoost = isSectorBoostAllowed
    ? applySectorScoreBoost(stockSectorLabel, sectorEnergyResult, ctx.regime, sectorEnergyDataQuality)
    : 0;
  const sectorBoostReason = sectorBoost !== 0 && stockSectorLabel && sectorEnergyResult
    ? describeSectorBoost(
        stockSectorLabel,
        sectorBoost,
        classifySectorTier(stockSectorLabel, sectorEnergyResult),
        ctx.regime,
      )
    : undefined;

  // ADR-0608 Phase 2: minGate 산출 전용 regime. ENV ON && SHADOW(paper) 일 때만
  // learningRegime(R6 회복 누수로 ctx.regime 이 R4_NEUTRAL 로 clamp 돼도 정규 R3_EARLY)
  // 을 진입 임계에 적용. 그 외(LIVE 또는 ENV OFF) → ctx.regime 그대로 → byte-equivalent.
  // entryRegime 만 분기하고 step input.regime(macroRegime/진단)은 ctx.regime 무변경.
  const entryRegime = isGate1RegimeAwareShadowEntryEnabled() && stockShadowMode
    ? (ctx.learningRegime ?? ctx.regime)
    : ctx.regime;

  const revalResult = entryRevalidationStep({
    stockName: stock.name,
    currentPrice,
    entryPrice: stock.entryPrice,
    reCheckQuote,
    reCheckGate: gateResult,
    regime: ctx.regime,
    entryRegime,
    marketSessionState: ctx.resolvedMarketSessionState,
    marketElapsedMinutes: getKstMarketElapsedMinutes(),
    sectorBoost,
    sectorBoostReason,
    isShadow: stockShadowMode,
  });
  if (!revalResult.proceed) {
    const policySkipped = revalResult.stageLogValue === 'SKIPPED_POLICY_BLOCK';
    if (policySkipped) {
      entryRevalidationSkippedBatch.push({
        symbol: stock.name,
        score: gateResult?.gateScore,
        reasons: revalResult.failReasons,
      });
    }
    logVisibilityEvent({
      visibility: policySkipped ? 'TRACE' : 'SUMMARY',
      message: revalResult.logMessage,
      category: 'GATE',
      sourceCommand: '/scan',
      dedupKey: `ENTRY_REVALIDATION:${revalResult.stageLogValue}:${ctx.resolvedMarketSessionState ?? 'UNKNOWN'}:NONE`,
      summary: {
        stock: stock.name,
        stageLogValue: revalResult.stageLogValue,
        marketSessionState: ctx.resolvedMarketSessionState ?? 'UNKNOWN',
        executionImpact: 'NONE',
      },
      details: { stockCode: stock.code, stockName: stock.name, failReasons: revalResult.failReasons },
      level: 'info',
      executionImpact: 'NONE',
    });
    if (shouldIncrementFailCount('GATE_REVALIDATION_FAIL')) {
      stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
      ctx.mutables.watchlistMutated.value = true;
    }
    ctx.scanCounters.gateMisses++;
    if (revalResult.waitReason === 'DATA_HOLD') {
      ctx.scanCounters.waitDataHold++;
    } else {
      ctx.scanCounters.waitGateFail++;
    }
    stageLog.gate = revalResult.stageLogValue;
    pushTrace();

    if (ctx.scanCounters.counterfactualRecordedToday < COUNTERFACTUAL_DAILY_CAP) {
      try {
        const recorded = recordCounterfactual({
          stockCode: stock.code,
          stockName: stock.name,
          priceAtSignal: currentPrice,
          gateScore: stock.gateScore ?? 0,
          regime: ctx.regime,
          conditionKeys: stock.conditionKeys ?? [],
          skipReason: `entryRevalidation:${revalResult.failReasons.join(',')}`,
        });
        if (recorded) ctx.scanCounters.counterfactualRecordedToday++;
      } catch (e) {
        console.warn(`[Counterfactual] record ?ㅽ뙣 ${stock.code}:`, e instanceof Error ? e.message : e);
      }
    }

    try {
      const kstDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
      const rejectionConditionScores = conditionScores || buildEntryConditionScores(stock.conditionKeys);
      recordRejection({
        stockCode: stock.code,
        stockName: stock.name,
        signalDate: kstDate,
        signalPriceKrw: currentPrice,
        gateScore: stock.gateScore ?? 0,
        rejectionReason: `entryRevalidation:${revalResult.failReasons.join(',')}`,
        conditionScores: rejectionConditionScores,
      });
    } catch (e) {
      console.warn(`[RejectionShadow] record ?ㅽ뙣 ${stock.code}:`, e instanceof Error ? e.message : e);
    }
    return { decision: 'SKIP' };
  }
  // ADR-0608: proceed 시 진입 임계 모드 라벨 carry → buildBuyTrade 스탬프.
  return { decision: 'CONTINUE', entryThresholdMode: revalResult.entryThresholdMode };
}
