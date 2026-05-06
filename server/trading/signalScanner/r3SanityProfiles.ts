/**
 * @responsibility R3 Sanity Profile SSOT — Regime-Aware Threshold (R3_EARLY/CONFIRMED/EXPANSION/DEFAULT)
 *
 * ADR-0401 R3 Violation State Machine 의 임계 SSOT. 사용자 절대 원칙 #4 ("R3_EARLY 는
 * R3 중 더 관대하게 처리 (5회 연속)") 직접 반영.
 *
 * 외부 의존성 0 — 정적 정책 데이터만. 호출자 (`r3ViolationStateMachine.ts`) 가
 * `getR3SanityProfile(regime)` 으로 조회.
 *
 * 임계 변경은 ADR-0401 갱신 + 회귀 테스트 의무 (잘못된 해결 방법 차단 #5).
 */

export interface R3SanityProfile {
  /** WARNING 진입 최소 streak count */
  warningAt: number;
  /** ELEVATED 진입 최소 streak count */
  elevatedAt: number;
  /** SHADOW_ONLY 진입 최소 streak count */
  shadowOnlyAt: number;
  /** HARD_BLOCK 진입 최소 streak count (모든 guard 통과 시에만 적용) */
  hardBlockAt: number;
  /**
   * HARD_BLOCK 도달 최소 candidates 수 — 사용자 절대 원칙 #6
   * candidates < 본 값 시 hardBlockAllowed=false 강제 (정상 시스템 비활성).
   */
  minCandidatesForHardBlock: number;
}

/**
 * Profile SSOT — 사용자 절대 원칙 #4 정합.
 *
 * R3_EARLY: 회복 초기 + 변동성 큼 → 5회 연속까지 hardBlock 유보 (관대).
 * R3_CONFIRMED / R3_EXPANSION / DEFAULT: 안정 상승 → 3회 연속에서 hardBlock.
 *
 * 모든 profile 의 minCandidatesForHardBlock=5 — 정상 시스템 비활성 시 hardBlock 차단.
 */
export const R3_SANITY_PROFILES = {
  R3_EARLY: {
    warningAt: 1,
    elevatedAt: 2,
    shadowOnlyAt: 3,
    hardBlockAt: 5,
    minCandidatesForHardBlock: 5,
  },
  R3_CONFIRMED: {
    warningAt: 1,
    elevatedAt: 2,
    shadowOnlyAt: 2,
    hardBlockAt: 3,
    minCandidatesForHardBlock: 5,
  },
  R3_EXPANSION: {
    warningAt: 1,
    elevatedAt: 2,
    shadowOnlyAt: 2,
    hardBlockAt: 3,
    minCandidatesForHardBlock: 5,
  },
  DEFAULT: {
    warningAt: 1,
    elevatedAt: 2,
    shadowOnlyAt: 2,
    hardBlockAt: 3,
    minCandidatesForHardBlock: 5,
  },
} as const satisfies Record<string, R3SanityProfile>;

export type R3SanityProfileKey = keyof typeof R3_SANITY_PROFILES;

/**
 * regime 문자열 → profile lookup. 알 수 없는 R3 변형은 DEFAULT (보수적).
 *
 * 매칭 우선순위 (정확 매치 → 폴백):
 *   - 'R3_EARLY' → R3_EARLY profile
 *   - 'R3_CONFIRMED' → R3_CONFIRMED profile
 *   - 'R3_EXPANSION' → R3_EXPANSION profile
 *   - 'R3_*' (그 외) → DEFAULT
 *   - 'R3' 시작 안 함 → DEFAULT (호출자 측에서 isR3 가드 의무이지만 안전 fallback)
 */
export function getR3SanityProfile(regime: string | undefined | null): R3SanityProfile {
  if (!regime || typeof regime !== 'string') return R3_SANITY_PROFILES.DEFAULT;
  if (regime in R3_SANITY_PROFILES && regime !== 'DEFAULT') {
    return R3_SANITY_PROFILES[regime as R3SanityProfileKey];
  }
  return R3_SANITY_PROFILES.DEFAULT;
}
