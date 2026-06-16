// @responsibility provisionalShadowLane — R3_EARLY provisional Shadow eligibility SSOT.
//
// ADR-0426:
// R3_EARLY provisional shadow lane preserves learning samples when candidates
// are blocked by soft-degrade data conditions rather than hard risk.
//
// This lane never opens LIVE trading and never lowers gate thresholds.
// It only records virtual/shadow entries with explicit provisional labels so
// early leadership hypotheses can be evaluated later.
//
// 핵심 불변식 (사용자 명시 절대 변경 금지):
//   1. LIVE 매수 차단 — liveAllowed: false (literal, 정적 가드)
//   2. KIS 주문 경로 0줄 변경 — KIS 주문 함수 5종 import 0건
//   3. Gate threshold 변경 0
//   4. Gate2 통과 기준 완화 0
//   5. HARD_BLOCK → null 반환 (Shadow 도 차단, 사용자 §C #1·#3)
//   6. SOFT_DEGRADE 만 후보 가능
//   7. provisional label 별도 분리 (일반 Shadow buy 와 구분)
//   8. 학습 샘플 생성 PR — 매매 정책 완화 아님
//
// 외부 의존성 0 (KIS/Yahoo/외부 API 호출 0건). 순수 함수 SSOT.

import type { GateDecisionRouterResult } from './gateDecisionRouter.js';
import type { SectorEnergyQualityDiagnostic } from '../../clients/sectorEnergyQualityDiagnostic.js';
import type { ConditionBlockerBucket } from './freshScanBlockerAttribution.js';

/**
 * 3-value label union (사용자 §B 정합, 절대 변경 금지).
 *
 * 일반 Shadow buy 와 구분 의무 — provisional 마커.
 */
export type ProvisionalShadowLabel =
  | 'R3_PROVISIONAL_LEADER_DATA_DEGRADED'
  | 'R3_PROVISIONAL_LEADER_PRE_BREAKOUT'
  | 'R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED';

/**
 * 9-value reason union (사용자 §B 정합, 절대 변경 금지).
 *
 * 후보 탈락 사유가 아니라 *왜 provisional 인지* 메타데이터.
 */
export type ProvisionalShadowReason =
  | 'R3_EARLY'
  | 'GATE1_SURVIVOR'
  | 'SOFT_DEGRADE_DATA'
  | 'SECTOR_DATA_DEGRADED'
  | 'SECTOR_DATA_STALE'
  | 'DATA_UNAVAILABLE'
  | 'GATE2_NOT_CONFIRMED'
  | 'PRE_BREAKOUT_WAIT'
  | 'NO_HARD_RISK';

/**
 * Provisional Shadow 후보 영속 schema (사용자 §B 정합).
 *
 * `liveAllowed: false` literal — 정적 가드 (LIVE 매매 차단 절대 보장).
 * `shadowAllowed: true` literal — Shadow 학습 허용 의도 명시.
 * `source: 'ADR-0426'` — 일반 Shadow buy 와 구분.
 */
export interface ProvisionalShadowCandidate {
  symbol: string;
  name?: string;
  label: ProvisionalShadowLabel;
  reasons: ProvisionalShadowReason[];
  liveAllowed: false;
  shadowAllowed: true;
  source: 'ADR-0426';
  regime: 'R3_EARLY';
  gate1Passed: boolean;
  gate2Passed: boolean;
  routerSeverity?: string;
  createdAtKst?: string;
  /**
   * ADR-0620 — measurement entry reference price (additive optional).
   * 측정 기준가일 뿐 LIVE 진입가 아님 — `liveAllowed: false` 불변.
   * 미전달 시 ledger 에 미기록 → 성과 리포트 INSUFFICIENT_DATA (소급 0).
   */
  entryPrice?: number;
  /** ADR-0620 — entryPrice 출처 (KIS_CURRENT = buyListLoop currentPrice, ADR-0561 정합). */
  entryPriceSource?: 'KIS_CURRENT' | 'SCAN_SNAPSHOT';
}

