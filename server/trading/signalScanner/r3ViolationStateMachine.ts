/**
 * @responsibility R3 Violation 5단계 state machine SSOT — Regime-Aware Threshold + Guard 체인
 *
 * ADR-0401 — R3 Sanity Block 발동 조건 단계형 격상.
 *
 * State (5단계 union):
 *   - CLEAN      — 위반 없음 (streak=0)
 *   - WARNING    — 1회 발생 / 진단 텔레그램만 (latch 없음)
 *   - ELEVATED   — 2회 누적 / 강화 진단 텔레그램만 (latch 없음)
 *   - SHADOW_ONLY — 3회 누적 (R3_EARLY 외) 또는 guard 차단 / 신규 진입 차단 + shadow learning 유지 (ephemeral)
 *   - HARD_BLOCK — 5회 (R3_EARLY) / 3회 (그 외) + guards 모두 통과 / 영속 latch 생성 (ADR-0120 정합)
 *
 * Action (5단계 union):
 *   - NONE              — 정상 진행
 *   - WARNING_ONLY      — 텔레그램 진단만, 매매 흐름 영향 0
 *   - ELEVATED_ALERT    — 강화 텔레그램 진단
 *   - SHADOW_ONLY_BLOCK — 신규 진입 차단 + shadow learning 유지 (ephemeral)
 *   - HARD_BLOCK_LATCH  — `data/r3-sanity-block.json` active=true 영속 (ADR-0120)
 *
 * 외부 의존성: r3SanityProfiles + r3ViolationStreakRepo + r3SanityCheck (input type 만).
 * KIS 주문 함수 import 0건 — 정적 grep 가드 (절대 원칙 #13).
 *
 * 호출자: scanDiagnostics.ts (persistScanResults 의 R3 sanity 분기) — 단일 진입점.
 */

import type { R3SanityProfile } from './r3SanityProfiles.js';
import { getR3SanityProfile } from './r3SanityProfiles.js';
import {
  updateR3ViolationStreak,
  loadR3ViolationStreakState,
  type R3SanityViolationType,
} from '../../persistence/r3ViolationStreakRepo.js';

export type R3ViolationState =
  | 'CLEAN'
  | 'WARNING'
  | 'ELEVATED'
  | 'SHADOW_ONLY'
  | 'HARD_BLOCK';

export type R3SanityAction =
  | 'NONE'
  | 'WARNING_ONLY'
  | 'ELEVATED_ALERT'
  | 'SHADOW_ONLY_BLOCK'
  | 'HARD_BLOCK_LATCH';

/**
 * Guard 입력 — 5종 OR 평가 (+ ADR-0412 옵셔널 6번째 frozenQuoteDataQuality).
 *
 * 1건이라도 true 면 hardBlockAllowed=false (정상 시스템 비활성 상태).
 * 모두 false 시에만 HARD_BLOCK 격상 가능.
 */
export interface R3SanityGuardInput {
  /** 후보 종목 수 — < profile.minCandidatesForHardBlock 시 차단 (절대 원칙 #6) */
  candidates: number;
  /** ADR-0396 sectorEnergyDataQuality — DEGRADED/FAILED 시 차단 */
  sectorEnergyDataQuality: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED' | undefined;
  /** ADR-0190 marketDataFreshness — EXPIRED 시 차단 */
  marketDataFreshness: 'FRESH' | 'STALE' | 'EXPIRED' | undefined;
  /** volumeClock 진입 허용 — false 시 차단 (절대 원칙 #7) */
  volumeClockAllowsEntry: boolean;
  /** GatePassDistribution 산출 정상 — false 시 차단 (절대 원칙 #8) */
  gatePassDistributionFresh: boolean;
  /**
   * ADR-0412 옵셔널 6번째 guard — FrozenQuoteDetector 결과.
   *
   * - 'STALE'   → hardBlockAllowed=false + reasons.push('FROZEN_QUOTE_STALE')
   * - 'SUSPECT' → hardBlockAllowed=false + reasons.push('FROZEN_QUOTE_SUSPECT') (보수적)
   * - 'OK' / undefined → 영향 없음 (legacy 호출자 후방호환)
   *
   * 핵심: "데이터 오염 상태에서 R3 streak hard block 누적 금지" (ADR-0412 절대 원칙 #5).
   */
  frozenQuoteDataQuality?: 'OK' | 'SUSPECT' | 'STALE';
}

export interface R3ViolationStateInput {
  /** evaluateR3Sanity 결과 violation. */
  violation: R3SanityViolationType;
  /** macroGateState.regime — 'R3_EARLY' / 'R3_CONFIRMED' / 'R3_EXPANSION' 등. */
  regime: string;
  /** 같은 스캔 사이클 식별자 (KST scanDate + time 합성 권장) — 중복 +1 차단. */
  scanId?: string;
  /** Guard 5종 입력. */
  guards: R3SanityGuardInput;
  /** 시간 의존 격리 (테스트용). 미전달 시 new Date(). */
  now?: Date;
}

