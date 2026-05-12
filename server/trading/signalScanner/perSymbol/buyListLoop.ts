/**
 * @responsibility 메인 buyList 루프 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가
 *
 * ADR-0134 (PR-Refactor-2) — perSymbolEvaluation.ts 분해 시 evaluateBuyList 격리.
 * signalScanner.ts L528~L1456 (929줄) 와 100% 동작 일치 (byte-equivalent 이주).
 */

import { fetchKisInvestorTradeByStockDaily } from '../../../clients/kisClient.js';
import { logger, logNoiseDetail } from '../../../utils/logger.js';
import type { MacroState } from '../../../persistence/macroStateRepo.js';

import type { ServerShadowTrade, EntryKellySnapshot } from '../../../persistence/shadowTradeRepo.js';
import { appendShadowLog } from '../../../persistence/shadowTradeRepo.js';
import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import { isBlacklisted } from '../../../persistence/blacklistRepo.js';
import { loadKellyDampenerState } from '../../kellyDampener.js';
import { sendTelegramAlert } from '../../../alerts/telegramClient.js';
import { channelBuySignalEmitted } from '../../../alerts/channelPipeline.js';
import {
  RRR_MIN_THRESHOLD, MAX_SECTOR_CONCENTRATION,
  calcRRR,
} from '../../riskManager.js';
import { evaluatePortfolioRisk } from '../../portfolioRiskEngine.js';
import { checkSectorExposureBefore } from '../../preOrderGuard.js';
import { getSectorByCode } from '../../../screener/sectorMap.js';
import { getExecutionCostConfig } from '../../executionCosts.js';
import { classifySizingTier, PROBING_MAX_SLOTS } from '../../sizingTier.js';
import {
  canReserveBanditProbingSlot,
  type BanditDecision,
} from '../../../learning/probingBandit.js';
import { checkFailurePattern } from '../../../learning/failurePatternDB.js';
import { buildEntryConditionScores } from '../../../learning/entryConditionScores.js';
import { evaluateCorrelationGate } from '../../correlationSlotGate.js';
import { recordCounterfactual, COUNTERFACTUAL_DAILY_CAP } from '../../../learning/counterfactualShadow.js';
import { recordUniverseEntries } from '../../../learning/ledgerSimulator.js';
import { computeSlotConsumption } from '../../slotAccounting.js';
// ADR-0068 (PR-R): Shadow Learning Hooks — PR-L (Rejection Tracker) + PR-M (Twin Portfolio) wiring
import { recordRejection } from '../../../learning/rejectionShadowTracker.js';
import { recordTwinEntries } from '../../../learning/counterfactualTwinPortfolio.js';
import type { FullRegimeConfig } from '../../../../src/types/core.js';
import { REGIME_CONFIGS } from '../../../../src/services/quant/regimeEngine.js';
import { addRecommendation } from '../../../learning/recommendationTracker.js';
import { recordAiCandidate, buildSignalId } from '../../../persistence/tradeSignalStatusRepo.js';
import { getAccountRiskBudget, computeRiskAdjustedSize, FRACTIONAL_KELLY_CAP } from '../../accountRiskBudget.js';
import { evaluateServerGate } from '../../../quantFilter.js';
import {
  applyEntryPriceDrift,
  CATALYST_POSITION_FACTOR, CATALYST_FIXED_STOP_PCT,
} from '../../../screener/watchlistManager.js';
import { fetchYahooQuote, fetchKisQuoteFallback, enrichQuoteWithKisMTAS, fetchKisIntraday } from '../../../screener/stockScreener.js';
import { fetchYahooQuoteByCode } from '../../../screener/adapters/yahooSymbolResolver.js';
import { fillMonitor } from '../../fillMonitor.js';
import { trancheExecutor } from '../../trancheExecutor.js';
import { ENTRY_GATES_PHASE_B } from '../entryGates/index.js';
import {
  entryRevalidationStep,
  kisIntradayCorrectionStep,
  yahooAvailabilityStep,
  mtasGateStep,
  sellOnlyExceptionStep,
} from '../revalidationSteps/index.js';
import {
  applySectorScoreBoost,
  classifySectorTier,
  describeSectorBoost,
} from '../../sectorScoreBoost.js';
// ADR-0400: STRONG_BUY 4 조건 OR confidence gate wiring (ADR-0398 dead code 종결).
import {
  evaluateSectorEnergyStrongBuyGate,
  isSectorEnergyStrongBuyGateWiringDisabled,
} from '../../sectorEnergyStrongBuyGate.js';
import { evaluateDataQualityFromStock } from '../../priceSourcePolicy.js';
import {
  sizingTierDecider,
  kellyBudgetDecider,
  stopLossPolicyResolver,
} from '../sizingDeciders/index.js';
import { applyApprovalReservation } from '../approvalQueue/index.js';
import {
  isEntryPriceAutoCorrectDisabled,
  isPreBreakoutFailCountDisabled,
  shouldIncrementFailCount,
} from '../failureClassifier.js';
// ADR-0128 §Wiring 1+2 — DataHoldRolePolicy SSOT 위임 + verifyStockIncremental BUY_CANDIDATE.
import { verifyStockIncremental } from '../../../data/dataVerificationIncremental.js';
import { resolveDataHoldAction } from '../../../data/dataHoldRolePolicy.js';
// ADR-0191 §Wiring 2 — 자기 보유 가드 SSOT (positionTruth) — 동일 종목 12회 매수 (물타기) 차단.
import { loadOpenPositions } from '../../../persistence/positionTruth.js';
import {
  isOpenShadowStatus,
  buildStopLossPlan,
  formatStopLossBreakdown,
  calculateOrderQuantity,
  getKstMarketElapsedMinutes,
} from '../../entryEngine.js';
import { type ApprovalAction } from '../../../telegram/buyApproval.js';
import { checkCooldownRelease } from '../../regretAsymmetryFilter.js';
import { detectPreBreakoutAccumulation } from '../../preBreakoutAccumulationDetector.js';
// ADR-0449 — Pre-Breakout WAIT 7-state Liveness Policy.
import { evaluatePreBreakoutWait } from '../preBreakoutWaitPolicy.js';
import { getKstIntradaySession } from '../emptyScanTaxonomy.js';
// ADR-0450 — Pre-Breakout WAIT decision → KIS-WS priority routing SSOT.
import { routePreBreakoutWaitToKisWs } from '../preBreakoutKisWsPriorityRouting.js';

// ADR-0452 — Shadow Entry Liveness for Near-Breakout Candidates SSOT.
//   Live 매수 조건 무변경 + Shadow virtual buy 만 near-breakout 후보에 허용.
//   executionImpact: 'NONE' literal type 강제.
import {
  evaluateShadowNearBreakoutEntry,
  type ShadowNearBreakoutBlockReason,
} from '../shadowNearBreakoutEntryPolicy.js';
import { saveShadowTrades } from '../../../persistence/shadowTradeRepo.js';
// ADR-0450 — KIS-WS subscription priority queue 단일 진입점 (ADR-0437).
import { requestKisWsSubscription } from '../../../clients/kisWebSocketSubscriptionManager.js';
import { getDartFinancials } from '../../../clients/dartFinancialClient.js';
import {
  computeMtasMultiplier,
  computeRawPositionPct,
  fetchGateData,
  buildBuyTrade,
  createBuyTask,
  type LiveBuyTask,
} from '../../buyPipeline.js';
import {
  setLastBuySignalAt,
  accumulateFreshConditionOutputs,
  accumulateGate2ConditionOutputs,
  accumulateGateEligibility,
  accumulateGateScoreCandidateBucket,
  accumulateGateScoreHealth,
  accumulateGateLayerSummary,
  recordPipelineStage,
  accumulateNearMissOutcomeLedgerWrite,
  accumulateGateReclassificationDryRun,
  accumulatePositiveScoreStarvation,
} from '../scanDiagnostics.js';
// ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE).
//   분류 layer 만 — KIS 주문 호출 0건. 결과 ScanCounters 누적 only,
//   실제 매수 흐름 변경 0 (counterfactual ledger wiring 은 후속 PR scope).
import { classifyGateEligibility } from '../gateEligibilityClassifier.js';
// ADR-0427 — R3_EARLY Provisional Shadow Lane wiring.
//   ADR-0426 SSOT (deriveR3ProvisionalShadowCandidate) 호출 + provisionalShadowLedger 영속.
//   LIVE 매매 본체 0줄 변경, KIS 주문 import 0건. Gate1 survivor 분기 직후 try/catch 격리.
import { deriveR3ProvisionalShadowCandidate } from '../provisionalShadowLane.js';
import { recordR3ProvisionalShadowCandidate } from '../../../persistence/provisionalShadowLedger.js';
// ADR-0430 — Counterfactual Shadow Learning Lane (SELL_ONLY/HARD_BLOCK fallback).
//   ADR-0427 provisional null 반환 시점 (HARD_BLOCK 등) 에 학습 전용 record 영속.
//   별도 ledger (counterfactual-shadow-learning-ledger.json), virtual account 무관,
//   KIS 주문 함수 import 0건. learning-only 마커 명시.
import { deriveCounterfactualShadowLearningCandidate } from '../counterfactualShadowLearningLane.js';
import { appendCounterfactualShadowLearningEntry } from '../../../persistence/counterfactualShadowLearningRepo.js';
import { deriveGateDecisionRouterResult } from '../gateDecisionRouter.js';
import { getRegimeGateBand } from '../../gateConfig.js';
import { getPrice, FAILURE_BLOCK_THRESHOLD_PCT, getAdaptiveProfitTargets, buildExposureBudgetMacroInput, computeSizingLiquidityInputs, type SymbolExitContext } from './helpers.js';
import type { BuyListLoopContext } from './types.js';
// ADR-0162 Phase 2-D — SHADOW only 사이징 엔진 wiring (default OFF, ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 명시 활성화).
import { applyPositionSizingEngine, applyExposureBudgetCap } from '../../sizing/positionSizingEngineWiring.js';
// ADR-0167 — currentEquityExposureAmount 정확 산출 SSOT (default OFF, ENV `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED=true` 활성화).
import { resolveCurrentEquityExposure } from '../../sizing/currentEquityExposure.js';
// ADR-0171 — Sizing-ExposureBudget 진단 로그 10 필드 SSOT formatter (default OFF, ENV `SIZING_EXPOSURE_BUDGET_VERBOSE_LOG=true` 명시 활성화).
import { formatExposureBudgetLog } from '../../sizing/regimeExposurePolicy.js';
import {
  applySupplyHealthToSignal,
  createLearningSampleFromDecision,
  determineExecutionMode,
  type TradingSignal,
} from '../../../learning/supplyHealthLearning.js';
import { appendLearningSample } from '../../../persistence/learningSampleRepo.js';
import { recordNearMissOutcome } from '../../../persistence/nearMissOutcomeLedger.js';
import {
  evaluateGateReclassificationDryRun,
  isGateReclassificationDryRunDisabled,
} from '../../../learning/gateReclassificationDryRun.js';
import { loadGateReclassificationApprovalPlan } from '../../../learning/gateReclassificationApprovalPlan.js';
import {
  buildGateReclassificationDryRunId,
  upsertGateReclassificationDryRunRecord,
} from '../../../persistence/gateReclassificationDryRunRepo.js';
import { buildGate1ScoreStarvationTraceFromGateResult } from '../gate1PositiveScoreStarvation.js';

