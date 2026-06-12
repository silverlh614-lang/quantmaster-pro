// @responsibility liveGate 재검증 결과를 RevalidationStep 시그니처로 분기하는 PoC 단계

import { evaluateEntryRevalidation } from '../../entryEngine.js';
import { resolveEntryMinGateScore } from '../../gate1ShadowEntryThreshold.js';
import { normalizeMacroRegime, resolveMarketSessionState, type EntryBlockReason } from '../../entryPolicySemantics.js';
import { isExecutionRelaxationEnabled } from '../failureClassifier.js';
import type { RevalidationStepResult } from './types.js';

export interface EntryRevalidationStepInput {
  stockName: string;
  currentPrice: number;
  entryPrice: number;
  reCheckQuote: {
    dayOpen?: number;
    prevClose?: number;
    volume?: number;
    avgVolume?: number;
  } | null;
  reCheckGate: {
    gateScore?: number;
    signalType?: 'STRONG' | 'NORMAL' | 'SKIP';
  } | null;
  regime: string;
  liveEntryAllowed?: boolean;
  shadowLearningAllowed?: boolean;
  executionMode?: 'NORMAL' | 'DEGRADED' | 'SELL_ONLY' | 'SHADOW_ONLY' | 'OBSERVE_ONLY';
  marketSessionState?: 'OPEN' | 'PRE_MARKET' | 'AFTER_HOURS' | 'CLOSED' | 'NON_TRADING_DAY';
  blockReasons?: EntryBlockReason[];
  marketElapsedMinutes: number;
  /**
   * ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점.
   * 호출자가 macroState.sectorEnergyResult + stock.sector 로 applySectorScoreBoost
   * 결과를 미리 계산해 전달. step 은 단순히 `gateScore + sectorBoost` 로 보정 후
   * evaluateEntryRevalidation 호출. 미전달 시 0 — 동작 변경 없음 (후방호환).
   *
   * 효과: LEADING 섹터 +2 보너스로 진입 직전 재검증의 minGate 임계 통과 유리.
   */
  sectorBoost?: number;
  /** sectorBoost 진단 텍스트 — describeSectorBoost() 결과. 진단 메시지에만 사용. */
  sectorBoostReason?: string;
  /**
   * ADR-0608: stockShadowMode — true=SHADOW(paper) 진입 경로.
   * ENV `GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED` ON 시에만 SHADOW 진입 임계를
   * regime-aware(getEffectiveGateThreshold)로 분기. 미전달/false → LIVE legacy 경로
   * (getMinGateScore byte-equivalent). 후방호환: 미전달 시 false.
   */
  isShadow?: boolean;
  /**
   * ADR-0608 Phase 2: minGate 산출 전용 regime. SHADOW(paper) 진입에서 R6 회복 누수로
   * `regime`(=ctx.regime)가 R4_NEUTRAL 로 clamp 돼도 진입 임계는 정규 learningRegime
   * (예 R3_EARLY=4)를 쓰도록 호출자가 `ctx.learningRegime ?? ctx.regime` 을 주입.
   *
   * **`regime`(macroRegime/진단/정책 표기)은 무변경** — 본 필드는 resolveEntryMinGateScore
   * 호출에만 쓰이고 evaluateEntryRevalidation 의 macroRegime/normalizeMacroRegime 에는
   * `regime` 이 그대로 흐른다. 미전달 시 `regime` fallback → 후방호환(byte-equivalent).
   * LIVE 경로는 호출자가 항상 ctx.regime 을 넘겨 byte-equivalent 보존.
   */
  entryRegime?: string;
}

/**
 * ADR-0031 PoC — 라인 692-732 의 entry-revalidation 분기를 byte-equivalent 로 추출.
 *
 * 호출 시점: EntryGate Chain (PR-57/58) 통과 직후 reCheckQuote/reCheckGate 가
 * 이미 계산된 상태. 이 step 은 evaluateEntryRevalidation 결과를 받아 caller 가
 * 그대로 사용할 수 있는 진단 데이터로 변환만 한다 (외부 mutation 0건).
 *
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.log(result.logMessage)
 *   - stock.entryFailCount = (stock.entryFailCount ?? 0) + 1
 *   - mutables.watchlistMutated.value = true
 *   - scanCounters.gateMisses++
 *   - stageLog.gate = result.stageLogValue
 *   - pushTrace()
 *   - recordCounterfactual({ ..., skipReason: `entryRevalidation:${result.failReasons.join(',')}` })
 */
