// @responsibility drift 패턴으로 액면분할/병합/권리락 의심 분류 SSOT — DART 매칭은 후속
/**
 * corporateActionDetector.ts (ADR-0113) — 코퍼레이트 액션 detector.
 *
 * 1차 로그(2026-04-30) 의 098460 고영 +221% / 336260 두산테스나 +207% 같은 워치리스트
 * drift 패턴이 분할/병합/권리락 의심 사례임을 자동 분류.
 *
 * 본 PR scope:
 *   - drift % + windowDays 입력으로 SPLIT/MERGE/RIGHTS/UNKNOWN 분류만
 *   - DART 공시 매칭 (유상증자결정/주식분할/무상증자결정) 은 후속 PR 분리
 *
 * ENV `CORPORATE_ACTION_DETECTOR_DISABLED=true` → 항상 detected=false 반환.
 */

export type CorporateActionType = 'SPLIT' | 'MERGE' | 'RIGHTS' | 'UNKNOWN';

export interface CorporateActionResult {
  detected: boolean;
  type: CorporateActionType;
  driftPct: number;
  reason: string;
}

export interface CorporateActionInput {
  /** drift % (양/음 부호 보존) */
  driftPct: number;
  /** drift 창 (1d 또는 5d 또는 그 외) */
  windowDays?: 1 | 5 | number;
}

export const CORPORATE_ACTION_THRESHOLDS = {
  /** > 150% drift 면 분할/병합 강제 의심 */
  STRONG_DRIFT_PCT: 150,
  /** 50~150% drift + windowDays=1 이면 권리락 의심 */
  RIGHTS_DRIFT_MIN: 50,
  RIGHTS_DRIFT_MAX: 150,
} as const;

const NOT_DETECTED: CorporateActionResult = {
  detected: false,
  type: 'UNKNOWN',
  driftPct: 0,
  reason: 'no_pattern_match',
};

export function isCorporateActionDetectorDisabled(): boolean {
  return process.env.CORPORATE_ACTION_DETECTOR_DISABLED === 'true';
}

/**
 * drift 패턴으로 코퍼레이트 액션 의심 분류.
 *
 * 분류 규칙:
 *   - |drift| > 150% AND drift > 0 → SPLIT (역분할/감자, 가격 상승)
 *   - |drift| > 150% AND drift < 0 → SPLIT (분할 후 가격 하락)
 *   - 50~150% AND windowDays=1 → RIGHTS (권리락 추정)
 *   - 그 외 → UNKNOWN (detected=false)
 */
export function detectCorporateAction(input: CorporateActionInput): CorporateActionResult {
  if (isCorporateActionDetectorDisabled()) return NOT_DETECTED;

  const { driftPct, windowDays } = input;
  if (!Number.isFinite(driftPct)) {
    return { ...NOT_DETECTED, reason: 'invalid_drift' };
  }

  const absDrift = Math.abs(driftPct);
  const STRONG = CORPORATE_ACTION_THRESHOLDS.STRONG_DRIFT_PCT;
  const RIGHTS_MIN = CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MIN;
  const RIGHTS_MAX = CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MAX;

  // 강한 drift — 분할/병합/감자 강제 의심
  if (absDrift > STRONG) {
    if (driftPct > 0) {
      return {
        detected: true,
        type: 'SPLIT',
        driftPct,
        reason: `strong_positive_drift_${absDrift.toFixed(1)}%_split_or_reverse_merger_suspected`,
      };
    }
    return {
      detected: true,
      type: 'SPLIT',
      driftPct,
      reason: `strong_negative_drift_${absDrift.toFixed(1)}%_split_or_merger_suspected`,
    };
  }

  // 50~150% AND 1일 윈도우 → 권리락 의심
  if (
    windowDays === 1
    && absDrift >= RIGHTS_MIN
    && absDrift <= RIGHTS_MAX
  ) {
    return {
      detected: true,
      type: 'RIGHTS',
      driftPct,
      reason: `1d_drift_${absDrift.toFixed(1)}%_rights_offering_suspected`,
    };
  }

  return { ...NOT_DETECTED, driftPct };
}