export interface DeriveR3ProvisionalShadowInput {
  symbol: string;
  name?: string;
  regime?: string;
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
    liquidityBlock?: boolean;
    rrrBlock?: boolean;
    technicalBreakdown?: boolean;
  };
  /** KST ISO 시각 — 미전달 시 호출 시점 자동 합성. */
  nowKst?: string;
  /**
   * ADR-0620 — measurement entry reference price (additive optional).
   * buyListLoop currentPrice (KIS 소스, 실진입 게이트 동일, ADR-0561 정합) 주입.
   * positive finite 만 candidate 로 carry — 0/NaN/음수/undefined 는 미설정.
   */
  entryPrice?: number;
  /** ADR-0620 — entryPrice 출처 라벨. 기본 'KIS_CURRENT'. */
  entryPriceSource?: 'KIS_CURRENT' | 'SCAN_SNAPSHOT';
}

/**
 * R3_EARLY provisional shadow eligibility SSOT (사용자 §C 정합, 절대 변경 금지).
 *
 * 결정 트리 우선순위:
 *   1. regime ≠ R3_EARLY → null
 *   2. emergencyStop → null; sellOnly/r6Defense are live-entry blocks only and remain shadow-observable.
 *   3. liquidityBlock / rrrBlock → null (HARD_BLOCK)
 *   4. technicalBreakdown → null (사용자 §C — 진짜 기술 미달은 학습 표본 오염)
 *   5. router.severity === 'HARD_BLOCK' → null (ADR-0425 정합)
 *   6. router.severity === 'TRUE_WEAKNESS' → null (Shadow 도 차단)
 *   7. !gate1Passed → null
 *   8. gate2Passed === true → null (정상 통과 경로, provisional 아님)
 *   9. router.shadowAllowed === false → null (방어, ADR-0425 결정 존중)
 *   10. SOFT_DEGRADE / WATCH_ONLY 시점 + Gate1 생존자 → 후보 생성
 *
 * label 결정 (우선순위, 사용자 §C):
 *   - SECTOR_DATA_DEGRADED / STALE / DATA_UNAVAILABLE 우세 → R3_PROVISIONAL_LEADER_DATA_DEGRADED
 *   - blockReasons.preBreakoutWait → R3_PROVISIONAL_LEADER_PRE_BREAKOUT
 *   - 그 외 (Gate2 단순 미완) → R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED
 */
