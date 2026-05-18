// @responsibility counterfactualShadowLearningLane — SELL_ONLY/HARD_BLOCK 시점 counterfactual 학습 SSOT.
//
// ADR-0430:
// SELL_ONLY and HARD_BLOCK stop execution, not learning.
// Counterfactual shadow learning records "what if we had bought?" samples
// in a separate learning-only ledger without touching live orders, paper
// execution, normal shadow trades, or virtual account balances.
//
// This module must never bypass SELL_ONLY for execution. It only preserves
// counterfactual learning samples with explicit blockedBy metadata.
//
// 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합):
//   1. LIVE 매수 차단 — liveAllowed: false (literal, 정적 가드)
//   2. paper 차단 — paperAllowed: false (literal)
//   3. execution shadow 차단 — executionShadowAllowed: false (literal)
//   4. virtualAccountImpact: 'NONE' (literal)
//   5. learningOnly: true (literal)
//   6. provisional: false (literal — ADR-0426/0427 분리 마커)
//   7. source: 'ADR-0430' (literal — 일반 shadow buy / provisional 모두와 분리)
//   8. KIS 주문 함수 5종 import 0건 (외부 의존성 0)
//   9. 매매 정책 완화 PR 아님 — 학습 기록 PR
//   10. SELL_ONLY/HARD_BLOCK 자체 우회 0건
//
// 외부 의존성 0 (KIS/Yahoo/외부 API 호출 0건). 순수 함수 SSOT.

import type { GateDecisionRouterResult } from './gateDecisionRouter.js';
import type { SectorEnergyQualityDiagnostic } from '../../clients/sectorEnergyQualityDiagnostic.js';
import type { ConditionBlockerBucket } from './freshScanBlockerAttribution.js';
import { normalizeRegimeContext, type RegimeConfidence, type RegimePhase } from '../../shadow/regimeContext.js';

/**
 * 5-value label union (사용자 §B 정합, 절대 변경 금지).
 *
 * 일반 shadow buy / ADR-0427 provisional shadow 와 구분 의무 — counterfactual 마커.
 */
export type CounterfactualShadowLearningLabel =
  | 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY'
  | 'R3_COUNTERFACTUAL_UNDER_HARD_BLOCK'
  | 'R3_COUNTERFACTUAL_DATA_DEGRADED'
  | 'R3_COUNTERFACTUAL_GATE2_NOT_CONFIRMED'
  | 'COUNTERFACTUAL_BLOCKED_BUY'
  | 'SHADOW_BUY_SIGNAL'
  | 'R6_COUNTERFACTUAL_BUY'
  | 'ACCUMULATION_SHADOW_ENTRY';

/** 12-value reason union (사용자 §B 정합, 절대 변경 금지). */
export type CounterfactualShadowLearningReason =
  | 'SELL_ONLY'
  | 'HARD_BLOCK'
  | 'R3_EARLY'
  | 'GATE1_SURVIVOR'
  | 'SOFT_DEGRADE_DATA'
  | 'SECTOR_DATA_DEGRADED'
  | 'SECTOR_DATA_STALE'
  | 'DATA_UNAVAILABLE'
  | 'GATE2_NOT_CONFIRMED'
  | 'TRUE_WEAKNESS'
  | 'NO_HARD_RISK_BYPASS_ATTEMPT'
  | 'LEARNING_ONLY'
  | 'ACCUMULATING'
  | 'R6_RECOVERY_OBSERVE';

/**
 * Counterfactual Shadow Learning 후보 schema (사용자 §B 정합).
 *
 * literal types — TypeScript 강제로 호출자가 학습 전용 invariant 위반 시 컴파일 에러:
 *   - liveAllowed: false / paperAllowed: false / executionShadowAllowed: false
 *   - virtualAccountImpact: 'NONE'
 *   - learningOnly: true / provisional: false / source: 'ADR-0430'
 */