export function entryRevalidationStep(input: EntryRevalidationStepInput): RevalidationStepResult {
  // ADR-0075 PR-4 wiring: gateScore 에 sectorBoost 가산 후 minGate 비교.
  const rawGateScore = input.reCheckGate?.gateScore;
  const boost = input.sectorBoost ?? 0;
  const boostedGateScore = typeof rawGateScore === 'number' ? rawGateScore + boost : rawGateScore;

  // ADR-0608: 진입 임계 분기 SSOT. SHADOW(paper)+ENV ON → regime-aware,
  //   LIVE/ENV OFF → getMinGateScore byte-equivalent. entryThresholdMode 라벨 carry.
  // ADR-0608 Phase 2: minGate 산출 regime 은 entryRegime(SHADOW=learningRegime) 우선,
  //   미전달 시 input.regime fallback. input.regime(macroRegime/진단)은 무변경.
  const { minGateScore: minGateBase, entryThresholdMode } = resolveEntryMinGateScore({
    regime: input.entryRegime ?? input.regime,
    isShadow: input.isShadow ?? false,
  });
  // ADR-0116 wiring: ADR-0115 의 EXECUTION_RELAXATION_ENABLED ENV 를 이곳에서 적용.
  // ENV ON 시 minGate -1 (Gate3 7→6) — 사용자 18단계 §12 "임시 완화".
  // 최소 5 보장으로 과도한 완화 차단. default OFF — 회귀 위험 격리.
  // ⚠ ADR-0116 floor 5 는 LIVE 전용(실자본 진입 과도완화 차단). 정적 가드 텍스트 보존.
  const relaxedDelta = isExecutionRelaxationEnabled() ? 1 : 0;
  const liveMinGate = Math.max(minGateBase - relaxedDelta, 5);
  // ADR-0608 Phase 2: SHADOW(paper)+ENV ON(=REGIME_AWARE_SHADOW)만 floor 5 우회 →
  //   regime-aware minGate(R3_EARLY=4) 그대로 사용. LIVE/ENV OFF 는 liveMinGate(floor 5)
  //   유지 → byte-equivalent. floor 우회는 paper-fill 표본 확대 전용(LIVE 실자본 무영향).
  const minGate = entryThresholdMode === 'REGIME_AWARE_SHADOW' ? minGateBase : liveMinGate;
  const revalidation = evaluateEntryRevalidation({
    symbol: input.stockName,
    currentPrice: input.currentPrice,
    entryPrice: input.entryPrice,
    quoteGateScore: boostedGateScore,
    quoteSignalType: input.reCheckGate?.signalType,
    dayOpen: input.reCheckQuote?.dayOpen,
    prevClose: input.reCheckQuote?.prevClose,
    volume: input.reCheckQuote?.volume,
    avgVolume: input.reCheckQuote?.avgVolume,
    minGateScore: minGate,
    liveEntryAllowed: input.liveEntryAllowed ?? true,
    shadowLearningAllowed: input.shadowLearningAllowed ?? true,
    executionMode: input.executionMode ?? 'NORMAL',
    marketSessionState: resolveMarketSessionState({ marketSessionState: input.marketSessionState }),
    macroRegime: normalizeMacroRegime(input.regime),
    blockReasons: input.blockReasons,
    marketElapsedMinutes: input.marketElapsedMinutes,
  });

  if (revalidation.ok) return { proceed: true, entryThresholdMode };

  // sectorBoost 가 적용되어도 탈락한 경우 — 진단 메시지에 boost 효과 명시.
  const reasons = revalidation.reasons;
  const boostNote = boost !== 0 && input.sectorBoostReason
    ? ` [${input.sectorBoostReason}]`
    : '';

  if (revalidation.status === 'SKIPPED_POLICY_BLOCK') {
    return {
      proceed: false,
      logMessage: revalidation.structuredLog ?? `[ENTRY_REVALIDATION_SKIPPED] symbol=${input.stockName} requiredGateScore=N/A executionImpact=NONE`,
      failReasons: reasons,
      stageLogValue: 'SKIPPED_POLICY_BLOCK',
      dataQuality: revalidation.dataQuality,
      waitReason: revalidation.waitReason,
    };
  }

  // ADR-0117: evaluateEntryRevalidation 이 dataQuality + waitReason 반환 시 propagate.
  // 호출자(perSymbolEvaluation) 가 WAIT / DATA_HOLD 분기로 처리.
  const stageLogValue = revalidation.waitReason === 'DATA_HOLD'
    ? 'DATA_HOLD'
    : `FAIL(${reasons.join(',')})`;
  const logMessage = revalidation.waitReason === 'DATA_HOLD'
    ? `[AutoTrade] ${input.stockName} → WAIT / DATA_HOLD / ${reasons.join(', ')}`
    : `[AutoTrade] ${input.stockName} 진입 직전 재검증 탈락: ${reasons.join(', ')}${boostNote}`;

  return {
    proceed: false,
    logMessage,
    failReasons: reasons,
    stageLogValue,
    dataQuality: revalidation.dataQuality,
    waitReason: revalidation.waitReason,
  };
}