export function deriveR3ProvisionalShadowCandidate(
  input: DeriveR3ProvisionalShadowInput,
): ProvisionalShadowCandidate | null {
  // 1. R3_EARLY 외 regime 차단 (사용자 §C 첫 분기)
  if (input.regime !== 'R3_EARLY') return null;

  const rf = input.riskFlags ?? {};

  // 2. HARD_BLOCK 의미 — riskFlags 직접 체크 (Router 미전달 시도 차단)
  if (rf.emergencyStop) return null;

  // 3. liquidity / RRR severe block — HARD_BLOCK 동급
  if (rf.liquidityBlock || rf.rrrBlock) return null;

  // 4. technical breakdown — 진짜 기술 미달 (학습 표본 오염 차단)
  if (rf.technicalBreakdown) return null;

  // 5+6. Router 결과 검증 (ADR-0425 정합)
  if (input.router) {
    if (input.router.severity === 'HARD_BLOCK') return null;
    if (input.router.severity === 'TRUE_WEAKNESS') return null;
    // shadowAllowed=false 명시 (방어) — Router 가 Shadow 차단 결정 시 존중
    if (input.router.shadowAllowed === false) return null;
  }

  // 7. Gate1 생존자만
  if (!input.gate1Passed) return null;

  // 8. Gate2 통과는 정상 경로 — provisional 아님 (사용자 §C #6)
  if (input.gate2Passed === true) return null;

  // ────────────────────────────────────────────────────────
  // eligibility 통과 — label / reasons 합성
  // ────────────────────────────────────────────────────────
  const reasons: ProvisionalShadowReason[] = ['R3_EARLY', 'GATE1_SURVIVOR', 'NO_HARD_RISK'];

  const sectorDiag = input.sectorEnergyDiagnostic;
  const sectorDegraded =
    sectorDiag !== undefined && (
      sectorDiag.dataQuality === 'DEGRADED' ||
      (sectorDiag.fallbackUsed !== undefined && sectorDiag.fallbackUsed !== 'NONE')
    );
  const sectorStale =
    sectorDiag !== undefined && (
      sectorDiag.dataQuality === 'STALE' ||
      sectorDiag.dataQuality === 'FAILED'
    );

  // DATA_UNAVAILABLE 검출 — conditionBuckets unavailable 우세 또는 router reasons.
  const buckets = input.conditionBuckets ?? [];
  let totalUnavailable = 0;
  let totalRelevant = 0;
  for (const b of buckets) {
    totalUnavailable += b.unavailable ?? 0;
    totalRelevant +=
      (b.failed ?? 0) + (b.unavailable ?? 0) + (b.error ?? 0);
  }
  const dataUnavailableDominant =
    totalRelevant > 0 && totalUnavailable / totalRelevant >= 0.5;
  const routerHasDataUnavailable =
    input.router?.reasons?.includes('DATA_UNAVAILABLE') === true;

  if (sectorDegraded) reasons.push('SECTOR_DATA_DEGRADED');
  if (sectorStale) reasons.push('SECTOR_DATA_STALE');
  if (dataUnavailableDominant || routerHasDataUnavailable) reasons.push('DATA_UNAVAILABLE');

  // Router severity SOFT_DEGRADE 명시 시 reason 첨부
  if (input.router?.severity === 'SOFT_DEGRADE') reasons.push('SOFT_DEGRADE_DATA');

  const preWait = input.blockReasons?.preBreakoutWait === true;
  if (preWait) reasons.push('PRE_BREAKOUT_WAIT');

  // Gate2 미통과 (gate2Passed=false 또는 undefined) 라벨
  reasons.push('GATE2_NOT_CONFIRMED');

  // Label 결정 (우선순위 — 데이터 결손 > pre-breakout > 단순 Gate2 미완)
  let label: ProvisionalShadowLabel;
  if (sectorDegraded || sectorStale || dataUnavailableDominant || routerHasDataUnavailable) {
    label = 'R3_PROVISIONAL_LEADER_DATA_DEGRADED';
  } else if (preWait) {
    label = 'R3_PROVISIONAL_LEADER_PRE_BREAKOUT';
  } else {
    label = 'R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED';
  }

  return {
    symbol: input.symbol,
    ...(input.name !== undefined ? { name: input.name } : {}),
    label,
    reasons,
    liveAllowed: false,
    shadowAllowed: true,
    source: 'ADR-0426',
    regime: 'R3_EARLY',
    gate1Passed: true,
    // 위 `if (input.gate2Passed === true) return null;` 분기 통과 시점에 항상 false.
    gate2Passed: false,
    ...(input.router?.severity ? { routerSeverity: input.router.severity } : {}),
    ...(input.nowKst ? { createdAtKst: input.nowKst } : {}),
    // ADR-0620 — measurement entryPrice carry. positive finite 만 (0/NaN/음수/Infinity 거부,
    // ADR-0431 counterfactual 레인 동형). 거부 시 미설정 → 하위호환 INSUFFICIENT 경로 유지.
    ...(typeof input.entryPrice === 'number' && Number.isFinite(input.entryPrice) && input.entryPrice > 0
      ? { entryPrice: input.entryPrice, entryPriceSource: input.entryPriceSource ?? 'KIS_CURRENT' }
      : {}),
  };
}

/**
 * /scan_blockers 메시지 섹션 SSOT (사용자 §E 정합).
 *
 * eligible 0 인 경우에도 *왜 0 인가* 명시 (사용자 §E 두 번째 출력 예시).
 */