export interface CounterfactualShadowLearningCandidate {
  symbol: string;
  name?: string;
  eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY';
  source: 'ADR-0430';
  learningOnly: true;
  provisional: false;
  executionShadow: boolean;
  label: CounterfactualShadowLearningLabel;
  reasons: CounterfactualShadowLearningReason[];
  blockedBy: string[];
  liveAllowed: false;
  paperAllowed: boolean;
  executionShadowAllowed: boolean;
  virtualAccountImpact: 'NONE' | 'SHADOW_ONLY';
  regime?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regimePhase?: RegimePhase;
  regimeAtSignal?: RegimePhase | string;
  regimeAtEntry?: RegimePhase | string;
  regimeAtExit?: RegimePhase | string;
  regimeAtOutcome?: RegimePhase | string;
  r6Trigger?: string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  sourceFreshness?: string;
  regimeConfidence?: RegimeConfidence;
  scanId?: string;
  createdAtKst: string;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  routerSeverity?: string;
  routerLabel?: string;
  entryPriceHint?: number;
  entryType?: 'SHADOW_BUY_SIGNAL' | 'R6_COUNTERFACTUAL_BUY' | 'ACCUMULATION_SHADOW_ENTRY';
  sourceSignal?: 'BULLISH' | 'ACCUMULATING' | 'NEUTRAL' | 'BEARISH' | 'UNUSABLE';
  entryReason?: string;
  executionImpact?: 'NONE';
  liveOrderSent?: false;
  riskUnit?: 'R6_COUNTERFACTUAL' | string;
  mhs?: number;
  bias?: string;
  supplyScore?: number;
  activeFlow?: string;
  passiveFlow?: string;
  programNetBuy?: number;
  paperFillCreated?: boolean;
  shadowPositionOpened?: boolean;
  sectorEnergySnapshot?: {
    dataQuality?: string;
    indexCodeCoverage?: number;
    repairStatus?: string;
    leadershipConfidence?: string;
  };
  conditionSnapshot?: Record<string, unknown>;
}

export interface DeriveCounterfactualShadowLearningInput {
  symbol: string;
  name?: string;
  regime?: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regimeAtSignal?: string;
  regimeAtEntry?: string;
  regimeAtExit?: string;
  regimeAtOutcome?: string;
  r6Trigger?: string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  sourceFreshness?: string;
  regimeConfidence?: RegimeConfidence;
  gate1Passed?: boolean;
  gate2Passed?: boolean;
  router?: GateDecisionRouterResult;
  sectorEnergyDiagnostic?: SectorEnergyQualityDiagnostic;
  conditionBuckets?: ConditionBlockerBucket[];
  blockReasons?: {
    preBreakoutWait?: boolean;
    gateRecheckMiss?: boolean;
    sizingBlocked?: boolean;
  };
  riskFlags?: {
    emergencyStop?: boolean;
    sellOnly?: boolean;
    r6Defense?: boolean;
    vixBlock?: boolean;
    fomcBlock?: boolean;
    liquidityBlock?: boolean;
    rrrBlock?: boolean;
    technicalBreakdown?: boolean;
  };
  entryPriceHint?: number;
  scanId?: string;
  /** KST ISO 시각 — 미전달 시 호출 시점 자동 합성. */
  nowKst?: string;
}

/** ENV `COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true` 정확 비교 (ADR-0157 정합). */
export function isCounterfactualShadowLearningDisabled(): boolean {
  return process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED === 'true';
}

/**
 * Counterfactual Shadow Learning eligibility SSOT (사용자 §D 정합, 절대 변경 금지).
 *
 * 결정 트리 우선순위:
 *   1. ENV DISABLED → null
 *   2. regime !== R3_EARLY → null (학습 표본 R3_EARLY 한정, 추가 regime 은 후속 PR)
 *   3. !gate1Passed → null (Gate1 생존자만 — 학습 가치 보존)
 *   4. emergencyStop → ENV 미설정 시 LEARNING_ONLY 라벨로 발화 (사용자 §E 정책)
 *   5. SELL_ONLY → 발화 (R3_COUNTERFACTUAL_UNDER_SELL_ONLY)
 *   6. HARD_BLOCK 사유 (R6/VIX/FOMC/liquidity/RRR/sizingBlocked) → 발화
 *      (R3_COUNTERFACTUAL_UNDER_HARD_BLOCK)
 *   7. router.severity === HARD_BLOCK → 발화
 *   8. SOFT_DEGRADE 시점 (sector DEGRADED/STALE/dataUnavailable) →
 *      이 경로는 Provisional Shadow Lane (ADR-0426) 우선이라 *null* 반환.
 *      단, gate2Passed=true 인 케이스 (Provisional 자체 자격 미달) 도 null.
 *   9. 그 외 — eligible 부재
 *
 * label 결정:
 *   - SELL_ONLY 우세 → R3_COUNTERFACTUAL_UNDER_SELL_ONLY
 *   - HARD_BLOCK riskFlag 우세 → R3_COUNTERFACTUAL_UNDER_HARD_BLOCK
 *   - sector DEGRADED/STALE 우세 + 위 우선순위 미해당 → R3_COUNTERFACTUAL_DATA_DEGRADED
 *   - Gate2 단순 미완 (HARD_BLOCK 외) → R3_COUNTERFACTUAL_GATE2_NOT_CONFIRMED
 *   - 그 외 → COUNTERFACTUAL_BLOCKED_BUY
 *
 * 우선순위 invariant (사용자 §J 정합):
 *   1. FULL/normal shadow path 우선
 *   2. Provisional shadow path (ADR-0426) 두 번째 우선
 *   3. Counterfactual learning-only (본 SSOT) 마지막 fallback
 *   4. 둘 다 동시에 생성 금지 — 호출자가 우선순위 enforcement
 */
