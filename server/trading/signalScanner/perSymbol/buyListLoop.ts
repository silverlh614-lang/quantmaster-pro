/**
 * @responsibility 메인 buyList 루프 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가
 * ADR-0019: entry revalidation gate block extracted from evaluateBuyList.
 * ADR-0019: sizing tier final decision block extracted from evaluateBuyList.
 * ADR-0019: R3 provisional shadow lane derive block extracted from evaluateBuyList.
 * ADR-0019: entry price drift check block extracted from evaluateBuyList.
 * ADR-0019: KIS intraday correction gate block extracted from evaluateBuyList.
 * ADR-0019: pre-breakout followthrough/entry blocks extracted from evaluateBuyList.
 *
 * ADR-0134 (PR-Refactor-2) — perSymbolEvaluation.ts 분해 시 evaluateBuyList 격리.
 * signalScanner.ts L528~L1456 (929줄) 와 100% 동작 일치 (byte-equivalent 이주).
 */

import { logger, logNoiseDetail, logVisibilityEvent } from '../../../utils/logger.js';

import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import {
  MAX_SECTOR_CONCENTRATION,
} from '../../riskManager.js';
import { evaluatePortfolioRisk } from '../../portfolioRiskEngine.js';
import { checkSectorExposureBefore } from '../../preOrderGuard.js';
import { getExecutionCostConfig } from '../../executionCosts.js';
import { classifySizingTier, PROBING_MAX_SLOTS } from '../../sizingTier.js';
import {
  canReserveBanditProbingSlot,
} from '../../../learning/probingBandit.js';
import { buildEntryConditionScores } from '../../../learning/entryConditionScores.js';
import { computeSlotConsumption } from '../../slotAccounting.js';
// ADR-0068 (PR-R): Shadow Learning Hooks — PR-L (Rejection Tracker) + PR-M (Twin Portfolio) wiring
import { recordTwinEntries } from '../../../learning/counterfactualTwinPortfolio.js';
import { addRecommendation } from '../../../learning/recommendationTracker.js';
import { recordAiCandidate, buildSignalId } from '../../../persistence/tradeSignalStatusRepo.js';
import { evaluateServerGate } from '../../../quantFilter.js';
import { fillMonitor } from '../../fillMonitor.js';
import {
  yahooAvailabilityStep,
  mtasGateStep,
  sellOnlyExceptionStep,
} from '../revalidationSteps/index.js';
// ADR-0400: STRONG_BUY 4 조건 OR confidence gate wiring (ADR-0398 dead code 종결).
import {
  evaluateSectorEnergyStrongBuyGate,
  isSectorEnergyStrongBuyGateWiringDisabled,
} from '../../sectorEnergyStrongBuyGate.js';
import {
  stopLossPolicyResolver,
} from '../sizingDeciders/index.js';
import {
  shouldIncrementFailCount,
} from '../failureClassifier.js';
// ADR-0128 §Wiring 1+2 — DataHoldRolePolicy SSOT 위임 + verifyStockIncremental BUY_CANDIDATE.
import { verifyStockIncremental } from '../../../data/dataVerificationIncremental.js';
// ADR-0191 §Wiring 2 — 자기 보유 가드 SSOT (positionTruth) — 동일 종목 12회 매수 (물타기) 차단.
import {
  isOpenShadowStatus,
  calculateOrderQuantity,
} from '../../entryEngine.js';
import { checkCooldownRelease } from '../../regretAsymmetryFilter.js';
import { getKstIntradaySession } from '../emptyScanTaxonomy.js';
import {
  computeMtasMultiplier,
  computeRawPositionPct,
  buildBuyTrade,
  createBuyTask,
} from '../../buyPipeline.js';
import {
  accumulateFreshConditionOutputs,
  accumulateGate2ConditionOutputs,
  accumulateGateEligibility,
  recordPipelineStage,
} from '../scanDiagnostics.js';
// ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE).
//   분류 layer 만 — KIS 주문 호출 0건. 결과 ScanCounters 누적 only,
//   실제 매수 흐름 변경 0 (counterfactual ledger wiring 은 후속 PR scope).
// ADR-0427 — R3_EARLY Provisional Shadow Lane wiring.
//   ADR-0426 SSOT (deriveR3ProvisionalShadowCandidate) 호출 + provisionalShadowLedger 영속.
//   LIVE 매매 본체 0줄 변경, KIS 주문 import 0건. Gate1 survivor 분기 직후 try/catch 격리.
// ADR-0430 — Counterfactual Shadow Learning Lane (SELL_ONLY/HARD_BLOCK fallback).
//   ADR-0427 provisional null 반환 시점 (HARD_BLOCK 등) 에 학습 전용 record 영속.
//   별도 ledger (counterfactual-shadow-learning-ledger.json), virtual account 무관,
//   KIS 주문 함수 import 0건. learning-only 마커 명시.
import { deriveGateDecisionRouterResult } from '../gateDecisionRouter.js';
// Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow approval 중복 발송 차단 SSOT.
//   evaluateBuyList 진입부 1회 deriveShadowApprovalContext() 호출 → 모든 createBuyTask 에 propagate.
//   LIVE 모드 무영향 (SHADOW 모드 + tradeDate + marketSession 모두 전달 시 buyPipeline / buyApproval 측 guard 활성).
import { deriveShadowApprovalContext } from '../../../telegram/shadowApprovalDedupeStore.js';
// Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — Shadow approval 직후 paper-fill 영속 SSOT.
//   onApproved 콜백이 ctx.shadows.push 만 하고 saveShadowTrades 미호출하던 결함 차단.
//   status PENDING → ACTIVE 전이 + INITIAL_BUY fill 영속 + [Shadow 체결] Telegram + 멱등 가드.
//   LIVE 매매 본체 0줄 변경 — SHADOW path 만 영향 (mode='LIVE' 시 NOT_SHADOW skip).
import { getPrice, getAdaptiveProfitTargets, buildExposureBudgetMacroInput, computeSizingLiquidityInputs, type SymbolExitContext } from './helpers.js';
import type { BuyListLoopContext } from './types.js';
// ADR-0516 — Watchlist Tier 정책: KIS REST 호출 빈도 차등화 SSOT.
//   MOMENTUM_PASSIVE / KIS_LOAD_STATE=RED 등 tier 정책이 REST fallback 을 차단하면
//   getPrice 가 null 반환 → FAIL 아닌 SKIP_TIER_PASSIVE_NO_REST 로 처리 (DATA_VACUUM /
//   providerIssue / marketSignal / NEW_BUY_BLOCKED 으로 격상 금지).
import { resolveWatchlistKisPolicy } from '../../watchlistKisTierPolicy.js';
// ADR-0162 Phase 2-D — SHADOW only 사이징 엔진 wiring (default OFF, ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 명시 활성화).
import { applyPositionSizingEngine, applyExposureBudgetCap } from '../../sizing/positionSizingEngineWiring.js';
// ADR-0167 — currentEquityExposureAmount 정확 산출 SSOT (default OFF, ENV `POSITION_SIZING_ACCURATE_EXPOSURE_ENABLED=true` 활성화).
import { resolveCurrentEquityExposure } from '../../sizing/currentEquityExposure.js';
// ADR-0171 — Sizing-ExposureBudget 진단 로그 10 필드 SSOT formatter (default OFF, ENV `SIZING_EXPOSURE_BUDGET_VERBOSE_LOG=true` 명시 활성화).
import { formatExposureBudgetLog } from '../../sizing/regimeExposurePolicy.js';
// PATCH-010 — Shadow Bull Exposure Floor (default OFF, ENV `SHADOW_BULL_EXPOSURE_FLOOR_ENABLED=true` 명시 활성화).
import { resolveCandidatePositionFloor, formatShadowBullFloorLog } from '../../sizing/shadowBullExposureProfile.js';
import {
  applySupplyHealthToSignal,
  createLearningSampleFromDecision,
  determineExecutionMode,
  type TradingSignal,
} from '../../../learning/supplyHealthLearning.js';
import { appendLearningSample } from '../../../persistence/learningSampleRepo.js';
import { normalizeMacroRegime } from '../../entryPolicySemantics.js';
import { checkEntryPriceDrift } from './steps/entryPriceDrift.js';
import { kisIntradayCorrectionStep } from './steps/kisIntradayCorrection.js';
import { provisionalShadowLaneDerive } from './steps/provisionalShadowLane.js';
import {
  handleEntryRevalidationGate,
  type EntryRevalidationSkippedBatchItem,
} from './steps/entryRevalidationGate.js';
import { sizingTierDeciderFinal } from './steps/sizingTierDecider.js';
import { phaseEntryGate } from './steps/entryGateChain.js';
import { gateEligibilitySplit } from './steps/gateEligibilitySplit.js';
import { counterfactualShadowLearning } from './steps/counterfactualShadowLane.js';
import { handleApprovalQueue } from './steps/approvalQueue.js';
import { preBreakoutFollowthrough } from './steps/preBreakoutFollowthrough.js';
import { preBreakoutEntry } from './steps/preBreakoutEntry.js';