export interface ProvisionalShadowSectionInput {
  /** eligible (= candidates.length) — 후보 생성 수. */
  eligible: number;
  /** created (= 실제 영속 등록 수, 호출자가 별도 합산). 본 PR scope 미연결 시 eligible 와 동일. */
  created?: number;
  /** Duplicate 후보가 새 row 생성 대신 기존 observation row 를 refresh 한 수. */
  updated?: number;
  /** ADR-0427 — skipped (= 영속 시도 중 dedup/ENV 등으로 건너뛴 수). */
  skipped?: number;
  /** ADR-0427 — skip 사유 분포 (DUPLICATE / ENV_DISABLED / PERSIST_ERROR 등). */
  skipReasons?: Record<string, number>;
  /** Top reasons 빈도 내림차순 (Top 3~5). */
  topReasons?: ProvisionalShadowReason[];
  /** dominant label (가장 많이 발생한 라벨). */
  dominantLabel?: ProvisionalShadowLabel;
  /** eligible=0 일 때 사유 (예: 'HARD_BLOCK', 'NO_GATE1_SURVIVOR', 'TRUE_WEAKNESS'). */
  noEligibleReason?: string;
}

export function formatProvisionalShadowSection(
  input: ProvisionalShadowSectionInput | null | undefined,
): string | null {
  if (!input) return null;
  const lines: string[] = [];
  lines.push('🌱 <b>R3 Provisional Shadow Lane (ADR-0426 / ADR-0427 wiring)</b>');
  lines.push(`  • eligible: <b>${input.eligible}</b>`);
  lines.push(`  • created: <b>${input.created ?? input.eligible}</b>`);
  if (input.updated !== undefined && input.updated > 0) {
    lines.push(`  • updated: <b>${input.updated}</b>`);
  }
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
  lines.push(`  • lanes: live=❌ shadow=✅ watch=✅`);

  if (input.eligible === 0) {
    if (input.noEligibleReason) {
      lines.push(`  • blockedBy: <i>${input.noEligibleReason}</i>`);
    } else {
      lines.push(`  • blockedBy: <i>R3_EARLY 후보 없음 또는 HARD_BLOCK</i>`);
    }
    lines.push(`  • <i>note: true HARD_BLOCK can limit provisional shadow; SELL_ONLY/R6/FOMC/VIX block live entry only, while Shadow/Watch diagnostics stay available.</i>`);
    return lines.join('\n');
  }

  if (input.dominantLabel) {
    lines.push(`  • label: ${input.dominantLabel}`);
  }
  if (input.topReasons && input.topReasons.length > 0) {
    lines.push(`  • top reasons:`);
    input.topReasons.slice(0, 5).forEach((r, i) => {
      lines.push(`    ${i + 1}. ${r}`);
    });
  }

  lines.push(
    `  • <i>provisional 라벨로 일반 Shadow buy 와 분리 영속 — ` +
    `LIVE 매매 영향 0, 학습 샘플 보존 (ADR-0425 SOFT_DEGRADE 위에 stack).</i>`,
  );

  return lines.join('\n');
}

/**
 * 다중 후보 → section input 합성 헬퍼 (호출자 편의).
 *
 * Top reasons 는 빈도 내림차순 (동률 시 union 선언 순서 stable).
 * dominantLabel 은 가장 많이 등장한 label.
 */
export function summarizeProvisionalShadowCandidates(
  candidates: ProvisionalShadowCandidate[],
): ProvisionalShadowSectionInput {
  if (candidates.length === 0) {
    return { eligible: 0, created: 0 };
  }
  // reasons 빈도 집계 (R3_EARLY / GATE1_SURVIVOR / NO_HARD_RISK 는 모든 후보 공통이라 제외)
  const COMMON_REASONS: ProvisionalShadowReason[] = ['R3_EARLY', 'GATE1_SURVIVOR', 'NO_HARD_RISK'];
  const reasonFreq = new Map<ProvisionalShadowReason, number>();
  const labelFreq = new Map<ProvisionalShadowLabel, number>();
  for (const c of candidates) {
    for (const r of c.reasons) {
      if (COMMON_REASONS.includes(r)) continue;
      reasonFreq.set(r, (reasonFreq.get(r) ?? 0) + 1);
    }
    labelFreq.set(c.label, (labelFreq.get(c.label) ?? 0) + 1);
  }
  const topReasons = Array.from(reasonFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([r]) => r);
  const dominantLabel =
    Array.from(labelFreq.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    eligible: candidates.length,
    created: candidates.length,
    topReasons,
    ...(dominantLabel ? { dominantLabel } : {}),
  };
}