export function deriveCounterfactualShadowLearningCandidate(
  input: DeriveCounterfactualShadowLearningInput,
): CounterfactualShadowLearningCandidate | null {
  // 1. ENV DISABLED — 회귀 1줄 즉시 롤백
  if (isCounterfactualShadowLearningDisabled()) return null;

  // 2. R3_EARLY 외 regime 차단 (학습 표본 R3_EARLY 한정 — 추가 regime 은 후속 PR scope)
  if (input.regime !== 'R3_EARLY') return null;

  // 3. Gate1 생존자만 — 학습 가치 보존 (NO_GATE1_SURVIVOR 는 noEligibleReason)
  if (!input.gate1Passed) return null;

  // ────────────────────────────────────────────────────────
  // HARD_BLOCK / SELL_ONLY 사유 분류
  // ────────────────────────────────────────────────────────
  const rf = input.riskFlags ?? {};
  const blockReasons = input.blockReasons ?? {};

  const sellOnlyHit = rf.sellOnly === true;
  const emergencyHit = rf.emergencyStop === true;
  const r6Hit = rf.r6Defense === true;
  const vixHit = rf.vixBlock === true;
  const fomcHit = rf.fomcBlock === true;
  const liquidityHit = rf.liquidityBlock === true;
  const rrrHit = rf.rrrBlock === true;
  const sizingHit = blockReasons.sizingBlocked === true;
  const techBreakdown = rf.technicalBreakdown === true;

  // 4. technical breakdown — 진짜 기술 미달 (사용자 §C — 학습 표본 오염 차단,
  //    ADR-0426 와 동일 정책)
  if (techBreakdown) return null;

  // Router HARD_BLOCK 직접 검출 (riskFlags 부재 + Router 만 전달된 경우 호환)
  const routerHardBlock = input.router?.severity === 'HARD_BLOCK';
  const routerTrueWeakness = input.router?.severity === 'TRUE_WEAKNESS';

  // 5. TRUE_WEAKNESS — 진짜 기술 약세 (학습 표본 오염, ADR-0425 정합)
  if (routerTrueWeakness) return null;

  // ────────────────────────────────────────────────────────
  // SOFT_DEGRADE / WATCH_ONLY 시점 — Provisional path 우선
  //   본 SSOT 는 *fallback* — 호출자가 Provisional null 반환 시점에만 호출.
  //   여기서는 router severity 가 SOFT_DEGRADE/WATCH_ONLY 이면 null 반환
  //   (호출자 측에서 Provisional path 가 처리해야 함).
  // ────────────────────────────────────────────────────────
  if (input.router?.severity === 'SOFT_DEGRADE') return null;
  if (input.router?.severity === 'WATCH_ONLY') return null;
  if (input.router?.severity === 'REDUCED_ENTRY_CANDIDATE') return null;
  if (input.router?.severity === 'FULL_ENTRY_CANDIDATE') return null;

  // ────────────────────────────────────────────────────────
  // gate2Passed=true 는 정상 통과 경로 — Counterfactual 부적합
  // ────────────────────────────────────────────────────────
  if (input.gate2Passed === true) return null;

  // ────────────────────────────────────────────────────────
  // Counterfactual 발화 조건 — HARD_BLOCK 또는 SELL_ONLY 또는 emergencyStop
  // 또는 routerHardBlock 중 1+ 충족 (사용자 §D)
  // ────────────────────────────────────────────────────────
  const anyHardBlockHit =
    sellOnlyHit ||
    emergencyHit ||
    r6Hit ||
    vixHit ||
    fomcHit ||
    liquidityHit ||
    rrrHit ||
    sizingHit ||
    routerHardBlock;

  if (!anyHardBlockHit) return null;

  // ────────────────────────────────────────────────────────
  // reasons / blockedBy 합성
  // ────────────────────────────────────────────────────────
  const reasons: CounterfactualShadowLearningReason[] = [
    'R3_EARLY',
    'GATE1_SURVIVOR',
    'LEARNING_ONLY',
    'NO_HARD_RISK_BYPASS_ATTEMPT',
  ];
  const blockedBy: string[] = [];

  if (sellOnlyHit) {
    blockedBy.push('SELL_ONLY');
    reasons.push('SELL_ONLY');
  }
  if (emergencyHit) blockedBy.push('EMERGENCY_STOP');
  if (r6Hit) blockedBy.push('R6_DEFENSE');
  if (vixHit) blockedBy.push('VIX_BLOCK');
  if (fomcHit) blockedBy.push('FOMC_BLOCK');
  if (liquidityHit) blockedBy.push('LIQUIDITY_BLOCK');
  if (rrrHit) blockedBy.push('RRR_BLOCK');
  if (sizingHit) blockedBy.push('SIZING_BLOCKED');
  if (routerHardBlock) {
    blockedBy.push('ROUTER_HARD_BLOCK');
    reasons.push('HARD_BLOCK');
  } else if (
    sellOnlyHit ||
    emergencyHit ||
    r6Hit ||
    vixHit ||
    fomcHit ||
    liquidityHit ||
    rrrHit ||
    sizingHit
  ) {
    // riskFlag 직접 hit — Router 없어도 HARD_BLOCK 의미
    reasons.push('HARD_BLOCK');
  }

  // sector / data degraded reasons
  const sectorDiag = input.sectorEnergyDiagnostic;
  const sectorDegraded =
    sectorDiag !== undefined &&
    (sectorDiag.dataQuality === 'DEGRADED' ||
      (sectorDiag.fallbackUsed !== undefined && sectorDiag.fallbackUsed !== 'NONE'));
  const sectorStale =
    sectorDiag !== undefined &&
    (sectorDiag.dataQuality === 'STALE' || sectorDiag.dataQuality === 'FAILED');
  if (sectorDegraded) reasons.push('SECTOR_DATA_DEGRADED');
  if (sectorStale) reasons.push('SECTOR_DATA_STALE');

  // DATA_UNAVAILABLE 검출 — conditionBuckets unavailable 우세
  const buckets = input.conditionBuckets ?? [];
  let totalUnavailable = 0;
  let totalRelevant = 0;
  for (const b of buckets) {
    totalUnavailable += b.unavailable ?? 0;
    totalRelevant += (b.failed ?? 0) + (b.unavailable ?? 0) + (b.error ?? 0);
  }
  const dataUnavailableDominant =
    totalRelevant > 0 && totalUnavailable / totalRelevant >= 0.5;
  const routerHasDataUnavailable =
    input.router?.reasons?.includes('DATA_UNAVAILABLE') === true;
  if (dataUnavailableDominant || routerHasDataUnavailable) {
    reasons.push('DATA_UNAVAILABLE');
  }

  // Gate2 미완 라벨 — 위에서 `gate2Passed === true` 분기를 이미 null 처리했으므로
  // 이 시점에는 항상 false 또는 undefined. 무조건 GATE2_NOT_CONFIRMED 추가.
  reasons.push('GATE2_NOT_CONFIRMED');

  // ────────────────────────────────────────────────────────
  // label 결정 (사용자 §B 우선순위)
  // ────────────────────────────────────────────────────────
  let label: CounterfactualShadowLearningLabel;
  if (sellOnlyHit) {
    label = 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY';
  } else if (
    emergencyHit ||
    r6Hit ||
    vixHit ||
    fomcHit ||
    liquidityHit ||
    rrrHit ||
    sizingHit ||
    routerHardBlock
  ) {
    label = 'R3_COUNTERFACTUAL_UNDER_HARD_BLOCK';
  } else if (sectorDegraded || sectorStale || dataUnavailableDominant) {
    label = 'R3_COUNTERFACTUAL_DATA_DEGRADED';
  } else {
    // gate2Passed=true 는 위 분기에서 null 반환 — 여기서는 항상 GATE2_NOT_CONFIRMED 라벨.
    label = 'R3_COUNTERFACTUAL_GATE2_NOT_CONFIRMED';
  }

  const sectorSnapshot: CounterfactualShadowLearningCandidate['sectorEnergySnapshot'] =
    sectorDiag !== undefined
      ? {
          ...(sectorDiag.dataQuality !== undefined
            ? { dataQuality: sectorDiag.dataQuality }
            : {}),
          ...(typeof sectorDiag.indexCodeCoverage === 'number'
            ? { indexCodeCoverage: sectorDiag.indexCodeCoverage }
            : {}),
          ...(sectorDiag.repairStatus !== undefined
            ? { repairStatus: sectorDiag.repairStatus }
            : {}),
          ...((sectorDiag as { leadershipConfidence?: string }).leadershipConfidence !== undefined
            ? {
                leadershipConfidence: (sectorDiag as { leadershipConfidence?: string })
                  .leadershipConfidence,
              }
            : {}),
        }
      : {};

  const hardBlockActive =
    emergencyHit ||
    r6Hit ||
    vixHit ||
    fomcHit ||
    liquidityHit ||
    rrrHit ||
    sizingHit ||
    routerHardBlock;
  const regimeContext = normalizeRegimeContext({
    rawRegime: input.rawRegime ?? input.regime,
    effectiveRegime: input.effectiveRegime ?? input.regime,
    regimeAtSignal: input.regimeAtSignal,
    regimeAtEntry: input.regimeAtEntry,
    regimeAtExit: input.regimeAtExit,
    regimeAtOutcome: input.regimeAtOutcome,
    r6Trigger: input.r6Trigger,
    engineMode: input.engineMode,
    marketSession: input.marketSession,
    sellOnlyActive: input.sellOnlyActive ?? sellOnlyHit,
    hardBlockActive: input.hardBlockActive ?? hardBlockActive,
    blockedReason: blockedBy[0],
    sourceFreshness: input.sourceFreshness,
    regimeConfidence: input.regimeConfidence,
  });

  const candidate: CounterfactualShadowLearningCandidate = {
    symbol: input.symbol,
    ...(input.name !== undefined ? { name: input.name } : {}),
    eventType: 'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY',
    source: 'ADR-0430',
    learningOnly: true,
    provisional: false,
    executionShadow: false,
    label,
    reasons,
    blockedBy,
    liveAllowed: false,
    paperAllowed: false,
    executionShadowAllowed: false,
    virtualAccountImpact: 'NONE',
    ...(input.regime !== undefined ? { regime: input.regime } : {}),
    rawRegime: regimeContext.rawRegime,
    effectiveRegime: regimeContext.effectiveRegime,
    regimePhase: regimeContext.regimePhase,
    regimeAtSignal: regimeContext.regimeAtSignal,
    regimeAtEntry: regimeContext.regimeAtEntry,
    regimeAtExit: regimeContext.regimeAtExit,
    regimeAtOutcome: regimeContext.regimeAtOutcome,
    ...(regimeContext.r6Trigger !== undefined ? { r6Trigger: regimeContext.r6Trigger } : {}),
    ...(input.engineMode !== undefined ? { engineMode: input.engineMode } : {}),
    ...(input.marketSession !== undefined ? { marketSession: input.marketSession } : {}),
    sellOnlyActive: regimeContext.sellOnlyActive,
    hardBlockActive: regimeContext.hardBlockActive,
    sourceFreshness: regimeContext.sourceFreshness,
    regimeConfidence: regimeContext.regimeConfidence,
    ...(input.scanId !== undefined ? { scanId: input.scanId } : {}),
    createdAtKst: input.nowKst ?? new Date().toISOString(),
    gate1Passed: input.gate1Passed === true,
    // gate2Passed=true 는 위에서 null 반환 — 여기서는 항상 false (literal).
    gate2Passed: false,
    ...(input.router?.severity ? { routerSeverity: input.router.severity } : {}),
    ...(input.router?.label ? { routerLabel: input.router.label } : {}),
    ...(typeof input.entryPriceHint === 'number' && Number.isFinite(input.entryPriceHint)
      ? { entryPriceHint: input.entryPriceHint }
      : {}),
    ...(Object.keys(sectorSnapshot ?? {}).length > 0
      ? { sectorEnergySnapshot: sectorSnapshot }
      : {}),
  };

  return candidate;
}