export interface R3ViolationStateResult {
  state: R3ViolationState;
  action: R3SanityAction;
  consecutiveCount: number;
  /** 적용된 profile (regime 별) */
  profile: R3SanityProfile;
  /** Guard 평가 결과 — 디버깅·진단·테스트용 */
  hardBlockAllowed: boolean;
  /** Guard 평가 사유 (1건이라도 차단 시 이유 누적) */
  guardReasons: string[];
  /** 본 스캔의 violation type (입력 그대로 — 진단 메시지용) */
  violation: R3SanityViolationType;
  /** 본 스캔의 regime (입력 그대로) */
  regime: string;
}

/* ───────── Guard 평가 SSOT ───────── */

/**
 * Guard 5종 OR 평가. 사용자 절대 원칙 #6/#7/#8 + ADR-0190/0396 정합.
 *
 * 평가 순서 SSOT (ADR-0401 §"Guard 평가 순서"):
 *   1. minCandidatesForHardBlock — candidates < N 시 차단
 *   2. sectorEnergyDataQuality — DEGRADED/FAILED 시 차단
 *   3. marketDataFreshness — EXPIRED 시 차단
 *   4. volumeClockAllowsEntry — false 시 차단
 *   5. gatePassDistributionFresh — false 시 차단
 *
 * 1건이라도 true (= guard 활성) 면 hardBlockAllowed=false. reasons 배열에 활성 사유 누적.
 */
export function evaluateGuards(
  guards: R3SanityGuardInput,
  profile: R3SanityProfile,
): { hardBlockAllowed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (guards.candidates < profile.minCandidatesForHardBlock) {
    reasons.push(
      `candidates=${guards.candidates} < min ${profile.minCandidatesForHardBlock} (정상 시스템 비활성)`,
    );
  }

  if (
    guards.sectorEnergyDataQuality === 'DEGRADED' ||
    guards.sectorEnergyDataQuality === 'FAILED'
  ) {
    reasons.push(`sectorEnergy=${guards.sectorEnergyDataQuality} (ADR-0396)`);
  }

  if (guards.marketDataFreshness === 'EXPIRED') {
    reasons.push('marketDataFreshness=EXPIRED (ADR-0190)');
  }

  if (guards.volumeClockAllowsEntry === false) {
    reasons.push('volumeClockAllowsEntry=false (정상 비활성 시간대)');
  }

  if (guards.gatePassDistributionFresh === false) {
    reasons.push('gatePassDistributionFresh=false (GPD 미수집)');
  }

  // ADR-0412 6번째 guard — FrozenQuoteDetector (입력 데이터 오염).
  // 절대 원칙 #5 — 데이터 오염 상태에서 R3 hard block 누적 금지.
  if (guards.frozenQuoteDataQuality === 'STALE') {
    reasons.push('FROZEN_QUOTE_STALE (ADR-0412 — 입력 데이터 오염)');
  } else if (guards.frozenQuoteDataQuality === 'SUSPECT') {
    reasons.push('FROZEN_QUOTE_SUSPECT (ADR-0412 — 입력 데이터 의심)');
  }

  return { hardBlockAllowed: reasons.length === 0, reasons };
}

/* ───────── State Machine 결정 트리 ───────── */

/**
 * State machine 결정 트리 SSOT — ADR-0401 §5 정합.
 *
 * 우선순위:
 *   1. violation === 'NONE' → CLEAN / NONE / streak reset
 *   2. violation === 'GATE_PASS_DATA_MISSING' → WARNING / WARNING_ONLY / hardBlockAllowed=false (절대 원칙 #8)
 *   3. violation === 'CANDIDATES_ZERO' → WARNING (count<elevatedAt) 또는 ELEVATED / hardBlockAllowed=false
 *   4. violation === 'GATE1_PASS_ZERO':
 *      - guards 평가 (5종 OR) → hardBlockAllowed
 *      - profile threshold 분기:
 *        - count < warningAt → CLEAN / NONE
 *        - count < elevatedAt → WARNING / WARNING_ONLY
 *        - count < shadowOnlyAt → ELEVATED / ELEVATED_ALERT
 *        - count < hardBlockAt → SHADOW_ONLY / SHADOW_ONLY_BLOCK
 *        - count >= hardBlockAt + hardBlockAllowed=true → HARD_BLOCK / HARD_BLOCK_LATCH
 *        - count >= hardBlockAt + hardBlockAllowed=false → SHADOW_ONLY / SHADOW_ONLY_BLOCK (cap)
 */