function kstDecisionDate(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function recordSupplyHealthLearningSample(params: {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  rawSignal: TradingSignal;
  rawScore: number;
  requestedSize: number;
  ctx: BuyListLoopContext;
}): void {
  const snapshot = params.ctx.supplyHealthSnapshot;
  if (!snapshot) return;
  try {
    appendLearningSample(createLearningSampleFromDecision({
      symbol: params.stockCode,
      name: params.stockName,
      market: 'UNKNOWN',
      date: kstDecisionDate(),
      currentPrice: params.currentPrice,
      rawSignal: params.rawSignal,
      rawScore: params.rawScore,
      positionSize: params.requestedSize,
      supplyHealthSnapshot: snapshot,
    }));
  } catch (e) {
    console.warn('[SupplyHealthLearning] sample append failed:', e);
  }
}

function applyBuySupplyHealthPolicy(params: {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  rawSignal: TradingSignal;
  rawScore: number;
  requestedSize: number;
  shadowMode: boolean;
  ctx: BuyListLoopContext;
}): {
  blocked: boolean;
  shadowMode: boolean;
  finalQuantity: number;
  finalSignal: TradingSignal;
  healthDecision?: ReturnType<typeof applySupplyHealthToSignal>;
} {
  const snapshot = params.ctx.supplyHealthSnapshot;
  if (!snapshot) {
    return {
      blocked: false,
      shadowMode: params.shadowMode,
      finalQuantity: params.requestedSize,
      finalSignal: params.rawSignal,
    };
  }

  const healthDecision = applySupplyHealthToSignal({
    rawSignal: params.rawSignal,
    rawScore: params.rawScore,
    positionSize: params.requestedSize,
    supplyHealthSnapshot: snapshot,
  });
  recordSupplyHealthLearningSample(params);
  const executionMode = determineExecutionMode({
    rawSignal: params.rawSignal,
    finalSignal: healthDecision.finalSignal,
    dataConfidence: healthDecision.dataConfidence,
    overallStatus: snapshot.summary.overallStatus,
    wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
  });
  if (executionMode === 'BLOCKED' || executionMode === 'WATCHLIST') {
    console.log(`[AutoTrade/SupplyHealth] ${params.stockName}(${params.stockCode}) ${executionMode} by supply_health`);
    return {
      blocked: true,
      shadowMode: params.shadowMode,
      finalQuantity: 0,
      finalSignal: healthDecision.finalSignal,
      healthDecision,
    };
  }
  return {
    blocked: false,
    shadowMode: executionMode === 'SHADOW' ? true : params.shadowMode,
    finalQuantity: Math.max(0, Math.floor(healthDecision.positionSizeAfterHealth ?? params.requestedSize)),
    finalSignal: healthDecision.finalSignal,
    healthDecision,
  };
}

const PRE_ENTRY_WAIT_DEDUPE_MS = 30 * 60 * 1000;
const preEntryWaitLogLastEmittedAt = new Map<string, number>();

export function resetPreEntryWaitLogDedupeForTest(): void {
  preEntryWaitLogLastEmittedAt.clear();
}

export function buildPreEntryWaitDedupeKey(input: {
  tradeDate: string;
  session: string;
  stockCode: string;
  entryPrice: number;
  reason: string;
}): string {
  return `PRE_ENTRY_WAIT:${input.tradeDate}:${input.session}:${input.stockCode}:${input.entryPrice}:${input.reason}`;
}

export function shouldEmitPreEntryWaitLog(
  key: string,
  nowMs = Date.now(),
  dedupeMs = PRE_ENTRY_WAIT_DEDUPE_MS,
): boolean {
  const last = preEntryWaitLogLastEmittedAt.get(key) ?? 0;
  if (last > 0 && nowMs - last < dedupeMs) return false;
  preEntryWaitLogLastEmittedAt.set(key, nowMs);
  return true;
}

function currentKstTradeDate(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function logPreEntryWaitDebug(input: {
  stockName: string;
  stockCode: string;
  entryPrice: number;
  message: string;
  reason: string;
  nowMs?: number;
}): void {
  const nowMs = input.nowMs ?? Date.now();
  const key = buildPreEntryWaitDedupeKey({
    tradeDate: currentKstTradeDate(nowMs),
    session: getKstIntradaySession(nowMs),
    stockCode: input.stockCode,
    entryPrice: input.entryPrice,
    reason: input.reason,
  });
  if (shouldEmitPreEntryWaitLog(key, nowMs)) {
    logNoiseDetail({
      category: 'PRE_ENTRY_WAIT',
      message: `${input.message} actionable=false executionImpact=NONE telegram=false dedupeKey=${key}`,
    });
  }
}

export async function evaluateBuyList(ctx: BuyListLoopContext): Promise<void> {
  for (const stock of ctx.buyList) {
    // Idea 1 — MOMENTUM 은 AUTO_SHADOW_FROM_MOMENTUM 경로에서 강제 SHADOW 로 귀속된다.
    // LIVE 모드 스캔 중에도 MOMENTUM 후보는 실 자본을 쓰지 않고 학습 표본만 남긴다.
    // 이 플래그가 true 인 스톡은 슬롯/섹터/오더 현금 예약에서 제외된다.
    const isMomentumShadow = stock.section === 'MOMENTUM';
    let stockShadowMode = ctx.shadowMode || isMomentumShadow;

    // 아이디어 7: 루프 내에서도 포지션 수 재확인 (같은 스캔 중 복수 진입 방지)
    // BUG-09 정합성: 사전 점검(activeSwingCount)이 PRE_BREAKOUT(30% 선취매)을 제외하는 것과
    // 동일 기준을 적용해야 한다. 루프 내에서만 PRE_BREAKOUT을 포함하면 사전 점검은 "여유 있음",
    // 루프는 "만석"이라 판정해 보유 슬롯이 남았음에도 매수가 전혀 발생하지 않는 무성 실패가 난다.
    //
    // ADR-0080 PR-S1: 게이트 비교는 자본 가중 슬롯(consumed) 사용 — 30% 잔존 5개 = 1.5 슬롯
    // 점유로 환산해 만재 차단을 회피. 단, sizing 분모(line ~902 remainingSlots)는 PR-S2 까지
    // currentActive(rawCount) 유지 — 분할 비율 영향이라 shadow mode 1주 검증 후 분리 적용.
    const slotResult = computeSlotConsumption(ctx.shadows, ctx.effectiveMaxPositions);
    const currentActive = slotResult.rawCount;        // sizing 분모용 (PR-S2 후속 변경 대상)
    const totalCommitted = slotResult.consumed + ctx.mutables.reservedSlots.value;
    if (!isMomentumShadow && totalCommitted >= ctx.effectiveMaxPositions) {
      // MOMENTUM Shadow 는 LIVE 슬롯 한도에 귀속되지 않으므로 이 가드를 건너뛴다.
      console.log(
        `[AutoTrade] 최대 포지션 도달 (활성 ${slotResult.consumed.toFixed(2)} + 예약 ${ctx.mutables.reservedSlots.value} = ${totalCommitted.toFixed(2)}/${ctx.effectiveMaxPositions}${ctx.sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${ctx.regime}, raw=${slotResult.rawCount}) — 나머지 종목 스킵`,
      );
      break;
    }

    try {
      const stageLog: Record<string, string> = {};
      const pushTrace = () => ctx.scanCounters.pendingTraces.push({
        ts: new Date().toISOString().slice(11, 19),
        stock: stock.code,
        name:  stock.name,
        stages: { ...stageLog },
      });

      const currentPrice = await getPrice(stock.code);
      if (!currentPrice) { stageLog.price = 'FAIL'; pushTrace(); continue; }
      stageLog.price = 'PASS';

      // ADR-0120 (PR-B): Gate 1/2/3 통과 카운터 누적 — emptyScanClassifier
      // NO_LEADERSHIP / NO_TIMING 분기 입력 데이터 제공 + R3 Sanity Check 입력.
      // stock.gateEvaluation 은 enrichment 단계에서 사전 산출된 값 (StockRecommendation
      // 에 정의되어 있으나 WatchlistEntry 에는 부재). inline cast 로 영속 schema
      // 변경 회피. try/catch 격리 — throw 시 LIVE 매매 흐름 무중단.
      //
      // ADR-0211 (P0 응급 패치): WatchlistEntry 에는 gateEvaluation 이 영속되지
      // 않아 ge?.gate1Passed 가 항상 undefined → gate1Pass 카운터 영구 0 →
      // R3 Sanity Check (GATE1_PASS_ZERO) false positive 로 latch 활성 →
      // 신규 매수 영구 차단. 폴백: stock.gateScore ≥ 5.0 (evaluateServerGate
      // SWING/STRONG_BUY 임계 정합) 시 Gate 1 통과 추정.
      try {
        const ge = (stock as { gateEvaluation?: { gate1Passed?: boolean; gate2Passed?: boolean; gate3Passed?: boolean } }).gateEvaluation;
        if (ge?.gate1Passed) {
          ctx.scanCounters.gate1Pass++;
        } else if (typeof stock.gateScore === 'number' && stock.gateScore >= 5.0) {
          // ADR-0211 폴백: gateEvaluation 미영속 시 gateScore ≥ 5.0 으로 Gate 1 통과 추정
          ctx.scanCounters.gate1Pass++;
        }
        if (ge?.gate2Passed) ctx.scanCounters.gate2Pass++;
        if (ge?.gate3Passed) ctx.scanCounters.gate3Pass++;
      } catch (e) {
        console.warn('[ADR-0120] Gate pass 카운터 누적 실패:', e);
      }

      // ADR-0068 (PR-R): Twin Portfolio 학습 hook — 모든 candidate 를 3 Twin 정책 평가.
      // recordTwinEntries 가 Gate Score 별 정책 (AGGRESSIVE ≥14 / DISCIPLINED ≥22 /
      // EQUAL_WEIGHT ≥18) 평가 후 통과한 Twin 만 영속. 멱등 dupKey 로 중복 차단.
      // try/catch 격리 — throw 시 LIVE 매매 흐름 무중단.
      try {
        const kstDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
        recordTwinEntries({
          stockCode: stock.code,
          stockName: stock.name,
          signalDate: kstDate,
          gateScore: stock.gateScore ?? 0,
          entryPrice: currentPrice,
          // PR-R 본 PR scope: 0.10 균등 weight (sizingDecider 결과 입력은 후속 wiring)
          kellyWeight: 0.10,
        });
      } catch (e) {
        console.warn(`[TwinPortfolio] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
      }

      // ── entryPrice 드리프트 체크: 현재가가 10% 이상 올랐으면 갱신/제거 ─────
      const driftAction = applyEntryPriceDrift(stock, currentPrice);
      // ADR-0117: DATA_HOLD — drift sanity 위반 (60~150% 추정) → 거래 차단 게이트.
      // ADR-0128 §Decision §1: BUY_CANDIDATE role SSOT 위임. dataQuality 영속 본체는 보존.
      // entry.entryPrice 갱신 금지 + isDataQuarantined=true + dataQuality 영속.
      // failCount 미증가 (NON_CRITICAL — 다음 사이클 재시도 가능).
      if (driftAction === 'DATA_HOLD') {
        const action = resolveDataHoldAction('BUY_CANDIDATE');
        const absDriftPct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
        const reason = `[watchlistManager.drift:${stock.code}] sanity violation absPct=${absDriftPct.toFixed(2)}% > 90% current=${currentPrice}, base=${stock.entryPrice}`;
        // BUY_CANDIDATE 의 uiMarker='NONE' 이지만 보수적으로 영속 마커 유지 (다음 batch 가 정리)
        if (action.blockBuy) {
          stock.isDataQuarantined = true;
          stock.dataQuality = {
            status: 'STALE_BASE_OR_SPLIT_ADJUSTMENT',
            reason,
            current: currentPrice,
            base: stock.entryPrice,
            source: 'KIS_REALTIME',
            context: `watchlistManager.drift:${stock.code}`,
            updatedAt: new Date().toISOString(),
          };
        }
        ctx.mutables.watchlistMutated.value = true;
        console.warn(`[WatchlistManager] drift update skipped: ${reason}`);
        // ADR-0128 §Decision §1: action.reason SSOT 정합 (운영자 진단 텍스트).
        console.log(`[AutoTrade] ${stock.name}(${stock.code}) → WAIT / DATA_HOLD / ${action.reason}`);
        stageLog.drift = 'DATA_HOLD';
        ctx.scanCounters.waitDataHold++;  // ADR-0118
        pushTrace();
        continue;
      }
      // ADR-0115: drift > 150% Corporate Action 의심 — RAW immutable 원칙 준수.
      // entryPrice 자동 재설정 *제거* (ADR-0113 의 자동 보정 정책 폐기).
      // 사용자 절대 원칙: "RAW PRICE 는 절대 수정 금지."
      // 처리: 진단 텔레그램 + universe 제외 (다음 영업일 운영자 검토 후 수동 재진입).
      // ENV ENTRY_PRICE_AUTO_CORRECT_DISABLED=false 명시 시에만 ADR-0113 동작 복원.
      if (driftAction === 'CORPORATE_ACTION') {
        const oldEntry = stock.entryPrice;
        const driftPctText = (((currentPrice - oldEntry) / oldEntry) * 100).toFixed(1);
        if (isEntryPriceAutoCorrectDisabled()) {
          // 정책 적용 (default) — entryPrice 보존 + universe 제외.
          console.warn(
            `[AutoTrade] 🔧 ${stock.name}(${stock.code}) Corporate Action 의심 ` +
            `(drift ${driftPctText}%) — entryPrice ${oldEntry.toLocaleString()} 보존 (RAW immutable, ADR-0115). ` +
            `universe 제외 + DART 조회 권고.`,
          );
          try {
            const { sendTelegramAlert } = await import('../../../alerts/telegramClient.js');
            await sendTelegramAlert(
              `🔧 <b>[Corporate Action 의심 — universe 제외]</b> ${stock.name} (${stock.code})\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `• drift: ${driftPctText}% (분할/병합/권리락 추정)\n` +
              `• entryPrice <b>${oldEntry.toLocaleString()}원 보존</b> (RAW immutable, ADR-0115)\n` +
              `• 처리: 워치리스트에서 제외 (다음 영업일 운영자 검토 후 수동 entryPrice 갱신 또는 새 진입)\n` +
              `• 권고: DART 공시 확인 (분할/병합/권리락)`,
              {
                priority: 'HIGH',
                dedupeKey: `corp_action_immutable:${stock.code}`,
                cooldownMs: 24 * 60 * 60 * 1000,
              },
            ).catch(() => undefined);
          } catch (e) {
            console.warn('[CorporateAction] 텔레그램 알림 실패:', e instanceof Error ? e.message : e);
          }
          // universe 제외 (REMOVE 동작과 동일)
          const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
          if (idx >= 0) { ctx.watchlist.splice(idx, 1); ctx.mutables.watchlistMutated.value = true; }
          stageLog.drift = 'CORPORATE_ACTION_REMOVE';
        } else {
          // 레거시 ADR-0113 동작 (ENV ENTRY_PRICE_AUTO_CORRECT_DISABLED=false 명시 시에만)
          stock.entryPrice = currentPrice;
          stock.corporateActionAdjusted = true;
          stock.corporateActionAdjustedAt = new Date().toISOString();
          ctx.mutables.watchlistMutated.value = true;
          console.warn(
            `[AutoTrade] 🔧 ${stock.name}(${stock.code}) Corporate Action 의심 ` +
            `(drift ${driftPctText}%) — entryPrice ${oldEntry.toLocaleString()} → ` +
            `${currentPrice.toLocaleString()} 자동 보정 (ADR-0113 레거시 동작, ENV 우회).`,
          );
          try {
            const { sendTelegramAlert } = await import('../../../alerts/telegramClient.js');
            await sendTelegramAlert(
              `🔧 <b>[Corporate Action 의심 — 자동 보정]</b> ${stock.name} (${stock.code})\n` +
              `━━━━━━━━━━━━━━━━\n` +
              `• drift: ${driftPctText}% (분할/병합/권리락 추정)\n` +
              `• entryPrice 자동 보정: ${oldEntry.toLocaleString()} → ${currentPrice.toLocaleString()}\n` +
              `• 권고: DART 공시 확인 (분할/병합/권리락) 후 워치리스트 검토`,
              {
                priority: 'HIGH',
                dedupeKey: `corp_action:${stock.code}`,
                cooldownMs: 24 * 60 * 60 * 1000,
              },
            ).catch(() => undefined);
          } catch (e) {
            console.warn('[CorporateAction] 텔레그램 알림 실패:', e instanceof Error ? e.message : e);
          }
          stageLog.drift = 'CORPORATE_ACTION';
        }
        ctx.scanCounters.waitDriftCorpAction++;  // ADR-0118
        pushTrace();
        continue;
      }
      if (driftAction === 'REMOVE') {
        const driftPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) entryPrice 드리프트 제거 — ` +
          `현재가 ${currentPrice.toLocaleString()} vs entryPrice ${stock.entryPrice.toLocaleString()} (+${driftPct}%)`,
        );
        const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
        if (idx >= 0) { ctx.watchlist.splice(idx, 1); ctx.mutables.watchlistMutated.value = true; }
        stageLog.drift = 'REMOVE';
        ctx.scanCounters.waitDriftRemove++;  // ADR-0118
        pushTrace();
        continue;
      }
      if (driftAction === 'UPDATE') {
        const oldEntry = stock.entryPrice;
        stock.entryPrice = currentPrice;
        ctx.mutables.watchlistMutated.value = true;
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) entryPrice 트레일 업 — ` +
          `${oldEntry.toLocaleString()} → ${currentPrice.toLocaleString()} (+10% 이상 드리프트)`,
        );
        stageLog.drift = 'UPDATE';
        pushTrace();
        continue; // 이번 스캔에서는 진입 시도하지 않음 (갱신 직후 안정화 대기)
      }

      // 당일 날짜 (재진입 방지 + PRE_BREAKOUT 추종 중복 방지 공통 사용)
      const today = new Date().toISOString().split('T')[0];

      // ── Pre-Breakout: 선취매 포지션 확인 → 돌파 추종 실행 ──────────────────
      const activePreBreakout = ctx.shadows.find(
        s => s.stockCode === stock.code &&
             s.watchlistSource === 'PRE_BREAKOUT' &&
             isOpenShadowStatus(s.status)
      );

      if (activePreBreakout) {
        if (currentPrice >= stock.entryPrice) {
          // 돌파 확인! 나머지 70% 추종 매수 실행
          const followAlreadyDone = ctx.shadows.some(
            s => s.stockCode === stock.code &&
                 s.watchlistSource === 'PRE_BREAKOUT_FOLLOWTHROUGH' &&
                 (isOpenShadowStatus(s.status) || s.signalTime.startsWith(today))
          );
          if (!followAlreadyDone && !isBlacklisted(stock.code)) {
            const slippage = getExecutionCostConfig().slippageRate;
            const followEntryPrice = Math.round(currentPrice * (1 + slippage));

            // BUG-08 fix: 추종 매수 시 새 진입가 기준 RRR 재검증
            const followRRR = calcRRR(followEntryPrice, stock.targetPrice, stock.stopLoss);
            if (followRRR < RRR_MIN_THRESHOLD) {
              console.log(
                `[PreBreakout] ${stock.name}(${stock.code}) 추종 RRR ${followRRR.toFixed(2)} < ${RRR_MIN_THRESHOLD} — 추종 매수 제외`
              );
              continue;
            }

            // BUG-05 fix: MTAS 기반 포지션 조정 (Pre-Breakout 추종에도 적용)
            const gateScoreFollow = (stock.gateScore ?? 0) + ctx.volumeClock.scoreBonus;
            const { gate: reCheckGateFollow, quote: reCheckQuoteFollow } = await fetchGateData(stock.code, ctx.conditionWeights, ctx.macroState?.kospi20dReturn);
            const mtasFollow = reCheckGateFollow ? computeMtasMultiplier(reCheckGateFollow.mtas) : 1.0;
            const posPctFollow = computeRawPositionPct(gateScoreFollow) * ctx.kellyMultiplier * mtasFollow;
            const remSlots = Math.max(
              1,
              ctx.effectiveMaxPositions
                - ctx.shadows.filter(s =>
                    isOpenShadowStatus(s.status) &&
                    s.watchlistSource !== 'INTRADAY' &&
                    s.watchlistSource !== 'PRE_BREAKOUT',
                  ).length
                - ctx.mutables.reservedSlots.value,
            );
            const { quantity: legacyFullQty } = calculateOrderQuantity({
              totalAssets: ctx.totalAssets, orderableCash: ctx.mutables.orderableCash.value, positionPct: posPctFollow,
              price: followEntryPrice, remainingSlots: remSlots,
              accountKellyMultiplier: ctx.accountKellyMultiplier,
            });
            // ── ADR-0163 (Phase 2-D Extension): PRE_BREAKOUT_FOLLOWTHROUGH 경로 wiring ──
            // STRONG_BUY 매핑 (추세 추격 = 돌파 확정 후) + ENV+SHADOW 활성 시 본 모듈 override.
            // ADR-0172: reCheckQuoteFollow 실데이터로 유동성·섹터 입력 교체.
            const _sizingInputFollow = computeSizingLiquidityInputs(
              reCheckQuoteFollow ?? null,
              stock.code,
              stock.sector,
              ctx.shadows,
            );
            const sizingApplyFollow = applyPositionSizingEngine(ctx.shadowMode, {
              totalAssets: ctx.totalAssets, shadowEntryPrice: followEntryPrice, stopLoss: stock.stopLoss,
              signalGrade: 'STRONG_BUY', regimeKelly: ctx.kellyMultiplier, confidenceModifier: 1.0,
              rrr: stock.rrr ?? 0,
              marketCap: 1_000_000_000_000_000,  // marketCap 미노출 — universe 차단 회피 유지
              avgDailyVolume20d: _sizingInputFollow.avgDailyVolume20d,   // ADR-0172
              currentSectorWeight: _sizingInputFollow.currentSectorWeight, // ADR-0172
              isNormalRegime: ctx.regime === 'R1_TURBO' || ctx.regime === 'R2_BULL' || ctx.regime === 'R3_EARLY',
              enemyChecklistPassed: true, highDataReliability: true, gate1AllPassed: true,
              notInDowntrend: ctx.regime !== 'R6_DEFENSE' && ctx.regime !== 'R5_CAUTION',
            });
            const fullQty = sizingApplyFollow.applied ? sizingApplyFollow.quantity : legacyFullQty;
            const sizingSourceFollow = sizingApplyFollow.sizingSource;
            const sizingEngineSnapshotFollow = sizingApplyFollow.applied && sizingApplyFollow.result ? {
              tierName: sizingApplyFollow.result.tier.name, basePct: sizingApplyFollow.result.basePct,
              finalPositionPct: sizingApplyFollow.result.finalPositionPct, finalPositionKrw: sizingApplyFollow.result.finalPosition,
              drawdownMultiplier: sizingApplyFollow.result.drawdownMultiplier, lossStreakMultiplier: sizingApplyFollow.result.lossStreakMultiplier,
              liquidityMultiplier: sizingApplyFollow.result.liquidityMultiplier, sectorExposureMultiplier: sizingApplyFollow.result.sectorExposureMultiplier,
              expectedStopLossDamagePct: sizingApplyFollow.result.expectedStopLossDamagePct,
              signalPriorityApplied: sizingApplyFollow.result.signalPriorityApplied,
              adjustmentReasons: sizingApplyFollow.result.adjustmentReasons, snapshotAt: new Date().toISOString(),
            } : undefined;
            if (sizingApplyFollow.applied) {
              console.log(`[Sizing-NewEngine] ${stock.code} ${stock.name} (PRE_BREAKOUT_FOLLOWTHROUGH) → tier=${sizingEngineSnapshotFollow!.tierName} qty=${fullQty} (legacy=${legacyFullQty})`);
            }
            const followQtyRaw = Math.max(1, Math.ceil(fullQty * 0.7));
            // ── ADR-0166: PRE_BREAKOUT_FOLLOWTHROUGH 노출 예산 cap (default OFF) ──
            const exposureCapFollow = applyExposureBudgetCap({
              rawQuantity: followQtyRaw,
              shadowEntryPrice: followEntryPrice,
              accountEquity: ctx.totalAssets,
              currentEquityExposureAmount: resolveCurrentEquityExposure(ctx.totalAssets, ctx.mutables.orderableCash.value, ctx.shadows),
              currentCashAmount: ctx.mutables.orderableCash.value,
              regime: ctx.regime,
              isAddOnBuy: false,  // 추세 추격 = 신규 진입
              macro: buildExposureBudgetMacroInput(ctx.macroState),  // ADR-0170 §M4 — R1_DEFENSIVE 자동 격상
            });
            const followQty = exposureCapFollow.applied ? exposureCapFollow.finalQuantity : followQtyRaw;
            if (exposureCapFollow.applied && exposureCapFollow.capResult?.cappedByExposureBudget) {
              // ADR-0171 — 10 필드 SSOT formatter (verbose ENV ON 시 6 신규 필드 노출, default 4 필드).
              console.log(formatExposureBudgetLog({
                stockCode: stock.code,
                stockName: stock.name,
                pathLabel: 'PRE_BREAKOUT_FOLLOWTHROUGH',
                rawQuantity: followQtyRaw,
                finalQuantity: followQty,
                budget: exposureCapFollow.budget,
                capResult: exposureCapFollow.capResult,
              }));
            }
            const followHealth = applyBuySupplyHealthPolicy({
              stockCode: stock.code,
              stockName: stock.name,
              currentPrice,
              rawSignal: 'STRONG_BUY',
              rawScore: gateScoreFollow,
              requestedSize: followQty,
              shadowMode: ctx.shadowMode,
              ctx,
            });
            if (followHealth.blocked) continue;
            const followFinalQty = followHealth.finalQuantity;
            if (followFinalQty < 1) continue;  // exposure cap 으로 0 차단 시 진입 스킵
            const profile    = stock.profileType ?? 'B';
            const profileKey = `profile${profile}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
            const regimeStopRate = REGIME_CONFIGS[ctx.regime].stopLoss[profileKey];
            const followATR14 = reCheckQuoteFollow?.atr ?? 0;
            const stopLossPlan = buildStopLossPlan({
              entryPrice: followEntryPrice, fixedStopLoss: stock.stopLoss, regimeStopRate, atr14: followATR14, regime: ctx.regime,
            });
            const followSymbolCtx: SymbolExitContext = {
              // PRE_BREAKOUT 추세 추격 진입은 본질적으로 LEADER 성격(돌파 후 추세 보유 우선).
              profileType: stock.section === 'CATALYST' ? 'CATALYST' : 'LEADER',
              sector: stock.sector,
              watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
            };
            const adaptiveFollowProfitTargets = getAdaptiveProfitTargets(ctx.regime, ctx.macroState, followSymbolCtx);
            const limitTranches = adaptiveFollowProfitTargets.targets.filter(t => t.type === 'LIMIT' && t.trigger !== null);
            const trailTarget   = adaptiveFollowProfitTargets.targets.find(t => t.type === 'TRAILING');
            const followTrade = buildBuyTrade({
              idPrefix: 'srv_pbf', stockCode: stock.code, stockName: stock.name,
              currentPrice, shadowEntryPrice: followEntryPrice, quantity: followFinalQty,
              stopLossPlan, targetPrice: stock.targetPrice, shadowMode: followHealth.shadowMode, regime: ctx.regime,
              profileType: profile, watchlistSource: 'PRE_BREAKOUT_FOLLOWTHROUGH',
              profitTranches: limitTranches.map(t => ({ price: followEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
              trailPct: Math.max(0.05, Math.min(0.14, (trailTarget?.trailPct ?? 0.10) + adaptiveFollowProfitTargets.trailPctAdjust)), entryATR14: followATR14,
              // ADR-0006 PR-19 baseline (PR-1) — entryConditionScores 영속.
              entryConditionScores: buildEntryConditionScores(['PRE_BREAKOUT_FOLLOWTHROUGH']),
              // ADR-0163 Phase 2-D Extension — sizingSource marker + 스냅샷 영속.
              sizingSource: sizingSourceFollow, sizingEngineSnapshot: sizingEngineSnapshotFollow,
              rawSignal: 'STRONG_BUY',
              finalSignal: followHealth.finalSignal,
              dataConfidence: followHealth.healthDecision?.dataConfidence,
              dataQualityBucket: followHealth.healthDecision?.dataQualityBucket,
              supplyHealthSnapshot: ctx.supplyHealthSnapshot,
              wasDowngradedBySupplyHealth: followHealth.healthDecision?.wasDowngradedBySupplyHealth,
              downgradeReasons: followHealth.healthDecision?.downgradeReasons,
            });

            ctx.shadows.push(followTrade);

            // ADR-0128 §Wiring 1A: 당일 신규 매수 후보 incremental 검증 (BUY_CANDIDATE role).
            // VERIFICATION_QUEUE_DISABLED=true 시 회로 통과. try/catch 격리 — verify throw 가 매매 흐름 차단 안 함.
            let _verifyOkFollow = true;
            try {
              const _verifyResultFollow = await verifyStockIncremental(stock.code, 'BUY_CANDIDATE');
              if (!_verifyResultFollow.verified && _verifyResultFollow.action?.blockBuy) {
                _verifyOkFollow = false;
                console.log(`[AutoTrade] ${stock.name}(${stock.code}) → DATA_HOLD / ${_verifyResultFollow.reason} / ${_verifyResultFollow.source}`);
              }
            } catch (err) {
              console.warn(`[AutoTrade] verifyStockIncremental error (안전 통과): ${stock.code} — ${(err as Error).message}`);
            }
            if (!_verifyOkFollow) continue;

            const _signalTimeFollow = new Date().toISOString();
            addRecommendation({
              stockCode: stock.code, stockName: stock.name, signalTime: _signalTimeFollow,
              priceAtRecommend: currentPrice, stopLoss: stopLossPlan.hardStopLoss,
              targetPrice: stock.targetPrice, kellyPct: Math.round(posPctFollow * 100),
              gateScore: gateScoreFollow, signalType: 'BUY',
              conditionKeys: ['PRE_BREAKOUT_FOLLOWTHROUGH'], entryRegime: ctx.regime,
            });
            // ADR-0077 wiring — AI_CANDIDATE 영속 (영속 실패 시 매매 차단 안 함)
            try {
              recordAiCandidate({
                signalTimeIso: _signalTimeFollow,
                stockCode: stock.code,
                stockName: stock.name,
                recommendationType: 'BUY',
                signalGateScore: gateScoreFollow,
                reason: '선취매 추종 BUY 진입 후보',
              });
            } catch (e) {
              console.warn('[TradeSignalStatus] PRE_BREAKOUT_FOLLOWTHROUGH recordAiCandidate failed', e);
            }

            const alertMsg =
              `🚀 <b>[선취매 추종] ${stock.name} (${stock.code})</b>\n` +
              `돌파 확인 @${currentPrice.toLocaleString()}원 — 나머지 70% 집행\n` +
              `주문가: ${followEntryPrice.toLocaleString()}원 × ${followFinalQty}주\n` +
              `손절: ${formatStopLossBreakdown(stopLossPlan)} | 목표: ${stock.targetPrice.toLocaleString()}원`;

            ctx.mutables.liveBuyQueue.push(await createBuyTask({
              trade: followTrade, stockCode: stock.code, stockName: stock.name,
              currentPrice, quantity: followFinalQty, entryPrice: followEntryPrice,
              stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
              gateScore: gateScoreFollow, shadowMode: followHealth.shadowMode, effectiveBudget: followFinalQty * followEntryPrice,
              alertMessage: alertMsg, logEvent: 'PRE_BREAKOUT_FOLLOWTHROUGH',
              signalId: buildSignalId(_signalTimeFollow, stock.code), // ADR-0077
              onApproved: async () => { ctx.mutables.orderableCash.value = Math.max(0, ctx.mutables.orderableCash.value - followFinalQty * followEntryPrice); },
            }));
            // Phase 1 ①: 큐 푸시 시점에 슬롯·섹터 예약 기록 (플러시 후 실패 시 롤백)
            ctx.mutables.reservedSlots.value++;
            ctx.mutables.reservedTiers.push('OTHER');
            {
              const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
              const _val = followFinalQty * followEntryPrice;
              ctx.mutables.pendingSectorValue.set(_sec, (ctx.mutables.pendingSectorValue.get(_sec) ?? 0) + _val);
              ctx.mutables.reservedSectorValues.push({ sector: _sec, value: _val });
            }
          } else {
            console.log(`[PreBreakout] ${stock.name}(${stock.code}) 추종 매수 이미 실행됨 — 스킵`);
          }
        } else {
          console.log(`[PreBreakout] ${stock.name}(${stock.code}) 선취매 보유 중 @${activePreBreakout.shadowEntryPrice.toLocaleString()} — 돌파 대기`);
        }
        continue; // 선취매 포지션이 있으면 일반 진입 로직 건너뜀
      }

      // 진입 조건: 현재가가 entryPrice 부근 도달
      // MANUAL 종목은 사용자 확신이 높으므로 ±2%, AUTO 종목은 ±1%
      const nearEntryThreshold = stock.addedBy === 'MANUAL' ? 0.02 : 0.01;
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= nearEntryThreshold;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      // ── Pre-Breakout 매집 감지 (진입가 미도달 + 손절선 위) ─────────────────
      if (!nearEntry && !breakout && aboveStop) {
        const priceDiffPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
        ctx.scanCounters.preBreakoutPriceDistance++;
        logNoiseDetail({
          category: 'PRE_BREAKOUT_PRICE_DISTANCE',
          message: `[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달 — ` +
            `현재가 ${currentPrice.toLocaleString()} vs 진입가 ${stock.entryPrice.toLocaleString()} (${priceDiffPct}%, 기준 ±${(nearEntryThreshold * 100).toFixed(0)}%) → Pre-Breakout 판별 ` +
            `actionable=false executionImpact=NONE telegram=false`,
        });
        // ADR-0231: KRX 마스터 기반 정확 매핑 → 1회 fetch + KIS fallback.
        const reCheckQuotePb = await fetchYahooQuoteByCode(stock.code, fetchYahooQuote)
                            ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
        if (
          reCheckQuotePb != null &&
          (reCheckQuotePb.recentCloses10d?.length ?? 0) >= 5 &&
          (reCheckQuotePb.recentVolumes10d?.length ?? 0) >= 4 &&
          (reCheckQuotePb.recentHighs10d?.length ?? 0) >= 6 &&
          (reCheckQuotePb.recentLows10d?.length ?? 0) >= 6
        ) {
          const accumResult = detectPreBreakoutAccumulation({
            recentCloses:         reCheckQuotePb.recentCloses10d!,
            recentVolumes:        reCheckQuotePb.recentVolumes10d!,
            avgVolume20d:         reCheckQuotePb.avgVolume,
            recentHighs:          reCheckQuotePb.recentHighs10d!,
            recentLows:           reCheckQuotePb.recentLows10d!,
            atrRatio:             reCheckQuotePb.price > 0 ? reCheckQuotePb.atr / reCheckQuotePb.price : 0.02,
            foreignNetBuy5d:      ctx.macroState?.foreignNetBuy5d ?? 0,
            institutionalNetBuy5d: 0,
          });

          if (accumResult.isAccumulating) {
            // 당일 이미 선취매 진행 여부 확인
            const pbAlreadyToday = ctx.shadows.some(
              s => s.stockCode === stock.code &&
                   s.watchlistSource === 'PRE_BREAKOUT' &&
                   s.signalTime.startsWith(today)
            );
            if (!pbAlreadyToday && !isBlacklisted(stock.code)) {
              const slippage = getExecutionCostConfig().slippageRate;
              const pbEntryPrice = Math.round(currentPrice * (1 + slippage));
              const gateScorePb = (stock.gateScore ?? 0) + ctx.volumeClock.scoreBonus;
              // BUG-05 fix: MTAS 기반 포지션 조정 (Pre-Breakout 선취매에도 적용)
              const [kisFlowPb, dartFinPb] = await Promise.all([
                fetchKisInvestorTradeByStockDaily(stock.code).catch(() => null),
                getDartFinancials(stock.code).catch(() => null),
              ]);
              const reCheckGatePb = evaluateServerGate(reCheckQuotePb, ctx.conditionWeights, ctx.macroState?.kospi20dReturn, dartFinPb, kisFlowPb, ctx.regime);
              const mtasPb = reCheckGatePb ? computeMtasMultiplier(reCheckGatePb.mtas) : 1.0;
              const posPctPb    = computeRawPositionPct(gateScorePb) * ctx.kellyMultiplier * mtasPb;
              const remSlotsPb  = Math.max(
                1,
                ctx.effectiveMaxPositions
                  - ctx.shadows.filter(s =>
                      isOpenShadowStatus(s.status) &&
                      s.watchlistSource !== 'INTRADAY' &&
                      s.watchlistSource !== 'PRE_BREAKOUT',
                    ).length
                  - ctx.mutables.reservedSlots.value,
              );
              const { quantity: legacyFullPbQty } = calculateOrderQuantity({
                totalAssets: ctx.totalAssets, orderableCash: ctx.mutables.orderableCash.value, positionPct: posPctPb,
                price: pbEntryPrice, remainingSlots: remSlotsPb,
                accountKellyMultiplier: ctx.accountKellyMultiplier,
              });
              // ── ADR-0163 (Phase 2-D Extension): PRE_BREAKOUT 30% 선취매 경로 wiring ──
              // BUY 매핑 (선취매 = 사전 진입, 보수적) + 30% 비율은 호출자 측 보존.
              // ADR-0172: reCheckQuotePb 실데이터로 유동성·섹터 입력 교체.
              const _sizingInputPb = computeSizingLiquidityInputs(
                reCheckQuotePb ?? null,
                stock.code,
                stock.sector,
                ctx.shadows,
              );
              const sizingApplyPb = applyPositionSizingEngine(ctx.shadowMode, {
                totalAssets: ctx.totalAssets, shadowEntryPrice: pbEntryPrice, stopLoss: stock.stopLoss,
                signalGrade: 'BUY', regimeKelly: ctx.kellyMultiplier, confidenceModifier: 1.0,
                rrr: stock.rrr ?? 0,
                marketCap: 1_000_000_000_000_000,  // marketCap 미노출 — universe 차단 회피 유지
                avgDailyVolume20d: _sizingInputPb.avgDailyVolume20d,   // ADR-0172
                currentSectorWeight: _sizingInputPb.currentSectorWeight, // ADR-0172
                isNormalRegime: ctx.regime === 'R1_TURBO' || ctx.regime === 'R2_BULL' || ctx.regime === 'R3_EARLY',
                enemyChecklistPassed: true, highDataReliability: true, gate1AllPassed: true,
                notInDowntrend: ctx.regime !== 'R6_DEFENSE' && ctx.regime !== 'R5_CAUTION',
              });
              const fullPbQty = sizingApplyPb.applied ? sizingApplyPb.quantity : legacyFullPbQty;
              const sizingSourcePb = sizingApplyPb.sizingSource;
              const sizingEngineSnapshotPb = sizingApplyPb.applied && sizingApplyPb.result ? {
                tierName: sizingApplyPb.result.tier.name, basePct: sizingApplyPb.result.basePct,
                finalPositionPct: sizingApplyPb.result.finalPositionPct, finalPositionKrw: sizingApplyPb.result.finalPosition,
                drawdownMultiplier: sizingApplyPb.result.drawdownMultiplier, lossStreakMultiplier: sizingApplyPb.result.lossStreakMultiplier,
                liquidityMultiplier: sizingApplyPb.result.liquidityMultiplier, sectorExposureMultiplier: sizingApplyPb.result.sectorExposureMultiplier,
                expectedStopLossDamagePct: sizingApplyPb.result.expectedStopLossDamagePct,
                signalPriorityApplied: sizingApplyPb.result.signalPriorityApplied,
                adjustmentReasons: sizingApplyPb.result.adjustmentReasons, snapshotAt: new Date().toISOString(),
              } : undefined;
              if (sizingApplyPb.applied) {
                console.log(`[Sizing-NewEngine] ${stock.code} ${stock.name} (PRE_BREAKOUT 30%) → tier=${sizingEngineSnapshotPb!.tierName} qty=${fullPbQty} (legacy=${legacyFullPbQty})`);
              }
              const pbQtyRaw = Math.max(1, Math.floor(fullPbQty * 0.3)); // 30% 선취매
              // ── ADR-0166: PRE_BREAKOUT 30% 선취매 노출 예산 cap (default OFF) ──
              const exposureCapPb = applyExposureBudgetCap({
                rawQuantity: pbQtyRaw,
                shadowEntryPrice: pbEntryPrice,
                accountEquity: ctx.totalAssets,
                currentEquityExposureAmount: resolveCurrentEquityExposure(ctx.totalAssets, ctx.mutables.orderableCash.value, ctx.shadows),
                currentCashAmount: ctx.mutables.orderableCash.value,
                regime: ctx.regime,
                isAddOnBuy: false,  // 선취매 = 신규 진입 (사전 진입)
                macro: buildExposureBudgetMacroInput(ctx.macroState),  // ADR-0170 §M4 — R1_DEFENSIVE 자동 격상
              });
              const pbQty = exposureCapPb.applied ? exposureCapPb.finalQuantity : pbQtyRaw;
              if (exposureCapPb.applied && exposureCapPb.capResult?.cappedByExposureBudget) {
                // ADR-0171 — 10 필드 SSOT formatter.
                console.log(formatExposureBudgetLog({
                  stockCode: stock.code,
                  stockName: stock.name,
                  pathLabel: 'PRE_BREAKOUT 30%',
                  rawQuantity: pbQtyRaw,
                  finalQuantity: pbQty,
                  budget: exposureCapPb.budget,
                  capResult: exposureCapPb.capResult,
                }));
              }

              const pbHealth = applyBuySupplyHealthPolicy({
                stockCode: stock.code,
                stockName: stock.name,
                currentPrice,
                rawSignal: 'BUY',
                rawScore: gateScorePb,
                requestedSize: pbQty,
                shadowMode: ctx.shadowMode,
                ctx,
              });
              if (pbHealth.blocked) continue;
              const pbFinalQty = pbHealth.finalQuantity;

              if (pbFinalQty >= 1) {
                const profilePb = stock.profileType ?? 'B';
                const profileKeyPb = `profile${profilePb}` as 'profileA' | 'profileB' | 'profileC' | 'profileD';
                const regimeStopRatePb = REGIME_CONFIGS[ctx.regime].stopLoss[profileKeyPb];
                const pbATR14 = reCheckQuotePb?.atr ?? 0;
                const stopLossPlanPb = buildStopLossPlan({
                  entryPrice: pbEntryPrice, fixedStopLoss: stock.stopLoss, regimeStopRate: regimeStopRatePb, atr14: pbATR14, regime: ctx.regime,
                });
                const adaptivePreBreakoutTargets = getAdaptiveProfitTargets(ctx.regime, ctx.macroState);
                const limitTranchesPb = adaptivePreBreakoutTargets.targets.filter(t => t.type === 'LIMIT' && t.trigger !== null);
                const trailTargetPb   = adaptivePreBreakoutTargets.targets.find(t => t.type === 'TRAILING');
                const pbTrade = buildBuyTrade({
                  idPrefix: 'srv_pb', stockCode: stock.code, stockName: stock.name,
                  currentPrice, shadowEntryPrice: pbEntryPrice, quantity: pbFinalQty, originalQuantity: fullPbQty,
                  stopLossPlan: stopLossPlanPb, targetPrice: stock.targetPrice, shadowMode: pbHealth.shadowMode, regime: ctx.regime,
                  profileType: profilePb, watchlistSource: 'PRE_BREAKOUT',
                  profitTranches: limitTranchesPb.map(t => ({ price: pbEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false })),
                  trailPct: Math.max(0.05, Math.min(0.14, (trailTargetPb?.trailPct ?? 0.10) + adaptivePreBreakoutTargets.trailPctAdjust)), entryATR14: pbATR14,
                  // ADR-0006 PR-19 baseline (PR-1) — entryConditionScores 영속.
                  entryConditionScores: buildEntryConditionScores(['PRE_BREAKOUT']),
                  // ADR-0163 Phase 2-D Extension — sizingSource marker + 스냅샷 영속.
                  sizingSource: sizingSourcePb, sizingEngineSnapshot: sizingEngineSnapshotPb,
                  rawSignal: 'BUY',
                  finalSignal: pbHealth.finalSignal,
                  dataConfidence: pbHealth.healthDecision?.dataConfidence,
                  dataQualityBucket: pbHealth.healthDecision?.dataQualityBucket,
                  supplyHealthSnapshot: ctx.supplyHealthSnapshot,
                  wasDowngradedBySupplyHealth: pbHealth.healthDecision?.wasDowngradedBySupplyHealth,
                  downgradeReasons: pbHealth.healthDecision?.downgradeReasons,
                });

                ctx.shadows.push(pbTrade);

                // ADR-0128 §Wiring 1A: 당일 신규 매수 후보 incremental 검증 (BUY_CANDIDATE role).
                let _verifyOkPb = true;
                try {
                  const _verifyResultPb = await verifyStockIncremental(stock.code, 'BUY_CANDIDATE');
                  if (!_verifyResultPb.verified && _verifyResultPb.action?.blockBuy) {
                    _verifyOkPb = false;
                    console.log(`[AutoTrade] ${stock.name}(${stock.code}) → DATA_HOLD / ${_verifyResultPb.reason} / ${_verifyResultPb.source}`);
                  }
                } catch (err) {
                  console.warn(`[AutoTrade] verifyStockIncremental error (안전 통과): ${stock.code} — ${(err as Error).message}`);
                }
                if (!_verifyOkPb) continue;

                const _signalTimePb = new Date().toISOString();
                addRecommendation({
                  stockCode: stock.code, stockName: stock.name, signalTime: _signalTimePb,
                  priceAtRecommend: currentPrice, stopLoss: stopLossPlanPb.hardStopLoss,
                  targetPrice: stock.targetPrice, kellyPct: Math.round(posPctPb * 100),
                  gateScore: gateScorePb, signalType: 'BUY',
                  conditionKeys: ['PRE_BREAKOUT'], entryRegime: ctx.regime,
                });
                // ADR-0077 wiring — AI_CANDIDATE 영속
                try {
                  recordAiCandidate({
                    signalTimeIso: _signalTimePb,
                    stockCode: stock.code,
                    stockName: stock.name,
                    recommendationType: 'BUY',
                    signalGateScore: gateScorePb,
                    reason: 'PRE_BREAKOUT 매집 감지 30% 선취매',
                  });
                } catch (e) {
                  console.warn('[TradeSignalStatus] PRE_BREAKOUT recordAiCandidate failed', e);
                }

                console.log(`[PreBreakout] ${stock.name}(${stock.code}) 매집 감지 — 30% 선취매 @${pbEntryPrice} (${pbFinalQty}주/${fullPbQty}주)`);
                console.log(`[PreBreakout] ${accumResult.summary}`);

                const pbAlertMsg =
                  `🔍 <b>[선취매 진입] ${stock.name} (${stock.code})</b>\n` +
                  `매집 감지 — ${accumResult.summary}\n` +
                  `현재가: ${currentPrice.toLocaleString()}원 × ${pbFinalQty}주 (30% / 총 ${fullPbQty}주)\n` +
                  `손절: ${formatStopLossBreakdown(stopLossPlanPb)} | 목표: ${stock.targetPrice.toLocaleString()}원\n` +
                  `⚡ 돌파 확인 시 나머지 70%(${fullPbQty - pbFinalQty}주) 추가 집행`;

                ctx.mutables.liveBuyQueue.push(await createBuyTask({
                  trade: pbTrade, stockCode: stock.code, stockName: stock.name,
                  currentPrice, quantity: pbFinalQty, entryPrice: pbEntryPrice,
                  stopLoss: stopLossPlanPb.hardStopLoss, targetPrice: stock.targetPrice,
                  gateScore: gateScorePb, shadowMode: pbHealth.shadowMode, effectiveBudget: pbFinalQty * pbEntryPrice,
                  alertMessage: pbAlertMsg, logEvent: 'PRE_BREAKOUT_ENTRY',
                  signalId: buildSignalId(_signalTimePb, stock.code), // ADR-0077
                  onApproved: async () => { ctx.mutables.orderableCash.value = Math.max(0, ctx.mutables.orderableCash.value - pbFinalQty * pbEntryPrice); },
                }));
                // Phase 1 ①: 큐 푸시 시점에 슬롯·섹터 예약 기록 (플러시 후 실패 시 롤백)
                ctx.mutables.reservedSlots.value++;
                ctx.mutables.reservedTiers.push('OTHER');
                {
                  const _sec = stock.sector || getSectorByCode(stock.code) || '미분류';
                  const _val = pbFinalQty * pbEntryPrice;
                  ctx.mutables.pendingSectorValue.set(_sec, (ctx.mutables.pendingSectorValue.get(_sec) ?? 0) + _val);
                  ctx.mutables.reservedSectorValues.push({ sector: _sec, value: _val });
                }
              }
            }
          }
        }
        // ADR-0115: pre-breakout 미도달은 NON_CRITICAL — failCount 미증가, WAIT 상태
        // 사용자 18단계 §10 "Pre-breakout 조건 완화" — REJECT 가 아니라 HOLD/WAIT.
        // ENV PRE_BREAKOUT_FAILCOUNT_DISABLED=false 명시 시 ADR-0113 동작 복원.
        if (shouldIncrementFailCount('PRE_BREAKOUT_MISS')) {
          stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
          ctx.mutables.watchlistMutated.value = true;
          logger.debug(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — failCount=${stock.entryFailCount}`);
        } else {
          logPreEntryWaitDebug({
            stockName: stock.name,
            stockCode: stock.code,
            entryPrice: stock.entryPrice,
            reason: 'PRE_BREAKOUT_MISS',
            message: `[AutoTrade] ${stock.name}(${stock.code}) 진입가 미도달(pre-breakout) — WAIT (ADR-0115 — failCount 미증가)`,
          });
        }
        ctx.scanCounters.waitPreBreakout++;  // ADR-0118
        // ADR-0449 — Pre-Breakout WAIT 7-state 분류 + 영속 누적.
        try {
          const decision = evaluatePreBreakoutWait({
            symbol: stock.code,
            name: stock.name,
            currentPrice,
            entryPrice: stock.entryPrice,
            priceDistancePct: Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100),
            volumeRatio: undefined,
            gate1Passed: undefined,
            recheckPassed: undefined,
            waitCount: stock.waitCount,
            recheckFailCount: stock.recheckFailCount,
            lastWaitAt: stock.lastWaitAt,
            shadowObservable: undefined,
            liveEligible: undefined,
            riskBlocked: false,
            quoteStale: false,
          });
          ctx.scanCounters.preBreakoutWaitDecisions.push(decision);
          if (decision.increaseWaitCount) {
            stock.waitCount = (stock.waitCount ?? 0) + 1;
            stock.lastWaitAt = new Date().toISOString();
            ctx.mutables.watchlistMutated.value = true;
          }
          // ADR-0450 — KIS-WS priority routing: WAIT_RETRY_ELIGIBLE → 850 격상 / 먼·약한·탈락 →
          //   300/250 격하. WATCHLIST priority=500 만 반복되던 후보가 진입 직전 후보면 850 으로
          //   재구독되어 30 슬롯에서 우선순위 확보.
          try {
            const routing = routePreBreakoutWaitToKisWs(decision);
            if (routing.shouldRequestSubscription) {
              requestKisWsSubscription(
                {
                  code: stock.code,
                  name: stock.name,
                  priority: routing.priorityHint,
                  reasons: [routing.reason],
                  entryCandidate: decision.state === 'WAIT_RETRY_ELIGIBLE',
                  shadowObservable: decision.shadowLearningAllowed,
                
                },
                {},
              );
            }
          } catch (e) {
            // ADR-0450 routing/요청 실패가 매수 흐름 차단 안 함 — try/catch 격리.
            console.warn(`[ADR-0450] pre-breakout KIS-WS routing 실패 ${stock.code}:`, e);
          }
          // ADR-0452 — Shadow Near-Breakout Entry: Live WAIT 후보 중 near-breakout 학습
          //   가치가 큰 후보를 Shadow virtual buy 로 기록. Live 주문 / Paper 주문 / approval
          //   queue 모두 연결 금지. executionImpact: NONE literal type 강제.
          //   try/catch 격리 — 분류 실패가 매수 흐름 차단 안 함.
          try {
            const todayKst = new Date().toISOString().split('T')[0];
            const distancePct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
            const alreadyHasOpenShadow = ctx.shadows.some(
              (s) => s.stockCode === stock.code && isOpenShadowStatus(s.status),
            );
            const alreadyEnteredToday = ctx.shadows.some(
              (s) =>
                s.stockCode === stock.code &&
                s.watchlistSource === 'SHADOW_NEAR_BREAKOUT' &&
                s.signalTime.startsWith(todayKst),
            );
            const dailyCreatedCount = ctx.shadows.filter(
              (s) =>
                s.watchlistSource === 'SHADOW_NEAR_BREAKOUT' &&
                s.signalTime.startsWith(todayKst),
            ).length;
            const shadowDecision = evaluateShadowNearBreakoutEntry({
              symbol: stock.code,
              name: stock.name,
              currentPrice,
              entryPrice: stock.entryPrice,
              stopLoss: stock.stopLoss,
              targetPrice: stock.targetPrice,
              priceDistancePct: distancePct,
              gate1Passed: undefined,
              liveGateScore: stock.gateScore,
              conditionsPassed: undefined,
              recheckPassed: undefined,
              volumeRatio: undefined,
              preBreakoutState: decision.state,
              shadowMode: stockShadowMode,
              riskBlocked: false,
              quoteStale: false,
              alreadyHasOpenShadow,
              alreadyEnteredToday,
              dailyCreatedCount,
            });
            if (shadowDecision.allowed && shadowDecision.createShadowTrade) {
              // executionImpact NONE 보장 — buildBuyTrade 는 ServerShadowTrade 객체만 생성,
              // KIS / approval queue / orderExecutor / trancheExecutor 호출 0건 (정적 grep 가드).
              const stopLossPlanShadow = {
                hardStopLoss: stock.stopLoss,
                initialStopLoss: stock.stopLoss,
                regimeStopLoss: stock.stopLoss,
                stopLossPct: ((currentPrice - stock.stopLoss) / currentPrice) * 100,
                stopLossKrw: currentPrice - stock.stopLoss,
                breakdown: { initial: stock.stopLoss, regime: stock.stopLoss, atr: null, hard: stock.stopLoss },
              };
              const shadowTrade = buildBuyTrade({
                idPrefix: 'shadow-near-breakout',
                stockCode: stock.code,
                stockName: stock.name,
                currentPrice,
                shadowEntryPrice: currentPrice,
                quantity: 1,
                originalQuantity: 1,
                stopLossPlan: stopLossPlanShadow,
                targetPrice: stock.targetPrice,
                shadowMode: true,
                regime: ctx.regime,
                profileType: 'B',
                watchlistSource: 'SHADOW_NEAR_BREAKOUT',
                profitTranches: [],
                trailPct: 5,
              });
              ctx.shadows.push(shadowTrade);
              saveShadowTrades(ctx.shadows);
              ctx.scanCounters.shadowNearBreakoutCreated = (ctx.scanCounters.shadowNearBreakoutCreated ?? 0) + 1;
              console.log(
                `[ShadowNearBreakout] created ${stock.code} current=${currentPrice} entry=${stock.entryPrice} ` +
                `distance=${distancePct.toFixed(1)}% cause=${shadowDecision.cause} executionImpact=NONE`,
              );
            } else if (!shadowDecision.allowed && shadowDecision.blockReason) {
              ctx.scanCounters.shadowNearBreakoutBlocked = (ctx.scanCounters.shadowNearBreakoutBlocked ?? 0) + 1;
              const reasons = ctx.scanCounters.shadowNearBreakoutBlockReasons ?? {};
              const key: ShadowNearBreakoutBlockReason = shadowDecision.blockReason;
              reasons[key] = (reasons[key] ?? 0) + 1;
              ctx.scanCounters.shadowNearBreakoutBlockReasons = reasons;
            }
          } catch (e) {
            console.warn(`[ADR-0452] pre-breakout shadow near-breakout 분류 실패 ${stock.code}:`, e);
          }
        } catch (e) {
          // ADR-0449 분류 실패가 매수 흐름 차단 안 함 — try/catch 격리.
          console.warn(`[ADR-0449] pre-breakout WAIT 분류 실패 ${stock.code}:`, e);
        }
        continue; // 진입가 미도달 — 일반 진입 로직 건너뜀
      }

      // C4 수정: 명시적 진입 조건 체크 (INTRADAY 경로와 동일한 방어 패턴)
      // (!nearEntry && !breakout) 케이스는 위 pre-breakout 블록이 처리하지만,
      // 방어적 가드를 명시하여 미래 코드 변경 시 조건 없는 진입을 차단한다.
      // ADR-0115: 진입가 이탈도 NON_CRITICAL (ENTRY_PRICE_DEVIATION) — WAIT.
      if (!(nearEntry || breakout)) {
        if (shouldIncrementFailCount('ENTRY_PRICE_DEVIATION')) {
          stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
          ctx.mutables.watchlistMutated.value = true;
          logger.info(`[AutoTrade] ${stock.name}(${stock.code}) 진입가 이탈 — failCount=${stock.entryFailCount}`);
        } else {
          logPreEntryWaitDebug({
            stockName: stock.name,
            stockCode: stock.code,
            entryPrice: stock.entryPrice,
            reason: 'ENTRY_PRICE_DEVIATION',
            message: `[AutoTrade] ${stock.name}(${stock.code}) 진입가 이탈 — WAIT (ADR-0115 — failCount 미증가)`,
          });
        }
        ctx.scanCounters.waitPreBreakout++;  // ADR-0118 (entry deviation 도 pre-breakout 분류로 통합 카운트)
        // ADR-0449 — 진입가 이탈 (PRICE_DISTANCE_TOO_FAR 등) 7-state 분류 + 영속 누적.
        try {
          const decision = evaluatePreBreakoutWait({
            symbol: stock.code,
            name: stock.name,
            currentPrice,
            entryPrice: stock.entryPrice,
            priceDistancePct: Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100),
            volumeRatio: undefined,
            gate1Passed: undefined,
            recheckPassed: undefined,
            waitCount: stock.waitCount,
            recheckFailCount: stock.recheckFailCount,
            lastWaitAt: stock.lastWaitAt,
            shadowObservable: undefined,
            liveEligible: undefined,
            riskBlocked: false,
            quoteStale: false,
          });
          ctx.scanCounters.preBreakoutWaitDecisions.push(decision);
          if (decision.increaseWaitCount) {
            stock.waitCount = (stock.waitCount ?? 0) + 1;
            stock.lastWaitAt = new Date().toISOString();
            ctx.mutables.watchlistMutated.value = true;
          }
          // ADR-0450 — KIS-WS priority routing: ENTRY_PRICE_DEVIATION 분기도 동일 매핑.
          try {
            const routing = routePreBreakoutWaitToKisWs(decision);
            if (routing.shouldRequestSubscription) {
              requestKisWsSubscription(
                {
                  code: stock.code,
                  name: stock.name,
                  priority: routing.priorityHint,
                  reasons: [routing.reason],
                  entryCandidate: decision.state === 'WAIT_RETRY_ELIGIBLE',
                  shadowObservable: decision.shadowLearningAllowed,
                
                },
                {},
              );
            }
          } catch (e) {
            // ADR-0450 routing/요청 실패가 매수 흐름 차단 안 함 — try/catch 격리.
            console.warn(`[ADR-0450] entry deviation KIS-WS routing 실패 ${stock.code}:`, e);
          }
          // ADR-0452 — Shadow Near-Breakout Entry: ENTRY_PRICE_DEVIATION 분기 동일 wiring.
          //   Live WAIT 후보 중 학습 가치 큰 후보를 Shadow virtual buy 로 기록.
          //   try/catch 격리 — 분류 실패가 매수 흐름 차단 안 함.
          try {
            const todayKst = new Date().toISOString().split('T')[0];
            const distancePct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
            const alreadyHasOpenShadow = ctx.shadows.some(
              (s) => s.stockCode === stock.code && isOpenShadowStatus(s.status),
            );
            const alreadyEnteredToday = ctx.shadows.some(
              (s) =>
                s.stockCode === stock.code &&
                s.watchlistSource === 'SHADOW_NEAR_BREAKOUT' &&
                s.signalTime.startsWith(todayKst),
            );
            const dailyCreatedCount = ctx.shadows.filter(
              (s) =>
                s.watchlistSource === 'SHADOW_NEAR_BREAKOUT' &&
                s.signalTime.startsWith(todayKst),
            ).length;
            const shadowDecision = evaluateShadowNearBreakoutEntry({
              symbol: stock.code,
              name: stock.name,
              currentPrice,
              entryPrice: stock.entryPrice,
              stopLoss: stock.stopLoss,
              targetPrice: stock.targetPrice,
              priceDistancePct: distancePct,
              gate1Passed: undefined,
              liveGateScore: stock.gateScore,
              conditionsPassed: undefined,
              recheckPassed: undefined,
              volumeRatio: undefined,
              preBreakoutState: decision.state,
              shadowMode: stockShadowMode,
              riskBlocked: false,
              quoteStale: false,
              alreadyHasOpenShadow,
              alreadyEnteredToday,
              dailyCreatedCount,
            });
            if (shadowDecision.allowed && shadowDecision.createShadowTrade) {
              const stopLossPlanShadow = {
                hardStopLoss: stock.stopLoss,
                initialStopLoss: stock.stopLoss,
                regimeStopLoss: stock.stopLoss,
                stopLossPct: ((currentPrice - stock.stopLoss) / currentPrice) * 100,
                stopLossKrw: currentPrice - stock.stopLoss,
                breakdown: { initial: stock.stopLoss, regime: stock.stopLoss, atr: null, hard: stock.stopLoss },
              };
              const shadowTrade = buildBuyTrade({
                idPrefix: 'shadow-near-breakout',
                stockCode: stock.code,
                stockName: stock.name,
                currentPrice,
                shadowEntryPrice: currentPrice,
                quantity: 1,
                originalQuantity: 1,
                stopLossPlan: stopLossPlanShadow,
                targetPrice: stock.targetPrice,
                shadowMode: true,
                regime: ctx.regime,
                profileType: 'B',
                watchlistSource: 'SHADOW_NEAR_BREAKOUT',
                profitTranches: [],
                trailPct: 5,
              });
              ctx.shadows.push(shadowTrade);
              saveShadowTrades(ctx.shadows);
              ctx.scanCounters.shadowNearBreakoutCreated = (ctx.scanCounters.shadowNearBreakoutCreated ?? 0) + 1;
              console.log(
                `[ShadowNearBreakout] created ${stock.code} current=${currentPrice} entry=${stock.entryPrice} ` +
                `distance=${distancePct.toFixed(1)}% cause=${shadowDecision.cause} executionImpact=NONE`,
              );
            } else if (!shadowDecision.allowed && shadowDecision.blockReason) {
              ctx.scanCounters.shadowNearBreakoutBlocked = (ctx.scanCounters.shadowNearBreakoutBlocked ?? 0) + 1;
              const reasons = ctx.scanCounters.shadowNearBreakoutBlockReasons ?? {};
              const key: ShadowNearBreakoutBlockReason = shadowDecision.blockReason;
              reasons[key] = (reasons[key] ?? 0) + 1;
              ctx.scanCounters.shadowNearBreakoutBlockReasons = reasons;
            }
          } catch (e) {
            console.warn(`[ADR-0452] entry deviation shadow near-breakout 분류 실패 ${stock.code}:`, e);
          }
        } catch (e) {
          // ADR-0449 분류 실패가 매수 흐름 차단 안 함 — try/catch 격리.
          console.warn(`[ADR-0449] entry deviation WAIT 분류 실패 ${stock.code}:`, e);
        }
        continue;
      }

      if (!aboveStop) {
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) 손절선 하회 — ` +
          `현재가 ${currentPrice.toLocaleString()} ≤ 손절 ${stock.stopLoss.toLocaleString()} → 진입 차단`,
        );
        continue;
      }
      const alreadyTraded = ctx.shadows.some(
        (s) => s.stockCode === stock.code &&
        (isOpenShadowStatus(s.status) ||
         s.signalTime.startsWith(today))
      );
      if (alreadyTraded) continue;

      // 동시호가 중복 주문 방지 — 동시호가 주문 후 9시 스캔에서 같은 종목에 중복 진입 차단
      const hasPendingPreMarketOrder = fillMonitor.getPendingOrders().some(
        o => o.stockCode === stock.code &&
             (o.status === 'PENDING' || o.status === 'PARTIAL') &&
             o.placedAt.startsWith(today),
      );
      if (hasPendingPreMarketOrder) continue;

      // ── ADR-0030 PR-57+58: Phase B EntryGate Chain (7 게이트) ─────────────
      // cooldown / blacklist / addBuyBlock / rrr / sectorConcentration /
      // sectorPreGuard / portfolioRisk 모두 byte-equivalent 추출. 후속 PR 잔여:
      // liveGateRevalidation (다단계 revalidation pipeline) + kellyBudget
      // (Kelly 사이징) — pure gate 패턴에 부적합, 별도 ADR 예정.
      let _gateBlocked = false;
      for (const gate of ENTRY_GATES_PHASE_B) {
        const result = await gate({
          stock, shadows: ctx.shadows, scanCounters: ctx.scanCounters,
          watchlist: ctx.watchlist, mutables: ctx.mutables,
          currentPrice, totalAssets: ctx.totalAssets, kellyMultiplier: ctx.kellyMultiplier,
        });
        if (result.pass) {
          if (result.passLogMessage) console.log(result.passLogMessage);
          if (result.passWarnMessage) console.warn(result.passWarnMessage);
          continue;
        }
        // FAIL
        console.log(result.logMessage);
        if (result.counter) ctx.scanCounters[result.counter] += 1;
        if (result.stageLog) stageLog[result.stageLog.key] = result.stageLog.value;
        if (result.pushTrace) pushTrace();
        if (result.telegramMessage) {
          await sendTelegramAlert(result.telegramMessage).catch(console.error);
        }
        _gateBlocked = true;
        break;
      }
      if (_gateBlocked) continue;
      // 원본은 RRR PASS 시 stageLog.rrr='PASS' 만 별도로 기록 — 게이트 통과 후 동등 처리.
      stageLog.rrr = 'PASS';

      const slippage = getExecutionCostConfig().slippageRate;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));

      // ── 실시간 Gate 재평가 (타점 판단 연동) ──────────────────────────────────
      // 워치리스트 stale gateScore 대신 실시간 evaluateServerGate 결과를 포지션 사이징에 반영
      // 아이디어 9: KIS API로 MTAS 월봉/주봉 보강 (매수 결정 직전 정확도 향상)
      // ADR-0231: KRX 마스터 기반 정확 매핑 → 1회 fetch + KIS fallback.
      const reCheckQuoteRaw = await fetchYahooQuoteByCode(stock.code, fetchYahooQuote)
                           ?? await fetchKisQuoteFallback(stock.code).catch(() => null);
      const reCheckQuote = reCheckQuoteRaw
        ? await enrichQuoteWithKisMTAS(reCheckQuoteRaw, stock.code)
        : null;

      // ── ADR-0031 PR-60: kisIntradayCorrectionStep mutating step ─────────
      // Yahoo Finance의 regularMarketOpen이 한국 장중 부정확한 경우가 빈번하여
      // KIS 현재가 API(FHKST01010100)로 dayOpen·prevClose를 항상 덮어쓴다.
      // step 이 reCheckQuote 참조를 직접 mutate, caller 는 logMessages 만 출력.
      const kisCorrection = await kisIntradayCorrectionStep({
        stockCode: stock.code,
        reCheckQuote,
      });
      for (const msg of kisCorrection.logMessages) console.log(msg);

      const [kisFlow, dartFin] = reCheckQuote
        ? await Promise.all([
            fetchKisInvestorTradeByStockDaily(stock.code).catch(() => null),
            getDartFinancials(stock.code).catch(() => null),
          ])
        : [null, null];
      try { recordPipelineStage(ctx.scanCounters, 'PRICE_FETCH', reCheckQuote ? 'PASS' : 'FAIL'); } catch {}
      const reCheckGate = reCheckQuote
        ? evaluateServerGate(reCheckQuote, ctx.conditionWeights, ctx.macroState?.kospi20dReturn, dartFin, kisFlow, ctx.regime)
        : null;
      try {
        recordPipelineStage(ctx.scanCounters, 'SERVER_GATE_EVALUATED', reCheckGate ? 'PASS' : 'SKIPPED');
        recordPipelineStage(ctx.scanCounters, 'GATE_LAYER_SUMMARY_BUILT', reCheckGate?.gateLayerSummary ? 'PASS' : 'SKIPPED');
      } catch {}
      // ADR-452c — Gate Score Health 진단 누적. 표시 전용이며 live decision/Kelly/KIS 주문에는 미사용.
      try {
        accumulateGateScoreHealth(ctx.scanCounters, reCheckGate);
        accumulateGateLayerSummary(ctx.scanCounters, reCheckGate?.gateLayerSummary, reCheckGate?.signalType);
      } catch (e) {
        console.warn('[ADR-452c] accumulateGateScoreHealth failed:', e instanceof Error ? e.message : e);
      }
      try {
        if (reCheckGate) {
          const band = getRegimeGateBand(ctx.regime);
          accumulatePositiveScoreStarvation(
            ctx.scanCounters,
            buildGate1ScoreStarvationTraceFromGateResult({
              symbol: stock.code,
              name: stock.name,
              requiredScore: band.strong,
              gateResult: reCheckGate,
              watchlistScore: stock.gateScore,
              upstreamScore: stock.gateScore,
            }),
          );
        }
      } catch (e) {
        console.warn('[ADR-0467] positive score starvation audit failed:', e instanceof Error ? e.message : e);
      }
      // ADR-452d/454 — Gate near-miss bucket 진단 누적 + Outcome Ledger 영속.
      // executionImpact=NONE, live decision/Kelly/KIS 주문 미사용. DATA_BLOCKED_NEAR_MISS /
      // PROBING / SHADOW_ONLY 만 3/5/10영업일 사후 성과 관측 대상으로 기록한다.
      try {
        const band = getRegimeGateBand(ctx.regime);
        const bucketDecision = accumulateGateScoreCandidateBucket(ctx.scanCounters, reCheckGate, band.normal);
        if (
          bucketDecision &&
          reCheckGate &&
          (bucketDecision.bucket === 'DATA_BLOCKED_NEAR_MISS' ||
            bucketDecision.bucket === 'PROBING' ||
            bucketDecision.bucket === 'SHADOW_ONLY')
        ) {
          const outcome = recordNearMissOutcome({
            stockCode: stock.code,
            stockName: stock.name,
            signalDate: kstDecisionDate(),
            signalPriceKrw: currentPrice,
            bucket: bucketDecision.bucket,
            diagnosticReason: bucketDecision.reason,
            gateScore: reCheckGate.gateScore,
            rawScore: reCheckGate.rawScore,
            availableMaxScore: reCheckGate.availableMaxScore,
            normalizedGateScore: reCheckGate.normalizedGateScore,
            normalThreshold: band.normal,
            unavailableConditions: reCheckGate.unavailableConditions,
            thresholdNotMetConditions: reCheckGate.thresholdNotMetConditions,
            providerDegradedConditions: reCheckGate.providerDegradedConditions,
          });
          accumulateNearMissOutcomeLedgerWrite(ctx.scanCounters, outcome);
        }

        // ADR-458 — APPROVED Gate 재분류 Dry-Run. Shadow/diagnostic ledger only.
        // live Gate threshold/Kelly/KIS 주문/signalType/position sizing 은 변경하지 않는다.
        if (!isGateReclassificationDryRunDisabled() && bucketDecision && reCheckGate) {
          const approvedItems = loadGateReclassificationApprovalPlan().items
            .filter((item) => item.status === 'APPROVED');
          const observedDateKst = kstDecisionDate();
          const dryRun = evaluateGateReclassificationDryRun({
            code: stock.code,
            name: stock.name,
            gateScore: reCheckGate.gateScore,
            rawScore: reCheckGate.rawScore,
            availableMaxScore: reCheckGate.availableMaxScore,
            normalizedGateScore: reCheckGate.normalizedGateScore,
            unavailableConditions: reCheckGate.unavailableConditions ?? [],
            thresholdNotMetConditions: reCheckGate.thresholdNotMetConditions ?? [],
            providerDegradedConditions: reCheckGate.providerDegradedConditions ?? [],
            originalBucket: bucketDecision.bucket,
            approvedItems,
          });

          if (dryRun.dryRunDecision !== 'NO_CHANGE') {
            upsertGateReclassificationDryRunRecord({
              ...dryRun,
              id: buildGateReclassificationDryRunId(stock.code, observedDateKst, dryRun.dryRunDecision),
              observedAt: new Date().toISOString(),
              observedDateKst,
              status: 'OUTCOME_PENDING',
            });
            accumulateGateReclassificationDryRun(ctx.scanCounters, dryRun);
          }
        }
      } catch (e) {
        console.warn('[ADR-454/458] near-miss outcome or gate reclassification dry-run failed (live flow unaffected):', e instanceof Error ? e.message : e);
      }
      // ADR-0420: Fresh Scan Blocker Attribution 누적 — 단일 후보 outputs 를 conditionKey
      //   별 status bucket 에 가산. persistScanResults 가 build → ScanSummary 영속.
      //   GATE1_PASS_ZERO 발생 시 운영자에게 *조건별 분해* 제공. last 7 days 누적
      //   audit 와 분리 (사용자 명시 핵심 불변식 #4).
      // try/catch 격리 — fresh attribution 실패 시 매수 흐름 차단 안 함.
      if (reCheckGate?.outputs && reCheckGate.outputs.length > 0) {
        try {
          accumulateFreshConditionOutputs(
            ctx.scanCounters,
            reCheckGate.outputs.map((o) => ({
              key: o.key,
              output: o.output as Parameters<typeof accumulateFreshConditionOutputs>[1][number]['output'],
              context: o.context
                ? { evaluatorKey: o.key, hadRequiredData: o.context.hadRequiredData }
                : { evaluatorKey: o.key },
            })),
          );
        } catch (e) {
          console.warn('[Adr0420FreshAttribution] accumulate 실패 — 매수 흐름 무영향:', e);
        }
      }
      // ADR-0422: Gate2 / NO_LEADERSHIP fresh attribution 누적 — Gate1 생존 후보만.
      //   denominator=gate1Pass (사용자 §C 정합 — 전체 candidates 가 아닌 Gate1
      //   통과 후보 중심). PROVIDER_DEGRADED + STALE detail 은 stale 버킷으로
      //   분리 (사용자 핵심 불변식 — STALE 은 failed 가 아님).
      // ADR-0211 폴백 패턴 차용: gateEvaluation.gate1Passed === true OR gateScore ≥ 5.0
      // try/catch 격리 — Gate2 attribution 실패 시 매수 흐름 차단 안 함.
      const ge2 = (stock as { gateEvaluation?: { gate1Passed?: boolean } }).gateEvaluation;
      const isGate1Survivor =
        ge2?.gate1Passed === true ||
        (typeof stock.gateScore === 'number' && stock.gateScore >= 5.0);
      if (isGate1Survivor && reCheckGate?.outputs && reCheckGate.outputs.length > 0) {
        try {
          accumulateGate2ConditionOutputs(
            ctx.scanCounters,
            reCheckGate.outputs.map((o) => ({
              key: o.key,
              output: o.output as Parameters<typeof accumulateGate2ConditionOutputs>[1][number]['output'],
              context: o.context
                ? { evaluatorKey: o.key, hadRequiredData: o.context.hadRequiredData }
                : { evaluatorKey: o.key },
            })),
          );
        } catch (e) {
          console.warn('[Adr0422Gate2Attribution] accumulate 실패 — 매수 흐름 무영향:', e);
        }
      }

      // ── ADR-0436 — Gate Eligibility Split classify + accumulate ──────────
      // 사용자 §7 — 분류 layer 만, LIVE 매매 본체 0줄 변경. classifyGateEligibility
      // 결과를 ScanCounters 6 카운터에 누적 → ScanSummary propagate → /scan_blockers
      // 진단 + EmptyScanPostmortem KEEP_COUNTERFACTUAL_LEARNING / PATCH_PROVIDER 분기.
      //
      // 핵심 원칙 (사용자 명시 절대 변경 금지):
      //   - 실매수 후보 0 ≠ 학습/관측 후보 0
      //   - SHADOW_OBSERVABLE_PASS 는 절대 실매수 자동 승격 금지 (분류 only)
      //   - DATA_UNAVAILABLE 은 failed 가 아니다 + DATA_UNAVAILABLE 은 PASS 도 아니다
      //
      // Counterfactual ledger 자동 영속 wiring 은 본 PR scope 외 — ScanCounters
      // 카운터 증가만, 실제 영속은 ADR-0430 counterfactualShadowLearningRepo 후속 PR.
      try {
        // 가격/code 기본 valid 검증 입력 (fatal 분기)
        const priceValid = typeof currentPrice === 'number' && currentPrice > 0;
        const codeValid = /^[0-9]{6}$/.test(stock.code);
        // 신호 등급 — gateScore 기반 폴백 (WatchlistEntry 에는 명시 등급 부재).
        //   gateScore ≥ 9 → STRONG_BUY (PR-13 정합 임계) / ≥ 5 → BUY / 그 외 undefined.
        //   shadowObservable 후보성 평가 입력 — 절대 자동 매수 결정 입력 아님.
        const signalGrade: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'NEUTRAL' | undefined =
          typeof stock.gateScore === 'number' && stock.gateScore >= 9
            ? 'STRONG_BUY'
            : typeof stock.gateScore === 'number' && stock.gateScore >= 5
              ? 'BUY'
              : undefined;
        // sectorEnergyDataQuality 영속 union 그대로 전달
        const sectorEnergyDataQualityCast = ctx.macroState?.sectorEnergyDataQuality as
          | 'OK' | 'PARTIAL' | 'STALE' | 'PARTIAL_VOLUME' | 'DEGRADED' | 'FAILED' | undefined;
        // priceData degraded — Yahoo↔KIS 괴리 (ADR-0411) marker
        const priceDataDegraded =
          (stock as { technicalProviderDegraded?: boolean }).technicalProviderDegraded === true;
        // 후보성 — Gate1 survivor 폴백 (사용자 §C 정합)
        const hasTechnicalSetup = isGate1Survivor;
        const eligibility = classifyGateEligibility({
          currentPrice,
          stockCode: stock.code,
          // DATA_UNAVAILABLE 분기 — reCheckGate.outputs 의 status 검사 (ADR-0416 정합)
          supplyDataUnavailable: reCheckGate?.outputs?.some(
            (o) =>
              o.key === 'supply_confluence' &&
              (o.output as { status?: string } | null)?.status === 'DATA_UNAVAILABLE',
          ),
          investorFlowProviderUnavailable: reCheckGate?.outputs?.some(
            (o) =>
              (o.key === 'supply_confluence' || o.key === 'investor_flow') &&
              (o.output as { status?: string } | null)?.status === 'PROVIDER_DEGRADED',
          ),
          earningsDataUnavailable: reCheckGate?.outputs?.some(
            (o) =>
              o.key === 'earnings_quality' &&
              (o.output as { status?: string } | null)?.status === 'DATA_UNAVAILABLE',
          ),
          sectorEnergyDataQuality: sectorEnergyDataQualityCast,
          priceDataDegraded,
          // hard 차단 분기 — buyListLoop 진입은 preflight 통과 후이므로 모두 false (universe-level
          //   macro/risk block 은 ADR-0183 / preflight 에서 이미 차단)
          macroBlocked: false,
          riskBlocked: false,
          trueGateFail: false,
          insufficientScore: false,
          dataStarved: false,
          hasFatalDefect: !priceValid || !codeValid,
          signalGrade,
          hasTechnicalSetup,
        });
        accumulateGateEligibility(ctx.scanCounters, eligibility);
        recordPipelineStage(ctx.scanCounters, 'GATE_ELIGIBILITY_CLASSIFIED', eligibility.liveEligible ? 'PASS' : eligibility.shadowObservable ? 'SHADOW_ONLY' : 'BLOCKED');
      } catch (e) {
        console.warn('[Adr0436GateEligibility] classify 실패 — 매수 흐름 무영향:', e);
      }

      // ── ADR-0427 — R3_EARLY Provisional Shadow Lane wiring ──────────────
      // ADR-0426 SSOT (deriveR3ProvisionalShadowCandidate) 호출 + provisionalShadowLedger
      // 영속. R3_EARLY + Gate1 생존자 + HARD_BLOCK 없음 + Router SOFT_DEGRADE/WATCH_ONLY
      // 시점에만 후보 생성. try/catch 격리 — 영속 실패가 매수 흐름 차단 안 함.
      // KIS 주문 함수 5종 import 0건 (정적 grep 가드). LIVE 매매 본체 0줄 변경.
      try {
        if (ctx.regime === 'R3_EARLY' && isGate1Survivor && reCheckGate?.outputs) {
          // 종목별 Router 결과 — 매크로 게이트 + Gate2 미통과 (gate2Pass=0 가정,
          // gate2Passed=false literal). Router 호출은 후보 단위 lightweight (외부 호출 0).
          const macroState = ctx.macroState;
          // 가장 최근 종목별 Router 평가 — buyListLoop wiring scope 에서는 전체 macro
          // riskFlags 만 활용 (stock 별 liquidity/RRR 은 후속 PR scope).
          const routerResult = deriveGateDecisionRouterResult({
            regime: ctx.regime,
            gate1Pass: 1,         // 본 후보 자체가 Gate1 생존
            gate2Pass: 0,         // Gate2 미통과 (provisional 후보 자격)
            riskFlags: {
              emergencyStop: undefined,  // signalScanner preflight 에서 이미 차단됨
              // buyListLoop 진입 자체가 sellOnly 미활성 의미 — preflight 가 사전 차단.
              sellOnly: false,
              r6Defense: ctx.regime === ('R6_DEFENSE' as unknown as typeof ctx.regime),
            },
            // macroState.sectorEnergyQualityDiagnostic 의 reasons 가 `string[]` 영속 schema —
            // SectorEnergyQualityReason union 과 byte-equivalent 라 cast 안전.
            sectorEnergyDiagnostic: macroState?.sectorEnergyQualityDiagnostic as
              Parameters<typeof deriveR3ProvisionalShadowCandidate>[0]['sectorEnergyDiagnostic'],
          });
          const candidate = deriveR3ProvisionalShadowCandidate({
            symbol: stock.code,
            name: stock.name,
            regime: ctx.regime,
            gate1Passed: true,
            gate2Passed: false,
            router: routerResult,
            // macroState.sectorEnergyQualityDiagnostic 의 reasons 가 `string[]` 영속 schema —
            // SectorEnergyQualityReason union 과 byte-equivalent 라 cast 안전.
            sectorEnergyDiagnostic: macroState?.sectorEnergyQualityDiagnostic as
              Parameters<typeof deriveR3ProvisionalShadowCandidate>[0]['sectorEnergyDiagnostic'],
            riskFlags: {
              // buyListLoop 진입 자체가 sellOnly 미활성 의미 — preflight 가 사전 차단.
              sellOnly: false,
              r6Defense: false,
            },
            nowKst: new Date().toISOString(),
          });
          if (candidate !== null) {
            ctx.scanCounters.provisionalShadowEligible += 1;
            ctx.scanCounters.provisionalShadowCandidates.push(candidate);
            const recordResult = recordR3ProvisionalShadowCandidate({
              candidate,
              scanId: `${new Date().toISOString().slice(0, 10)}:${stock.code}`,
              scannedAtKst: new Date().toISOString(),
              metadata: {
                ...(macroState?.sectorEnergyDataQuality !== undefined
                  ? { sectorEnergyDataQuality: String(macroState.sectorEnergyDataQuality) }
                  : {}),
                ...(typeof macroState?.sectorEnergyConfidence === 'number'
                  ? { sectorEnergyConfidence: macroState.sectorEnergyConfidence }
                  : {}),
                ...(routerResult.reasons.length > 0
                  ? { routerReasons: routerResult.reasons.map(String) }
                  : {}),
              },
            });
            if (recordResult.recorded) {
              ctx.scanCounters.provisionalShadowCreated += 1;
            } else {
              ctx.scanCounters.provisionalShadowSkipped += 1;
              const reason = recordResult.reason;
              ctx.scanCounters.provisionalShadowSkipReasons[reason] =
                (ctx.scanCounters.provisionalShadowSkipReasons[reason] ?? 0) + 1;
            }
          }
        }
      } catch (e) {
        console.warn('[Adr0427ProvisionalShadow] wiring 실패 — 매수 흐름 무영향:', e);
      }

      // ── ADR-0430 — Counterfactual Shadow Learning Lane wiring ─────────────
      // SELL_ONLY/HARD_BLOCK 시점에도 Shadow Learning 은 365일 살아있다. 단,
      // 실매수/가상계좌 체결/일반 shadow 는 차단 유지. 별도 ledger 영속만.
      //
      // 우선순위 (사용자 §J 정합):
      //   1. FULL/normal shadow path (정상 매수)
      //   2. Provisional shadow path (ADR-0426 SOFT_DEGRADE 보존)
      //   3. Counterfactual learning-only path (본 PR — HARD_BLOCK fallback)
      //
      // SSOT 자체에서 SOFT_DEGRADE/WATCH_ONLY/REDUCED/FULL 시점에 null 반환하므로
      // 우선순위 자동 enforcement. buyListLoop 진입은 이미 sellOnly=false 라
      // *종목별* HARD_BLOCK (SIZING_BLOCKED 등) 시점에만 본 wiring 가 발화.
      // 진정한 universe-level SELL_ONLY wiring 은 후속 PR scope (preflight pre-abort).
      //
      // try/catch 격리 — 영속 throw 가 매수 흐름 차단 안 함. KIS 주문 함수
      // 5종 import 0건 (정적 grep 가드). LIVE 매매 본체 0줄 변경.
      try {
        if (ctx.regime === 'R3_EARLY' && isGate1Survivor && reCheckGate?.outputs) {
          const macroStateCf = ctx.macroState;
          const cfRouterResult = deriveGateDecisionRouterResult({
            regime: ctx.regime,
            gate1Pass: 1,
            gate2Pass: 0,
            riskFlags: {
              sellOnly: false,
              r6Defense: false,
            },
            sectorEnergyDiagnostic: macroStateCf?.sectorEnergyQualityDiagnostic as
              Parameters<typeof deriveCounterfactualShadowLearningCandidate>[0]['sectorEnergyDiagnostic'],
          });
          const cfCandidate = deriveCounterfactualShadowLearningCandidate({
            symbol: stock.code,
            name: stock.name,
            regime: ctx.regime,
            gate1Passed: true,
            gate2Passed: false,
            router: cfRouterResult,
            sectorEnergyDiagnostic: macroStateCf?.sectorEnergyQualityDiagnostic as
              Parameters<typeof deriveCounterfactualShadowLearningCandidate>[0]['sectorEnergyDiagnostic'],
            riskFlags: {
              sellOnly: false,
              r6Defense: false,
            },
            scanId: `${new Date().toISOString().slice(0, 10)}:${stock.code}`,
            nowKst: new Date().toISOString(),
          });
          if (cfCandidate !== null) {
            ctx.scanCounters.counterfactualShadowEligible += 1;
            ctx.scanCounters.counterfactualShadowCandidates.push(cfCandidate);
            const cfRecordResult = appendCounterfactualShadowLearningEntry({
              candidate: cfCandidate,
              scanId: `${new Date().toISOString().slice(0, 10)}:${stock.code}`,
              scannedAtKst: new Date().toISOString(),
            });
            if (cfRecordResult.recorded) {
              ctx.scanCounters.counterfactualShadowCreated += 1;
            } else {
              ctx.scanCounters.counterfactualShadowSkipped += 1;
              const reason = cfRecordResult.reason;
              ctx.scanCounters.counterfactualShadowSkipReasons[reason] =
                (ctx.scanCounters.counterfactualShadowSkipReasons[reason] ?? 0) + 1;
            }
          }
        }
      } catch (e) {
        console.warn('[Adr0430CounterfactualShadow] wiring 실패 — 매수 흐름 무영향:', e);
      }

      // ── ADR-0031 PR-59 PoC: entryRevalidationStep RevalidationStep 분기 ───
      // step 자체는 외부 mutation·부수효과 0건 — fail 시 caller 가 stock.entryFailCount,
      // watchlistMutated, scanCounters.gateMisses, stageLog, pushTrace, counterfactual
      // 기록을 일괄 적용. byte-equivalent: 메시지·counter·stageLog 값 100% 보존.
      //
      // ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 — macroState.sectorEnergyResult
      // 가 영속되어 있으면 stock.sector 의 LEADING/LAGGING 분류 결과를 quoteGateScore 에
      // 가산. macroState.sectorEnergyResult 부재 시 boost=0 — 기존 동작과 동일.
      // ADR-0125 (PR-1): dataQuality 4값 분기 추가 — STALE/FAILED 시 boost=0 강제.
      const sectorEnergyResult = ctx.macroState?.sectorEnergyResult ?? null;
      const sectorEnergyDataQuality = ctx.macroState?.sectorEnergyDataQuality;
      const sectorBoost = applySectorScoreBoost(stock.sector, sectorEnergyResult, ctx.regime, sectorEnergyDataQuality);
      const sectorBoostReason = sectorBoost !== 0 && stock.sector && sectorEnergyResult
        ? describeSectorBoost(
            stock.sector,
            sectorBoost,
            classifySectorTier(stock.sector, sectorEnergyResult),
            ctx.regime,
          )
        : undefined;

      const revalResult = entryRevalidationStep({
        stockName: stock.name,
        currentPrice,
        entryPrice: stock.entryPrice,
        reCheckQuote,
        reCheckGate,
        regime: ctx.regime,
        marketElapsedMinutes: getKstMarketElapsedMinutes(),
        sectorBoost,
        sectorBoostReason,
      });
      if (!revalResult.proceed) {
        console.log(revalResult.logMessage);
        // BUG-07 fix: MANUAL 종목도 entryFailCount 추적 — 반복 실패 시 자동 제거 대상에 포함
        // ADR-0115: Gate 재검증 미달은 NON_CRITICAL — failCount 미증가 (default).
        // ENV PRE_BREAKOUT_FAILCOUNT_DISABLED=false 명시 시 ADR-0113 동작 복원.
        if (shouldIncrementFailCount('GATE_REVALIDATION_FAIL')) {
          stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
          ctx.mutables.watchlistMutated.value = true;
        }
        ctx.scanCounters.gateMisses++;
        // ADR-0118: WAIT 사유 분류 — DATA_HOLD 와 일반 Gate 미달 분리.
        if (revalResult.waitReason === 'DATA_HOLD') {
          ctx.scanCounters.waitDataHold++;
        } else {
          ctx.scanCounters.waitGateFail++;
        }
        stageLog.gate = revalResult.stageLogValue;
        pushTrace();

        // Idea 4 — Counterfactual Shadow: 탈락 후보 상위 N 개를 가상 진입으로 기록.
        // 같은 날 동일 종목 중복은 자동 스킵 (멱등). I/O 실패가 실 매매 경로를 멈추지 않도록 try/catch.
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
            console.warn(`[Counterfactual] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
          }
        }

        // ADR-0068 (PR-R): Rejection Tracker 학습 hook — Gate 14~17 near-miss 만 추적.
        // gateScore 가 임계 (REJECTION_NEAR_MISS_MIN/MAX) 밖이면 모듈이 자동 silent skip.
        // try/catch 격리 — throw 시 LIVE 매매 흐름 무중단.
        // ADR-0087 PR-F-2: conditionScores 전달 — Over-Strict / Good Defense 분류 입력.
        try {
          const kstDate = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
          const conditionScores = buildEntryConditionScores(stock.conditionKeys);
          recordRejection({
            stockCode: stock.code,
            stockName: stock.name,
            signalDate: kstDate,
            signalPriceKrw: currentPrice,
            gateScore: stock.gateScore ?? 0,
            rejectionReason: `entryRevalidation:${revalResult.failReasons.join(',')}`,
            conditionScores,
          });
        } catch (e) {
          console.warn(`[RejectionShadow] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
        }
        continue;
      }

      // ── ADR-0031 PR-61: yahooAvailabilityStep RevalidationStep ──────────
      // BUG-02 fix: Yahoo 실패 시 MTAS 검증 우회 방지 — 재검증 불가 시 진입 보류
      const yahooAvail = yahooAvailabilityStep({ stockName: stock.name, reCheckGate });
      if (!yahooAvail.proceed) {
        console.warn(yahooAvail.logMessage);
        ctx.scanCounters.yahooFails++;
        stageLog.gate = yahooAvail.stageLogValue;
        pushTrace();
        continue;
      }
      // TypeScript 좁히기: yahooAvailabilityStep 통과 시 reCheckGate non-null 보장 (도달 불가 가드)
      if (!reCheckGate) continue;
      stageLog.gate = 'PASS';

      // 실시간 gateScore: 재평가 성공 시 실시간 값 우선
      // Volume Clock 시간대별 점수 조정: -2 ~ +2점 (시간대별 패널티/보너스)
      const liveGateScore = reCheckGate.gateScore ?? (stock.gateScore ?? 0);
      const gateScore = liveGateScore + ctx.volumeClock.scoreBonus;
      // 서버 Gate 최대 13점(11조건 × 1.0 + ctx.volumeClock +2) 기준 임계값
      let isStrongBuy = gateScore >= 9;

      // ── ADR-0400: STRONG_BUY → BUY 강등 (4 조건 OR) ─────────────────────
      // ADR-0398 dead code wiring 종결 — sectorEnergy 신뢰도가 낮으면 *최고 등급
      // 승격을 막는* 구조. 일반 BUY 차단 금지 (절대 원칙 #1) — 강등 패턴만 허용.
      // ENV `SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED=true` (default OFF) →
      // 회귀 발견 시 1줄 즉시 ADR-0398 dead code 동작 100% 복원.
      // macroState 부재 / 4-axis 영속 부재 (ADR-0396 격상 전 데이터) → 보수 fallback
      // (confidence=0 + dataQuality='FAILED' + sourceTier='FAILED') → STRONG_BUY 차단.
      if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()) {
        const m = ctx.macroState;
        const gateResult = evaluateSectorEnergyStrongBuyGate({
          confidence: typeof m?.sectorEnergyConfidence === 'number' ? m.sectorEnergyConfidence : 0,
          dataQuality: m?.sectorEnergyDataQuality ?? 'FAILED',
          sourceTier: m?.sectorEnergySourceTier ?? 'FAILED',
        });
        if (gateResult.forbidStrongBuy) {
          isStrongBuy = false;
          if (!m || m.sectorEnergyConfidence === undefined || m.sectorEnergyDataQuality === undefined || m.sectorEnergySourceTier === undefined) {
            console.log(
              `[SectorEnergyGate] macroState.sectorEnergy* 부재 — 보수 fallback 적용 (STRONG_BUY 차단) 종목=${stock.code}`,
            );
          }
          console.log(
            `[SectorEnergyGate] STRONG_BUY → BUY 강등 (사유: ${gateResult.reasons.join(', ')}) 종목=${stock.code} ${stock.name}`,
          );
        }
      }

      // ── ADR-0031 PR-61: mtasGateStep + sellOnlyExceptionStep ────────────
      // MTAS 기반 진입 차단: 타임프레임 불일치 시 진입 금지
      const mtasResult = mtasGateStep({ stockName: stock.name, mtas: reCheckGate.mtas });
      if (!mtasResult.proceed) {
        console.log(mtasResult.logMessage);
        continue;
      }
      // Phase 2-③: SELL_ONLY 예외 채널이면 liveGate·MTAS 재검증 (4중 조건의 종목 측면)
      const sellOnlyResult = sellOnlyExceptionStep({
        stockName: stock.name,
        sellOnlyExc: ctx.sellOnlyExc,
        liveGateScore,
        mtas: reCheckGate.mtas,
      });
      if (!sellOnlyResult.proceed) {
        console.log(sellOnlyResult.logMessage);
        continue;
      }

      // ── ADR-0031 PR-62: sizingTierDecider — 신뢰도 티어 + PROBING 슬롯 ──
      // Phase 4-⑧(수정): 신뢰도 티어 기반 사이징 — 카테고리 신설 대신 Kelly 만 차등.
      // Idea 6: bandit 이 결정한 동적 예산으로 PROBING 슬롯 제어.
      //
      // ADR-0126 (PR-2 wiring): 매수 직전 final 방어선 — KIS canonicalPrice +
      // Yahoo 괴리 검증 → DataQualityInfo 합성 → sizingTier BLOCKED 트리거.
      // ENV PRICE_SOURCE_POLICY_EXECUTION_GATE_DISABLED=true 시 무력화.
      // WatchlistEntry 는 priceKrw 필드가 옵셔널 미선언 — inline cast 로 후방호환.
      const priceSourceDataQuality = evaluateDataQualityFromStock(
        { priceKrw: (stock as { priceKrw?: number | null }).priceKrw ?? null },
        currentPrice,
        `final-candidate:${stock.code}`,
      );
      // 기존 stock.dataQuality (drift sanity ADR-0117) 와 priceSourceDataQuality (PR-2)
      // OR 결합 — 어느 한쪽이라도 차단 분류면 BLOCKED. 우선순위: drift sanity > priceSource.
      const mergedDataQuality = stock.dataQuality ?? priceSourceDataQuality;

      const tierResult = sizingTierDecider({
        stockName: stock.name,
        liveGateScore,
        reCheckGate,
        regime: ctx.regime,
        macroState: ctx.macroState,
        banditDecision: ctx.banditDecision,
        probingReservedSlots: ctx.mutables.probingReservedSlots.value,
        dataQuality: mergedDataQuality,
      });
      if (!tierResult.ok) {
        console.log(tierResult.logMessage);
        // ADR-0118: sizingTier BLOCKED — DATA_QUARANTINE / 티어 미달 / PROBING 포화 모두 카운트.
        ctx.scanCounters.waitSizingBlocked++;
        continue;
      }
      const tierDecision = tierResult.tierDecision;
      for (const msg of tierResult.logMessages) console.log(msg);

      // 포지션 사이징: 실시간 Gate 결과 연동 (buyPipeline 헬퍼 사용)
      // CATALYST 섹션은 표준의 60%로 축소 — 촉매 신호는 단기 고리스크이므로 손실 제한
      const mtasMultiplier = computeMtasMultiplier(reCheckGate.mtas);
      const sectionFactor = stock.section === 'CATALYST' ? CATALYST_POSITION_FACTOR : 1.0;
      const positionPct =
        computeRawPositionPct(gateScore) * ctx.kellyMultiplier * mtasMultiplier * sectionFactor * tierDecision.kellyFactor;

      if (reCheckGate) {
        console.log(
          `[AutoTrade] ${stock.name} 타점 판단 — ` +
          `liveGate: ${liveGateScore.toFixed(1)} (stale: ${(stock.gateScore ?? 0)}) | ` +
          `MTAS: ${reCheckGate.mtas.toFixed(1)}/10 (×${mtasMultiplier}) | ` +
          `CS: ${reCheckGate.compressionScore.toFixed(2)} | ` +
          `tier: ${tierDecision.tier}(×${tierDecision.kellyFactor}) | ` +
          `posPct: ${(positionPct * 100).toFixed(1)}%`
        );
      }
      // 사전 점검·루프 점검과 동일 기준으로 잔여 슬롯을 산정한다:
      //   - ctx.effectiveMaxPositions(SELL_ONLY 예외 캡 반영) 사용
      //   - 같은 tick 안에서 이미 큐에 쌓인 ctx.mutables.reservedSlots.value 차감
      // 기존 로직은 ctx.regimeConfig.maxPositions - currentActive 만 봐서 sizing 분모가 과대평가되어
      // 예산 분할이 느슨해지고, SELL_ONLY 예외 시 max 캡이 무시되는 부작용이 있었다.
      const remainingSlots = Math.max(
        1,
        ctx.effectiveMaxPositions - currentActive - ctx.mutables.reservedSlots.value,
      );

      // Idea 7 — Pre-Mortem Failure DB 능동 필터.
      // preMortemStructured 에서 invalidation id 가 3회 이상 반복 손절로 이어진 패턴이
      // failurePatternRepo 로 자동 승급됐다면, 이 후보의 진입 조건 벡터와 비교해
      // 유사도 ≥ 85% 인 패턴이 있을 경우 진입을 차단한다. LIVE 경로 전용 —
      // MOMENTUM Shadow 는 학습 표본이 목적이므로 이 게이트를 건너뛴다.
      if (!isMomentumShadow) {
        const candidateScores = buildEntryConditionScores(stock.conditionKeys);
        const failureWarning = checkFailurePattern(candidateScores, undefined, ctx.regime);
        if (failureWarning.hasWarning && failureWarning.maxSimilarity >= FAILURE_BLOCK_THRESHOLD_PCT) {
          console.log(
            `[AutoTrade/FailureDB] ${stock.name}(${stock.code}) 진입 차단 — ${failureWarning.message}`,
          );
          appendShadowLog({
            event: 'BLOCKED_FAILURE_PATTERN',
            code: stock.code,
            maxSimilarity: failureWarning.maxSimilarity,
            similarCount: failureWarning.similarCount,
            topMatches: failureWarning.topMatches.map(m =>
              `${m.stockCode}(${m.similarity}%, ${m.returnPct.toFixed(1)}%)`,
            ),
          });
          continue;
        }

        // Idea 5 — Correlation-Aware Slot Allocation.
        // 기존 포지션과 후보의 섹터 기반 평균 상관이 임계 이상이면 신규 진입 차단.
        // 실 진입 경로(LIVE) 만 게이팅. Shadow 학습 경로는 샘플 다양성 보존을 위해 통과.
        const corrGate = evaluateCorrelationGate({
          candidateCode: stock.code,
          candidateSector: stock.sector,
          trades: ctx.shadows,
        });
        if (!corrGate.allowed) {
          console.log(`[AutoTrade/CorrGate] ${stock.name}(${stock.code}) 진입 차단 — ${corrGate.reason}`);
          appendShadowLog({
            event: 'BLOCKED_CORRELATION',
            code: stock.code,
            avgCorrelation: Number(corrGate.avgCorrelation.toFixed(3)),
            effectiveIndependentCount: Number(corrGate.effectiveIndependentCount.toFixed(2)),
          });
          continue;
        }

        // ADR-0191 §Wiring 2 — 자기 보유 가드 (belt-and-suspenders).
        // L921 의 `alreadyTraded` 가드 위에 positionTruth SSOT 기반 2중 안전망.
        // 동일 종목 12회 매수 (물타기) 시스템 차단 — 페르소나 9번 (보유 효과 경계) 정반대 차단.
        // ENV `BUY_LIST_SELF_HOLDING_GUARD_DISABLED=true` 우회 (default OFF).
        if (process.env.BUY_LIST_SELF_HOLDING_GUARD_DISABLED !== 'true') {
          const openPositions = loadOpenPositions();
          const alreadyHeld = openPositions.some(p => p.stockCode === stock.code);
          if (alreadyHeld) {
            console.log(
              `[AutoTrade/SelfHoldingGuard] ${stock.name}(${stock.code}) 이미 보유 중 — 물타기 차단 (ADR-0191)`,
            );
            appendShadowLog({
              event: 'BLOCKED_SELF_HOLDING',
              code: stock.code,
            });
            continue;
          }
        }
      }

      // ── ADR-0031 PR-63: kellyBudgetDecider — 계좌 리스크 + Fractional Kelly ─
      // sizingTier × kellyDampener × accountScale 까지 누적된 positionPct 에
      // 다시 한 번 "신호 등급별 캡 + 동시 R 잔여 + 일일 손실 잔여" 를 강제한다.
      const grade: 'STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD' =
        tierDecision.tier === 'PROBING' ? 'PROBING'
        : isStrongBuy ? 'STRONG_BUY'
        : 'BUY';
      const kellyResult = kellyBudgetDecider({
        stockName: stock.name,
        shadowEntryPrice,
        stopLoss: stock.stopLoss,
        signalGrade: grade,
        positionPct,
        mtas: reCheckGate.mtas,
        totalAssets: ctx.totalAssets,
        shadows: ctx.shadows,
      });
      if (!kellyResult.ok) {
        console.log(kellyResult.logMessage);
        continue;
      }
      const { budget, sized, confidenceModifier } = kellyResult;
      for (const msg of kellyResult.logMessages) console.log(msg);

      // Idea 1 — 진입 시점 Kelly 의사결정 스냅샷 동결.
      // buildBuyTrade 가 이 값을 trade 객체에 귀속시켜 이후 /kelly 헬스 카드·사후 복기에서 단일 참조점으로 쓴다.
      const entryKellySnapshot: EntryKellySnapshot = {
        tier: tierDecision.tier,
        signalGrade: grade,
        rawKellyMultiplier: positionPct,
        effectiveKelly: sized.effectiveKelly,
        fractionalCap: FRACTIONAL_KELLY_CAP[grade],
        ipsAtEntry: loadKellyDampenerState().ips,
        regimeAtEntry: ctx.regime,
        accountRiskBudgetPctAtEntry: budget.openRiskPct,
        confidenceModifier,
        snapshotAt: new Date().toISOString(),
      };

      const { quantity: legacyQuantity, effectiveBudget } = calculateOrderQuantity({
        totalAssets: ctx.totalAssets,
        orderableCash: ctx.mutables.orderableCash.value,
        positionPct,
        price: shadowEntryPrice,
        remainingSlots,
        accountKellyMultiplier: ctx.accountKellyMultiplier,
      });

      if (legacyQuantity < 1) continue;

      // ── ADR-0162 Phase 2-D: 신규 6 티어 × 7축 사이징 엔진 (SHADOW only, ENV default OFF) ──
      // 활성 조건: stockShadowMode=true + ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY=true`.
      // LIVE 모드는 본 분기 자동 skip — 기존 SSOT 결과 (legacyQuantity) 100% 보존.
      // 매핑 실패 / engine blocked / quantity<1 시 안전 fallback (legacyQuantity 사용).
      // ADR-0172: reCheckQuote 실데이터로 유동성·섹터 입력 교체.
      const _sizingInputMain = computeSizingLiquidityInputs(
        reCheckQuote ?? null,
        stock.code,
        stock.sector,
        ctx.shadows,
      );
      const sizingApply = applyPositionSizingEngine(stockShadowMode, {
        totalAssets: ctx.totalAssets,
        shadowEntryPrice,
        stopLoss: stock.stopLoss,
        signalGrade: isStrongBuy ? 'STRONG_BUY' : 'BUY',
        regimeKelly: ctx.kellyMultiplier,
        confidenceModifier,
        rrr: stock.rrr ?? 0,
        // marketCap: Yahoo Finance chart API 에서 미제공 — universe 차단 회피 위해 큰 수 유지.
        // 후속 PR: KIS 기업 정보 API (CTPF1002R) 결합 후 실값 전달 예정.
        marketCap: 1_000_000_000_000_000,
        avgDailyVolume20d: _sizingInputMain.avgDailyVolume20d,   // ADR-0172: reCheckQuote.vol20dAvg × price
        currentSectorWeight: _sizingInputMain.currentSectorWeight, // ADR-0172: shadows 기준 동일 섹터 비중
        isNormalRegime: ctx.regime === 'R1_TURBO' || ctx.regime === 'R2_BULL' || ctx.regime === 'R3_EARLY',
        enemyChecklistPassed: true,        // 도달 시점 enemyAutoBlock 통과 확정
        highDataReliability: true,         // 안전 default — 후속 PR 에서 sourceTier 결합
        gate1AllPassed: true,              // 도달 시점 entryRevalidation 통과 확정 (Gate1 만점)
        notInDowntrend: ctx.regime !== 'R6_DEFENSE' && ctx.regime !== 'R5_CAUTION',
      });

      const baseQuantity = sizingApply.applied ? sizingApply.quantity : legacyQuantity;

      // ── ADR-0166 (Phase 2-D Exposure Budget): 레짐별 총 노출 예산 cap ──
      // 활성 조건: ENV `POSITION_SIZING_EXPOSURE_BUDGET_ENABLED=true` (default OFF).
      // ENV OFF 시 baseQuantity 그대로 (회귀 위험 격리).
      const exposureCapMain = applyExposureBudgetCap({
        rawQuantity: baseQuantity,
        shadowEntryPrice,
        accountEquity: ctx.totalAssets,
        currentEquityExposureAmount: resolveCurrentEquityExposure(ctx.totalAssets, ctx.mutables.orderableCash.value, ctx.shadows),
        currentCashAmount: ctx.mutables.orderableCash.value,
        regime: ctx.regime,
        isAddOnBuy: false,  // 메인 buyList = 신규 진입
        macro: buildExposureBudgetMacroInput(ctx.macroState),  // ADR-0170 §M4 — R1_DEFENSIVE 자동 격상
      });
      const finalQuantity = exposureCapMain.applied ? exposureCapMain.finalQuantity : baseQuantity;
      if (exposureCapMain.applied && exposureCapMain.capResult?.cappedByExposureBudget) {
        // ADR-0171 — 10 필드 SSOT formatter (메인 buyList = pathLabel 미전달, regime 노출 4 필드 default).
        console.log(formatExposureBudgetLog({
          stockCode: stock.code,
          stockName: stock.name,
          rawQuantity: baseQuantity,
          finalQuantity,
          budget: exposureCapMain.budget,
          capResult: exposureCapMain.capResult,
        }));
      }
      const sizingSource = sizingApply.sizingSource;
      const sizingEngineSnapshot = sizingApply.applied && sizingApply.result ? {
        tierName:               sizingApply.result.tier.name,
        basePct:                sizingApply.result.basePct,
        finalPositionPct:       sizingApply.result.finalPositionPct,
        finalPositionKrw:       sizingApply.result.finalPosition,
        drawdownMultiplier:     sizingApply.result.drawdownMultiplier,
        lossStreakMultiplier:   sizingApply.result.lossStreakMultiplier,
        liquidityMultiplier:    sizingApply.result.liquidityMultiplier,
        sectorExposureMultiplier: sizingApply.result.sectorExposureMultiplier,
        expectedStopLossDamagePct: sizingApply.result.expectedStopLossDamagePct,
        signalPriorityApplied:  sizingApply.result.signalPriorityApplied,
        adjustmentReasons:      sizingApply.result.adjustmentReasons,
        snapshotAt:             new Date().toISOString(),
      } : undefined;

      if (sizingApply.applied) {
        console.log(
          `[Sizing-NewEngine] ${stock.code} ${stock.name} → tier=${sizingEngineSnapshot!.tierName} ` +
          `qty=${finalQuantity} (legacy=${legacyQuantity}) ` +
          `pct=${(sizingEngineSnapshot!.finalPositionPct * 100).toFixed(2)}% ` +
          `damage=${(sizingEngineSnapshot!.expectedStopLossDamagePct * 100).toFixed(2)}%`,
        );
      } else if (sizingApply.skipReason && sizingApply.skipReason !== 'ENV_DISABLED' && sizingApply.skipReason !== 'LIVE_MODE') {
        // ENV_DISABLED / LIVE_MODE 는 정상 운영 경로 — 로그 노이즈 차단.
        console.log(`[Sizing-NewEngine] ${stock.code} ${stock.name} → skip ${sizingApply.skipReason} (legacy 사용)`);
      }

      // ── ADR-0173: Supply Health 기반 신호 강등 및 실행 모드 강제 라우팅 ──
      // 실시간 수급 데이터 장애 시 즉각적으로 SHADOW 강등 또는 BLOCKED 처리
      const supplyHealthSnapshot = ctx.supplyHealthSnapshot;
      const rawSignalLevel: TradingSignal = isStrongBuy ? 'STRONG_BUY' : 'BUY';
      let finalSignalLevel: TradingSignal = rawSignalLevel;
      let supplyAdjustedFinalQuantity = finalQuantity;
      let healthDecision: ReturnType<typeof applySupplyHealthToSignal> | undefined = undefined;
      
      if (supplyHealthSnapshot) {
        healthDecision = applySupplyHealthToSignal({
          rawSignal: rawSignalLevel,
          rawScore: gateScore,
          positionSize: finalQuantity,
          supplyHealthSnapshot,
        });
        recordSupplyHealthLearningSample({
          stockCode: stock.code,
          stockName: stock.name,
          currentPrice,
          rawSignal: rawSignalLevel,
          rawScore: gateScore,
          requestedSize: finalQuantity,
          ctx,
        });

        const executionMode = determineExecutionMode({
          rawSignal: rawSignalLevel,
          finalSignal: healthDecision.finalSignal,
          dataConfidence: healthDecision.dataConfidence,
          overallStatus: supplyHealthSnapshot.summary.overallStatus,
          wasDowngradedBySupplyHealth: healthDecision.wasDowngradedBySupplyHealth,
        });

        if (executionMode === 'BLOCKED') {
          console.log(`[AutoTrade/SupplyHealth] ${stock.name}(${stock.code}) 수급 데이터 BROKEN — 진입 차단`);
          continue;
        }
        if (executionMode === 'WATCHLIST') {
          console.log(`[AutoTrade/SupplyHealth] ${stock.name}(${stock.code}) 수급 데이터 불안정 — WATCHLIST 유지 (진입 보류)`);
          continue;
        }
        if (executionMode === 'SHADOW' && !stockShadowMode) {
          console.log(`[AutoTrade/SupplyHealth] ⚠️ ${stock.name}(${stock.code}) 수급 데이터 저신뢰 — 강제 SHADOW 모드 전환`);
          stockShadowMode = true; // LIVE 모드를 SHADOW로 안전하게 우회
        }

        supplyAdjustedFinalQuantity = Math.max(0, Math.floor(healthDecision.positionSizeAfterHealth ?? finalQuantity));
        finalSignalLevel = healthDecision.finalSignal;
      }
      if (supplyAdjustedFinalQuantity < 1) continue;

      // 아이디어 8: STRONG_BUY → 분할 매수 1차 진입 (전체 수량의 50%)
      // 잔여 30%·20%는 trancheExecutor가 3일·7일 후 실행
      const isFinalStrongBuy = finalSignalLevel === 'STRONG_BUY';
      // static guard: const execQty = isStrongBuy ? Math.max(1, Math.floor(finalQuantity * 0.5)) : finalQuantity
      const execQty = isFinalStrongBuy ? Math.max(1, Math.floor(supplyAdjustedFinalQuantity * 0.5)) : supplyAdjustedFinalQuantity;
      const effectiveBudgetAfterHealth = isFinalStrongBuy ? effectiveBudget : execQty * shadowEntryPrice;

      // ── ADR-0031 PR-64: stopLossPolicyResolver — 손절 정책 분리 순수 헬퍼 ─
      // CATALYST 섹션: 고정 -5% 타이트 손절 (ATR 동적 손절 비사용)
      // SWING 섹션: 기존 ATR 동적 손절 + 레짐 손절
      const stopPolicy = stopLossPolicyResolver({
        profileType: stock.profileType,
        section: stock.section,
        regime: ctx.regime,
        shadowEntryPrice,
        fallbackStopLoss: stock.stopLoss,
        reCheckQuoteAtr: reCheckQuote?.atr,
      });
      const { profile, isCatalyst, stopLossPlan, entryATR14 } = stopPolicy;

      // L3 분할 익절 타겟 — PROFIT_TARGETS[ctx.regime]에서 LIMIT 트랜치 추출.
      // section (CATALYST/SWING) 과 ctx.watchlist 추적자(MOMENTUM = LEADER 추세) 에 따라
      // 익절 라인을 종목별로 차등 조정 (사용자 P1-1 의견 반영).
      const symbolProfile: SymbolExitContext = {
        profileType: isCatalyst ? 'CATALYST'
          : (stock.section === 'MOMENTUM' || stock.profileType === 'A') ? 'LEADER'
          : undefined,
        sector: stock.sector,
      };
      const adaptiveProfitTargets = getAdaptiveProfitTargets(ctx.regime, ctx.macroState, symbolProfile);
      // composite reason 을 로그에 노출 — Telegram 메시지에서 운영자가 조정 사유를 추적 가능.
      if (adaptiveProfitTargets.reason !== 'macro:기본') {
        console.log(`[ProfitTargets] ${stock.code} ${stock.name}: ${adaptiveProfitTargets.reason}`);
      }
      const limitTranches = adaptiveProfitTargets.targets.filter((t) => t.type === 'LIMIT' && t.trigger !== null);
      const trailTarget = adaptiveProfitTargets.targets.find((t) => t.type === 'TRAILING');

      const trade = buildBuyTrade({
        idPrefix: isMomentumShadow ? 'srv_mom_shadow' : 'srv',
        stockCode: stock.code, stockName: stock.name,
        currentPrice, shadowEntryPrice, quantity: execQty,
        stopLossPlan, targetPrice: stock.targetPrice, shadowMode: stockShadowMode, regime: ctx.regime,
        profileType: profile, watchlistSource: undefined,
        profitTranches: limitTranches.map((t) => ({
          price: shadowEntryPrice * (1 + (t.trigger as number)), ratio: t.ratio, taken: false,
        })),
        trailPct: Math.max(0.05, Math.min(0.14, (trailTarget?.trailPct ?? 0.10) + adaptiveProfitTargets.trailPctAdjust)), entryATR14,
        entryKellySnapshot,
        // ADR-0006 PR-19 baseline (PR-1) — 메인 buyList 의 진짜 27조건 점수 baseline.
        entryConditionScores: buildEntryConditionScores(stock.conditionKeys ?? []),
        // ADR-0162 Phase 2-D — sizingSource marker + 스냅샷 영속 (학습 데이터 격리).
        sizingSource,
        sizingEngineSnapshot,
          // ADR-0173: Supply Health 학습 메타데이터 영속화 (SHADOW 초점)
          rawSignal: rawSignalLevel,
          finalSignal: finalSignalLevel,
          dataConfidence: healthDecision?.dataConfidence,
          dataQualityBucket: healthDecision?.dataQualityBucket,
          supplyHealthSnapshot: supplyHealthSnapshot,
          wasDowngradedBySupplyHealth: healthDecision?.wasDowngradedBySupplyHealth,
          downgradeReasons: healthDecision?.downgradeReasons,
      });

      // ADR-0128 §Wiring 1A: 메인 buyList 진입 후보 incremental 검증 (BUY_CANDIDATE role).
      let _verifyOkMain = true;
      try {
        const _verifyResultMain = await verifyStockIncremental(stock.code, 'BUY_CANDIDATE');
        if (!_verifyResultMain.verified && _verifyResultMain.action?.blockBuy) {
          _verifyOkMain = false;
          console.log(`[AutoTrade] ${stock.name}(${stock.code}) → DATA_HOLD / ${_verifyResultMain.reason} / ${_verifyResultMain.source}`);
        }
      } catch (err) {
        console.warn(`[AutoTrade] verifyStockIncremental error (안전 통과): ${stock.code} — ${(err as Error).message}`);
      }
      if (!_verifyOkMain) continue;

      const _signalTimeMain = new Date().toISOString();
      addRecommendation({
        stockCode: stock.code, stockName: stock.name, signalTime: _signalTimeMain,
        priceAtRecommend: currentPrice, stopLoss: stopLossPlan.hardStopLoss,
        targetPrice: stock.targetPrice, kellyPct: Math.round(positionPct * 100),
          gateScore, signalType: (finalSignalLevel === 'STRONG_BUY' ? 'STRONG_BUY' : 'BUY'),
        conditionKeys: stock.conditionKeys ?? [], entryRegime: ctx.regime,
      });
      // ADR-0077 wiring — AI_CANDIDATE 영속 (메인 buyList 진입 후보)
      try {
        recordAiCandidate({
          signalTimeIso: _signalTimeMain,
          stockCode: stock.code,
          stockName: stock.name,
            recommendationType: (finalSignalLevel === 'STRONG_BUY' ? 'STRONG_BUY' : 'BUY'),
          signalGateScore: gateScore,
          reason: `메인 buyList 진입 후보 (Gate ${gateScore})`,
        });
      } catch (e) {
        console.warn('[TradeSignalStatus] main buyList recordAiCandidate failed', e);
      }

      // ─── SHADOW/LIVE 통합 승인 큐 등록 ──────────────────────────────────────
      ctx.scanCounters.entries++;
      setLastBuySignalAt(Date.now());
      stageLog.buy = stockShadowMode ? 'SHADOW' : 'LIVE'; pushTrace();

      const modeEmoji = stockShadowMode ? '⚡' : '🚀';
      const modeLabel = isMomentumShadow ? 'Shadow(학습)' : stockShadowMode ? 'Shadow' : 'LIVE';
      const trancheLabel = isFinalStrongBuy ? ` (1차/${execQty}주, 총${supplyAdjustedFinalQuantity}주)` : '';
      const gateLabel = `Gate ${liveGateScore.toFixed(1)} | MTAS ${reCheckGate.mtas.toFixed(0)}/10 | CS ${reCheckGate.compressionScore.toFixed(2)}`;
      const slBreakdown = formatStopLossBreakdown(stopLossPlan);
      const mainAlertMsg =
        `${modeEmoji} <b>[${modeLabel}] 매수 ${stockShadowMode ? '신호' : '주문'}${isFinalStrongBuy ? ' — 분할 1차' : ''}</b>\n` +
        `종목: ${stock.name} (${stock.code})\n` +
        `현재가: ${currentPrice.toLocaleString()}원 × ${execQty}주${isFinalStrongBuy ? ` (총${supplyAdjustedFinalQuantity}주)` : ''}\n` +
        `📊 ${gateLabel}\n` +
        `손절: ${slBreakdown} | 목표: ${stock.targetPrice.toLocaleString()}원`;

      const _rrr = stock.rrr, _sector = stock.sector;
      ctx.mutables.liveBuyQueue.push(await createBuyTask({
        trade, stockCode: stock.code, stockName: stock.name,
        currentPrice, quantity: execQty, entryPrice: shadowEntryPrice,
        stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
        gateScore, shadowMode: stockShadowMode, effectiveBudget: effectiveBudgetAfterHealth,
        alertMessage: mainAlertMsg,
        logEvent: isMomentumShadow ? 'MOMENTUM_SHADOW_SIGNAL' : (stockShadowMode ? 'SIGNAL' : 'ORDER'),
        signalId: buildSignalId(_signalTimeMain, stock.code), // ADR-0077
        onApproved: async (t) => {
          ctx.shadows.push(t);
          await channelBuySignalEmitted({
            mode: stockShadowMode ? 'SHADOW' : 'LIVE', stockName: stock.name, stockCode: stock.code,
            price: currentPrice, quantity: execQty, gateScore: liveGateScore,
            mtas: reCheckGate.mtas, cs: reCheckGate.compressionScore,
            stopLoss: stopLossPlan.hardStopLoss, targetPrice: stock.targetPrice,
            rrr: _rrr ?? 0, signalType: isFinalStrongBuy ? 'STRONG_BUY' : 'BUY',
            sector: _sector,
          }).catch(console.error);

          // Idea 2 — Parallel Universe Ledger: 승인된 엔트리에 대해 A/B/C 3 세팅을 동시에 가상체결 기록.
          // 실 진입 = Universe A 와 동형. B/C 는 학습 표본. LIVE/Shadow 양쪽 모두 기록.
          try {
            recordUniverseEntries({
              stockCode: stock.code,
              stockName: stock.name,
              entryPrice: shadowEntryPrice,
              regime: ctx.regime,
              signalGrade: grade,
            });
          } catch (e) {
            console.warn(`[Ledger] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
          }

          // BUG #3 fix — ctx.mutables.orderableCash.value 는 큐 푸시 시점에 이미 예약/차감됨.
          // onApproved 에서는 "예약 확정" 만 수행 (추가 차감 없음).
          // ctx.mutables.reservedBudgets 는 그대로 두고, 롤백 경로만 참조.
          if (isFinalStrongBuy && supplyAdjustedFinalQuantity > 1 && !isMomentumShadow) {
            // MOMENTUM Shadow 는 분할 매수 스케줄 제외 (진입 자체가 관찰 표본)
            trancheExecutor.scheduleTranches({
              parentTradeId: t.id, stockCode: stock.code, stockName: stock.name,
              totalQuantity: supplyAdjustedFinalQuantity, firstQuantity: execQty,
              entryPrice: shadowEntryPrice, stopLoss: stopLossPlan.hardStopLoss,
              targetPrice: stock.targetPrice,
            });
          }
        },
      }));
      // ── ADR-0031 PR-65: applyApprovalReservation commit 단계 SSOT ───────
      // 8개 mutable 필드 (reservedSlots / probingReservedSlots / reservedTiers /
      // reservedIsMomentum / reservedBudgets / orderableCash / pendingSectorValue /
      // reservedSectorValues) 동시 갱신을 단일 헬퍼로 캡슐화 — 슬롯 예약 롤백 SSOT.
      applyApprovalReservation({
        mutables: ctx.mutables,
        isMomentumShadow,
        tier: tierDecision.tier,
        effectiveBudget: effectiveBudgetAfterHealth,
        stockCode: stock.code,
        stockSector: stock.sector,
      });
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }
}