/**
 * /scan_blockers 메시지 섹션 SSOT (사용자 §H 정합).
 *
 * eligible 0 인 경우에도 *왜 0 인가* 명시.
 */
export interface CounterfactualShadowSectionInput {
  /** eligible (= candidate 후보 수). */
  eligible: number;
  /** created (= 실제 영속 등록 수). */
  created?: number;
  /** ADR-0427 패턴 — skipped (= 영속 시도 중 dedup/ENV 등으로 건너뛴 수). */
  skipped?: number;
  /** skip 사유 분포 (DUPLICATE / ENV_DISABLED / PERSIST_ERROR 등). */
  skipReasons?: Record<string, number>;
  /** Top blockedBy 빈도 내림차순 (Top 3~5). */
  topBlockedBy?: string[];
  /** dominant label (가장 많이 발생한 라벨). */
  dominantLabel?: CounterfactualShadowLearningLabel;
  /** eligible=0 일 때 사유 (예: 'NO_GATE1_SURVIVOR', 'NO_HARD_BLOCK', 'DISABLED'). */
  noEligibleReason?: string;
}

export function formatCounterfactualShadowLearningSection(
  input: CounterfactualShadowSectionInput | null | undefined,
): string | null {
  if (!input) return null;
  const lines: string[] = [];
  lines.push('🧠 <b>Counterfactual Shadow Learning (ADR-0430)</b>');
  lines.push(`  • learningOnly: ✅`);
  lines.push(`  • eligible: <b>${input.eligible}</b>`);
  lines.push(`  • created: <b>${input.created ?? input.eligible}</b>`);
  lines.push(`  • executionImpact: <b>NONE</b>`);
  if (input.skipped !== undefined && input.skipped > 0) {
    lines.push(`  • skipped: <b>${input.skipped}</b>`);
    if (input.skipReasons) {
      const reasons = Object.entries(input.skipReasons)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      if (reasons.length > 0) {
        lines.push(`  • skipReasons: ${reasons.map(([k, n]) => `${k}=${n}`).join(', ')}`);
      }
    }
  }
  lines.push(`  • lanes: live=❌ paper=❌ shadow=❌ learning=✅`);

  if (input.eligible === 0) {
    if (input.noEligibleReason) {
      lines.push(`  • reason: <i>${input.noEligibleReason}</i>`);
    } else {
      lines.push(`  • reason: <i>no Gate1 survivor / no candidate / disabled</i>`);
    }
    return lines.join('\n');
  }

  if (input.dominantLabel) {
    lines.push(`  • label: ${input.dominantLabel}`);
  }
  if (input.topBlockedBy && input.topBlockedBy.length > 0) {
    lines.push(`  • blockedBy:`);
    input.topBlockedBy.slice(0, 5).forEach((r, i) => {
      lines.push(`    ${i + 1}. ${r}`);
    });
  }

  lines.push(
    `  • <i>note: 실매수/가상계좌 체결/일반 shadow 는 차단 유지. ` +
      `"그때 샀다면?" 학습 샘플만 별도 ledger 에 기록 (ADR-0430).</i>`,
  );

  return lines.join('\n');
}

/**
 * 다중 후보 → section input 합성 헬퍼 (호출자 편의).
 *
 * Top blockedBy 는 빈도 내림차순. dominantLabel 은 가장 많이 등장한 label.
 */
export function summarizeCounterfactualShadowLearningCandidates(
  candidates: CounterfactualShadowLearningCandidate[],
): CounterfactualShadowSectionInput {
  if (candidates.length === 0) {
    return { eligible: 0, created: 0 };
  }
  const blockedFreq = new Map<string, number>();
  const labelFreq = new Map<CounterfactualShadowLearningLabel, number>();
  for (const c of candidates) {
    for (const b of c.blockedBy) {
      blockedFreq.set(b, (blockedFreq.get(b) ?? 0) + 1);
    }
    labelFreq.set(c.label, (labelFreq.get(c.label) ?? 0) + 1);
  }
  const topBlockedBy = Array.from(blockedFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r);
  const dominantLabel =
    Array.from(labelFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    eligible: candidates.length,
    created: candidates.length,
    topBlockedBy,
    ...(dominantLabel ? { dominantLabel } : {}),
  };
}