export function evaluateR3ViolationState(
  input: R3ViolationStateInput,
): R3ViolationStateResult {
  const profile = getR3SanityProfile(input.regime);

  // (1) violation=NONE → 즉시 CLEAN + streak reset
  if (input.violation === 'NONE') {
    updateR3ViolationStreak({
      violation: 'NONE',
      regime: input.regime,
      ...(input.scanId !== undefined ? { scanId: input.scanId } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
    });
    return {
      state: 'CLEAN',
      action: 'NONE',
      consecutiveCount: 0,
      profile,
      hardBlockAllowed: true,
      guardReasons: [],
      violation: 'NONE',
      regime: input.regime,
    };
  }

  // streak 갱신 (violation ≠ NONE 모든 분기 공통)
  const streak = updateR3ViolationStreak({
    violation: input.violation,
    regime: input.regime,
    ...(input.scanId !== undefined ? { scanId: input.scanId } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  const count = streak.consecutiveCount;

  // (2) GATE_PASS_DATA_MISSING — 항상 WARNING_ONLY (절대 원칙 #8 — GPD missing/stale 시 hardBlock 금지)
  if (input.violation === 'GATE_PASS_DATA_MISSING') {
    return {
      state: 'WARNING',
      action: 'WARNING_ONLY',
      consecutiveCount: count,
      profile,
      hardBlockAllowed: false,
      guardReasons: ['GATE_PASS_DATA_MISSING — 진단 전용 (ADR-0120 wiring 미완)'],
      violation: input.violation,
      regime: input.regime,
    };
  }

  // (3) CANDIDATES_ZERO — universe/워치리스트 결함, hardBlock 부적합 (사용자 절대 원칙 #6)
  if (input.violation === 'CANDIDATES_ZERO') {
    const state: R3ViolationState = count < profile.elevatedAt ? 'WARNING' : 'ELEVATED';
    const action: R3SanityAction = state === 'WARNING' ? 'WARNING_ONLY' : 'ELEVATED_ALERT';
    return {
      state,
      action,
      consecutiveCount: count,
      profile,
      hardBlockAllowed: false,
      guardReasons: ['CANDIDATES_ZERO — universe/워치리스트 결함 (시스템 결함 명시)'],
      violation: input.violation,
      regime: input.regime,
    };
  }

  // (4) GATE1_PASS_ZERO — 핵심 분기, guards 평가 + profile threshold
  const guard = evaluateGuards(input.guards, profile);

  // count < warningAt → CLEAN (방어 분기 — streak repo decay 후 1 도달)
  if (count < profile.warningAt) {
    return {
      state: 'CLEAN',
      action: 'NONE',
      consecutiveCount: count,
      profile,
      hardBlockAllowed: guard.hardBlockAllowed,
      guardReasons: guard.reasons,
      violation: input.violation,
      regime: input.regime,
    };
  }

  if (count < profile.elevatedAt) {
    return {
      state: 'WARNING',
      action: 'WARNING_ONLY',
      consecutiveCount: count,
      profile,
      hardBlockAllowed: guard.hardBlockAllowed,
      guardReasons: guard.reasons,
      violation: input.violation,
      regime: input.regime,
    };
  }

  if (count < profile.shadowOnlyAt) {
    return {
      state: 'ELEVATED',
      action: 'ELEVATED_ALERT',
      consecutiveCount: count,
      profile,
      hardBlockAllowed: guard.hardBlockAllowed,
      guardReasons: guard.reasons,
      violation: input.violation,
      regime: input.regime,
    };
  }

  if (count < profile.hardBlockAt) {
    return {
      state: 'SHADOW_ONLY',
      action: 'SHADOW_ONLY_BLOCK',
      consecutiveCount: count,
      profile,
      hardBlockAllowed: guard.hardBlockAllowed,
      guardReasons: guard.reasons,
      violation: input.violation,
      regime: input.regime,
    };
  }

  // count >= hardBlockAt — guards 통과 시에만 HARD_BLOCK 격상
  if (guard.hardBlockAllowed) {
    return {
      state: 'HARD_BLOCK',
      action: 'HARD_BLOCK_LATCH',
      consecutiveCount: count,
      profile,
      hardBlockAllowed: true,
      guardReasons: [],
      violation: input.violation,
      regime: input.regime,
    };
  }

  // hardBlockAt 도달했지만 guard 활성 → SHADOW_ONLY 까지만 cap (절대 원칙 #5)
  return {
    state: 'SHADOW_ONLY',
    action: 'SHADOW_ONLY_BLOCK',
    consecutiveCount: count,
    profile,
    hardBlockAllowed: false,
    guardReasons: guard.reasons,
    violation: input.violation,
    regime: input.regime,
  };
}

/**
 * 진단용 — 현재 영속 streak 상태 read-only. `/r3_status` 명령에서 사용.
 */
export function getCurrentR3ViolationStreak() {
  return loadR3ViolationStreakState();
}