function kstDecisionDate(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function flushEntryRevalidationSkippedSummary(
  items: readonly EntryRevalidationSkippedBatchItem[],
  ctx: BuyListLoopContext,
): void {
  if (items.length === 0) return;
  const scores = items
    .map((item) => item.score)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  const scoreRange = scores.length > 0
    ? `${Math.min(...scores).toFixed(1)}~${Math.max(...scores).toFixed(1)}`
    : 'N/A';
  const reasons = [...new Set(items.flatMap((item) => item.reasons).filter(Boolean))];
  const symbols = items.map((item) => item.symbol).slice(0, 10).join(',');
  const detailsSuppressed = Math.max(0, items.length - 10);
  logVisibilityEvent({
    visibility: 'SUMMARY',
    category: 'GATE',
    sourceCommand: '/scan',
    message:
      `[ENTRY_REVALIDATION_SKIPPED_SUMMARY] count=${items.length} ` +
      `macroRegime=${normalizeMacroRegime(ctx.regime)} executionMode=SHADOW_ONLY ` +
      `marketSessionState=${ctx.resolvedMarketSessionState ?? 'UNKNOWN'} ` +
      `liveEntryAllowed=false shadowLearningAllowed=true ` +
      `blockReasons=[${reasons.length > 0 ? reasons.join(', ') : 'NONE'}] ` +
      `symbols=${symbols}${detailsSuppressed > 0 ? ` detailsSuppressed=${detailsSuppressed}` : ''} ` +
      `scoreRange=${scoreRange} requiredGateScore=N/A executionImpact=NONE`,
    summary: {
      count: items.length,
      marketSessionState: ctx.resolvedMarketSessionState ?? 'UNKNOWN',
      scoreRange,
      executionImpact: 'NONE',
    },
    details: { items },
    level: 'info',
    executionImpact: 'NONE',
  });
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

function getDiagnosticLiveBlockReason(ctx: BuyListLoopContext): string | undefined {
  const reason = ctx.liveEntryBlockedReason?.trim();
  if (reason) return reason;
  return ctx.positionFullDiagnosticOnly ? 'POSITION_FULL' : undefined;
}

function isMacroDiagnosticLiveBlockReason(reason: string | undefined): boolean {
  if (!reason) return false;
  const macroReasons = new Set(['SELL_ONLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE', 'VIX_BLOCK', 'FOMC_BLOCK']);
  const parts = reason.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => macroReasons.has(part));
}

function suppressDiagnosticLiveBuyTask(
  ctx: BuyListLoopContext,
  stock: { name?: string; code?: string },
  reason: string,
): void {
  recordPipelineStage(ctx.scanCounters, 'LIVE_ORDER_BLOCKED', 'BLOCKED');
  console.log(
    `[AutoTrade] ${reason} diagnostic-only suppressed buy task: ${stock.name ?? 'UNKNOWN'}(${stock.code ?? 'UNKNOWN'})`,
  );
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
  // Patch-SHADOW-APPROVAL-DEDUP-001 — 본 스캔 사이클 SSOT 컨텍스트 (tradeDate + marketSession).
  // SHADOW 모드 createBuyTask 호출 시 buyPipeline → requestBuyApproval 가 이 두 필드로 dedupeKey 생성.
  // LIVE 모드 호출 site 도 동일 propagate 하나 buyPipeline 측 guard 가 SHADOW 분기에서만 발동.
  const _shadowApprovalCtx = deriveShadowApprovalContext();
  let diagnosticLiveBlockLogged = false;
  const entryRevalidationSkippedBatch: EntryRevalidationSkippedBatchItem[] = [];
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
    const diagnosticLiveBlockReason = getDiagnosticLiveBlockReason(ctx);
    const macroDiagnosticLiveBlock = isMacroDiagnosticLiveBlockReason(diagnosticLiveBlockReason);
    if (!isMomentumShadow && macroDiagnosticLiveBlock) {
      stockShadowMode = true;
    }
    if (!isMomentumShadow && totalCommitted >= ctx.effectiveMaxPositions && !diagnosticLiveBlockReason) {
      // MOMENTUM Shadow 는 LIVE 슬롯 한도에 귀속되지 않으므로 이 가드를 건너뛴다.
      console.log(
        `[AutoTrade] 최대 포지션 도달 (활성 ${slotResult.consumed.toFixed(2)} + 예약 ${ctx.mutables.reservedSlots.value} = ${totalCommitted.toFixed(2)}/${ctx.effectiveMaxPositions}${ctx.sellOnlyExc.allow ? ' · SELL_ONLY 예외 캡' : ''}, 레짐 ${ctx.regime}, raw=${slotResult.rawCount}) — 나머지 종목 스킵`,
      );
      break;
    }
    if (!isMomentumShadow && totalCommitted >= ctx.effectiveMaxPositions && diagnosticLiveBlockReason) {
      stockShadowMode = true;
      if (!diagnosticLiveBlockLogged) {
        console.log(
          `[AutoTrade] ${diagnosticLiveBlockReason} diagnostic-only path active — live buy tasks suppressed while gate diagnostics continue (${totalCommitted.toFixed(2)}/${ctx.effectiveMaxPositions})`,
        );
        diagnosticLiveBlockLogged = true;
      }
    } else if (!isMomentumShadow && macroDiagnosticLiveBlock && !diagnosticLiveBlockLogged) {
      console.log(
        `[AutoTrade] ${diagnosticLiveBlockReason} macro diagnostic path active — live buy tasks routed to shadow while gate diagnostics continue`,
      );
      diagnosticLiveBlockLogged = true;
    }

    try {
      const stageLog: Record<string, string> = {};
      const pushTrace = () => ctx.scanCounters.pendingTraces.push({
        ts: new Date().toISOString().slice(11, 19),
        stock: stock.code,
        name:  stock.name,
        stages: { ...stageLog },
      });

      // ADR-0516 — Watchlist Tier 정책으로 KIS REST 호출 빈도 차등화.
      //   - 보유 종목(shadows 활성) → OPEN_POSITION (REST 항상 허용, P0 보호)
      //   - force buy → ENTRY_CANDIDATE 격상 (P0 보호 — 무성 실패 차단)
      //   - SWING/CATALYST → REST 허용 / MOMENTUM 상위 N개만 REST 허용
      //   - MOMENTUM_PASSIVE / KIS RED → REST 차단 (WS 실시간 가격은 그대로 사용)
      const isHeldPosition = ctx.shadows.some(
        (s) => s.stockCode === stock.code && isOpenShadowStatus(s.status),
      );
      const kisTierPolicy = resolveWatchlistKisPolicy({
        section: stock.section,
        gateScore: stock.gateScore,
        stage2Score: stock.stage2Score,
        momentumRank: (stock as { momentumRank?: number }).momentumRank,
        isOpenPosition: isHeldPosition,
        isForceBuy: (stock as { isForceBuy?: boolean }).isForceBuy,
      });
      const currentPrice = await getPrice(stock.code, {
        section: stock.section,
        gateScore: stock.gateScore,
        stage2Score: stock.stage2Score,
        isOpenPosition: isHeldPosition,
        allowRestFallback: kisTierPolicy.allowRestPrice,
        restTtlMs: kisTierPolicy.priceTtlMs,
        pricePurpose: 'BUY_EVAL',
        stockName: stock.name,
      });
      if (!currentPrice) {
        // ADR-0516 — tier 정책 REST 차단으로 가격 미확보 시 FAIL 아닌 SKIP.
        // DATA_VACUUM / providerIssue / marketSignal / NEW_BUY_BLOCKED 으로 격상 금지.
        // Shadow learning 은 계속되나 MOMENTUM_PASSIVE 후보는 이번 사이클 표본을 건너뛴다.
        if (!kisTierPolicy.allowRestPrice) {
          stageLog.price = 'SKIP_TIER_PASSIVE_NO_REST';
          ctx.scanCounters.waitTierRestSuppressed =
            (ctx.scanCounters.waitTierRestSuppressed ?? 0) + 1;
          if (process.env.WATCHLIST_KIS_TIER_DEBUG === 'true') {
            console.debug(
              `[WATCHLIST_KIS_TIER] symbol=${stock.code} section=${stock.section ?? '?'} ` +
                `tier=${kisTierPolicy.tier} allowRestPrice=false reason=${kisTierPolicy.reason} ` +
                `executionImpact=NONE marketSignal=false`,
            );
          }
          pushTrace();
          continue;
        }
        stageLog.price = 'FAIL';
        pushTrace();
        continue;
      }
      stageLog.price = 'PASS';

      // ADR-0120 (PR-B): Gate 1/2/3 통과 카운터 누적 — emptyScanClassifier
      // NO_LEADERSHIP / NO_TIMING 분기 입력 데이터 제공 + R3 Sanity Check 입력.
      // stock.gateEvaluation 은 enrichment 단계에서 사전 산출된 값 (StockRecommendation
      // 에 정의되어 있으나 WatchlistEntry 에는 부재). inline cast 로 영속 schema
      // 변경 회피. try/catch 격리 — throw 시 LIVE 매매 흐름 무중단.
      //
      // GateEvaluation 미영속 구 watchlist 항목은 gate1Unknown 으로만 집계한다.
      try {
        const ge = stock.gateEvaluation;
        if (ge?.gate1Passed === true) {
          ctx.scanCounters.gate1Pass++;
        } else if (!ge) {
          ctx.scanCounters.gate1Unknown++;
        }
        if (ge?.gate2Passed === true) ctx.scanCounters.gate2Pass++;
        if (ge?.gate3Passed === true) ctx.scanCounters.gate3Pass++;
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

      const entryPriceDriftResult = await checkEntryPriceDrift(ctx, stock, currentPrice, stageLog, pushTrace);
      if (entryPriceDriftResult === 'SKIP') continue;

      // 당일 날짜 (재진입 방지 + PRE_BREAKOUT 추종 중복 방지 공통 사용)
      const today = new Date().toISOString().split('T')[0];

      // ── Pre-Breakout: 선취매 포지션 확인 → 돌파 추종 실행 ──────────────────
      const followthroughResult = await preBreakoutFollowthrough({
        ctx,
        stock,
        currentPrice,
        today,
        stockShadowMode,
        diagnosticLiveBlockReason,
        macroDiagnosticLiveBlock,
        shadowApprovalCtx: _shadowApprovalCtx,
        applyBuySupplyHealthPolicy,
        suppressDiagnosticLiveBuyTask,
      });
      if (followthroughResult === 'SKIP') continue;

      // 진입 조건: 현재가가 entryPrice 부근 도달
      // MANUAL 종목은 사용자 확신이 높으므로 ±2%, AUTO 종목은 ±1%
      const nearEntryThreshold = stock.addedBy === 'MANUAL' ? 0.02 : 0.01;
      const nearEntry = Math.abs(currentPrice - stock.entryPrice) / stock.entryPrice <= nearEntryThreshold;
      // 손절 상향: 아직 손절선 위에 있어야 함
      const aboveStop = currentPrice > stock.stopLoss;
      // 상승 모멘텀: 현재가가 entry 이상
      const breakout = currentPrice >= stock.entryPrice;

      // ── Pre-Breakout 매집/선취매/WAIT 처리 ────────────────────────────────
      const preBreakoutEntryResult = await preBreakoutEntry({
        ctx,
        stock,
        currentPrice,
        nearEntry,
        breakout,
        aboveStop,
        nearEntryThreshold,
        today,
        stockShadowMode,
        diagnosticLiveBlockReason,
        macroDiagnosticLiveBlock,
        shadowApprovalCtx: _shadowApprovalCtx,
        applyBuySupplyHealthPolicy,
        suppressDiagnosticLiveBuyTask,
        logPreEntryWaitDebug,
      });
      if (preBreakoutEntryResult === 'SKIP') continue;

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

      const entryGateResult = await phaseEntryGate(ctx, stock, currentPrice, stageLog, pushTrace);
      if (entryGateResult === 'SKIP') continue;

      const slippage = getExecutionCostConfig().slippageRate;
      const shadowEntryPrice = Math.round(currentPrice * (1 + slippage));

      // ── 실시간 Gate 재평가 (타점 판단 연동) ──────────────────────────────────
      // 워치리스트 stale gateScore 대신 실시간 evaluateServerGate 결과를 포지션 사이징에 반영
      // 아이디어 9: KIS API로 MTAS 월봉/주봉 보강 (매수 결정 직전 정확도 향상)
      // ADR-0231: KRX 마스터 기반 정확 매핑 → 1회 fetch + KIS fallback.
      const { gateResult: reCheckGate, reCheckQuote } = await kisIntradayCorrectionStep(ctx, stock, currentPrice);

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
      // try/catch 격리 — Gate2 attribution 실패 시 매수 흐름 차단 안 함.
      const ge2 = stock.gateEvaluation;
      const isGate1Survivor = ge2?.gate1Passed === true;
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

      gateEligibilitySplit(ctx, stock, currentPrice, reCheckGate, isGate1Survivor);

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
              Parameters<typeof deriveGateDecisionRouterResult>[0]['sectorEnergyDiagnostic'],
          });
          await provisionalShadowLaneDerive(ctx, stock, routerResult);
        }
      } catch (e) {
        console.warn('[Adr0427ProvisionalShadow] wiring 실패 — 매수 흐름 무영향:', e);
      }

      await counterfactualShadowLearning(ctx, stock, reCheckGate, isGate1Survivor);

      // ── ADR-0031 PR-59 PoC: entryRevalidationStep RevalidationStep 분기 ───
      // step 자체는 외부 mutation·부수효과 0건 — fail 시 caller 가 stock.entryFailCount,
      // watchlistMutated, scanCounters.gateMisses, stageLog, pushTrace, counterfactual
      // 기록을 일괄 적용. byte-equivalent: 메시지·counter·stageLog 값 100% 보존.
      //
      // ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 — macroState.sectorEnergyResult
      // 가 영속되어 있으면 stock.sector 의 LEADING/LAGGING 분류 결과를 quoteGateScore 에
      // 가산. macroState.sectorEnergyResult 부재 시 boost=0 — 기존 동작과 동일.
      // ADR-0125 (PR-1): dataQuality 4값 분기 추가 — STALE/FAILED 시 boost=0 강제.
      const entryRevalidationResult = await handleEntryRevalidationGate(
        ctx,
        stock,
        reCheckGate as ReturnType<typeof evaluateServerGate>,
        buildEntryConditionScores(stock.conditionKeys),
        currentPrice,
        reCheckQuote,
        stageLog,
        pushTrace,
        entryRevalidationSkippedBatch,
      );
      if (entryRevalidationResult === 'SKIP') continue;

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
      const sizingFinalResult = await sizingTierDeciderFinal(ctx, stock, currentPrice, reCheckGate, {
        liveGateScore,
        gateScore,
        shadowEntryPrice,
        currentActive,
        isMomentumShadow,
        isStrongBuy,
      });
      if (sizingFinalResult.shouldSkip) continue;
      const entryKellySnapshot = sizingFinalResult.kellySnapshot!;
      const tierDecision = sizingFinalResult.tierDecision!;
      const positionPct = sizingFinalResult.positionPct!;
      const remainingSlots = sizingFinalResult.remainingSlots!;
      const confidenceModifier = sizingFinalResult.confidenceModifier!;
      const grade = sizingFinalResult.grade!;

      // PATCH-010 — Shadow Bull Exposure Floor: R2/R3 불싸이클 Shadow 후보 소액 매수 오류 보정.
      // 멀티플라이어 누적 (R2_BULL kellyMultiplier ×0.8 × STANDARD tier ×0.6 × MTAS ×0.3~0.5)
      // 으로 0.2~0.5% 까지 축소된 positionPct 를 레짐별 floor 로 끌어올린다.
      // kellyBudgetDecider 하드 게이트 통과 뒤 적용 — soft shrink 가 floor 아래로 깎지 못한다.
      // LIVE 모드는 LIVE_REGIME_EXPOSURE_PROFILE (floor 0 전면) → 현행 동작 100% 보존.
      // ENV `SHADOW_BULL_EXPOSURE_FLOOR_ENABLED` OFF (default) 시 effectivePositionPct === positionPct (byte-equivalent).
      const exposureFloor = resolveCandidatePositionFloor({
        shadowMode: stockShadowMode,
        regime: ctx.regime,
        tier: tierDecision.tier,
        computedPositionPct: positionPct,
      });
      const effectivePositionPct = exposureFloor.effectivePositionPct;
      if (exposureFloor.applied) {
        console.log(
          formatShadowBullFloorLog(exposureFloor, {
            stockName: stock.name,
            stockCode: stock.code,
            computedPositionPct: positionPct,
          }),
        );
      }

      const { quantity: legacyQuantity, effectiveBudget } = calculateOrderQuantity({
        totalAssets: ctx.totalAssets,
        orderableCash: ctx.mutables.orderableCash.value,
        positionPct: effectivePositionPct,
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

      const approvalQueueResult = await handleApprovalQueue({
        ctx,
        stock,
        currentPrice,
        stockShadowMode,
        isMomentumShadow,
        isFinalStrongBuy,
        execQty,
        supplyAdjustedFinalQuantity,
        effectiveBudgetAfterHealth,
        trade,
        shadowEntryPrice,
        stopLossPlan,
        gateScore,
        liveGateScore,
        reCheckGate,
        finalSignalLevel,
        shadowApprovalCtx: _shadowApprovalCtx,
        diagnosticLiveBlockReason,
        macroDiagnosticLiveBlock,
        stageLog,
        pushTrace,
        grade,
        tierDecision,
        signalTimeMain: _signalTimeMain,
        suppressDiagnosticLiveBuyTask,
      });
      if (approvalQueueResult === 'SKIP') continue;
    } catch (err: unknown) {
      console.error(`[AutoTrade] ${stock.code} 스캔 실패:`, err instanceof Error ? err.message : err);
    }
  }
  flushEntryRevalidationSkippedSummary(entryRevalidationSkippedBatch, ctx);
}
