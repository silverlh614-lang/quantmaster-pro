// @responsibility drift 패턴으로 액면분할/병합/권리락 의심 분류 SSOT — DART 매칭은 후속
/**
 * corporateActionDetector.ts (ADR-0113 + ADR-0301) — 코퍼레이트 액션 detector.
 *
 * 1차 로그(2026-04-30) 의 098460 고영 +221% / 336260 두산테스나 +207% 같은 워치리스트
 * drift 패턴이 분할/병합/권리락 의심 사례임을 자동 분류.
 *
 * ADR-0301 (2026-05-06) 임계 완화:
 *   - STRONG_DRIFT_PCT 150 → 80 (2:1 분할 +100% 시나리오 포함)
 *   - RIGHTS_DRIFT_MAX 150 → 80 (STRONG 임계와 정합)
 *   - ABSOLUTE_DEAD_ZONE_LIMIT 250 신설 — 실제 데이터 오염 영역 (DATA_HOLD 호출자 분리)
 *   - ENV `CORPORATE_ACTION_LEGACY_THRESHOLDS=true` 시 150/150/Infinity legacy 동작 복원
 *
 * 본 PR scope:
 *   - drift % + windowDays 입력으로 SPLIT/MERGE/RIGHTS/UNKNOWN 분류만
 *   - ABSOLUTE_DEAD_ZONE 판정 헬퍼 export (호출자 측 DATA_HOLD 분기)
 *   - DART 공시 매칭 (ADR-0302) + KIS 일봉 자동 검증 (ADR-0303) 은 후속 PR 분리
 *
 * ENV `CORPORATE_ACTION_DETECTOR_DISABLED=true` → 항상 detected=false 반환.
 * ENV `CORPORATE_ACTION_LEGACY_THRESHOLDS=true` → STRONG=150 / RIGHTS_MAX=150 / DEAD_ZONE=∞.
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
  /** ADR-0301 default — > 80% drift 면 분할/병합 강제 의심 (2:1 분할 +100% 포함) */
  STRONG_DRIFT_PCT: 80,
  /** 50~80% drift + windowDays=1 이면 권리락 의심 */
  RIGHTS_DRIFT_MIN: 50,
  RIGHTS_DRIFT_MAX: 80,
  /** ADR-0301 신설 — > 250% drift 면 코퍼레이트 액션 아님 (실제 데이터 오염, DATA_HOLD 분리) */
  ABSOLUTE_DEAD_ZONE_LIMIT: 250,
  /** ADR-0301 ENV legacy — `CORPORATE_ACTION_LEGACY_THRESHOLDS=true` 시 활성 */
  LEGACY_STRONG_DRIFT_PCT: 150,
  LEGACY_RIGHTS_DRIFT_MAX: 150,
  /** 한국 시장 일일 가격제한폭(±%). 단일일 이 한계 초과는 organic 불가 → 코퍼레이트 액션. */
  KOREAN_DAILY_LIMIT_PCT: 30,
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

/** ADR-0301 ENV legacy gate — true 시 150/150/Infinity 임계 복원. ADR-0157 정확 비교 의무. */
export function isCorporateActionLegacyThresholds(): boolean {
  return process.env.CORPORATE_ACTION_LEGACY_THRESHOLDS === 'true';
}

/** ADR-0301 활성 임계 SSOT — ENV legacy 시 150, default 80. */
export function activeStrongDriftPct(): number {
  return isCorporateActionLegacyThresholds()
    ? CORPORATE_ACTION_THRESHOLDS.LEGACY_STRONG_DRIFT_PCT
    : CORPORATE_ACTION_THRESHOLDS.STRONG_DRIFT_PCT;
}

/** ADR-0301 활성 RIGHTS 상한 — ENV legacy 시 150, default 80. STRONG 과 정합. */
export function activeRightsDriftMaxPct(): number {
  return isCorporateActionLegacyThresholds()
    ? CORPORATE_ACTION_THRESHOLDS.LEGACY_RIGHTS_DRIFT_MAX
    : CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MAX;
}

/** ADR-0301 활성 절대 데드존 — ENV legacy 시 Infinity (감지 0), default 250. */
export function activeAbsoluteDeadZoneLimit(): number {
  return isCorporateActionLegacyThresholds()
    ? Number.POSITIVE_INFINITY
    : CORPORATE_ACTION_THRESHOLDS.ABSOLUTE_DEAD_ZONE_LIMIT;
}

/**
 * ADR-0301 — drift 가 *실제 데이터 오염* 영역(>250%)에 있는지 판정.
 * 호출자 측에서 DATA_HOLD 분기로 사용 (CORPORATE_ACTION 과 분리).
 * 음수 drift 도 절댓값 기준 판정. NaN/Infinity → false.
 */
export function isAbsoluteDeadZoneDrift(driftPct: number): boolean {
  if (!Number.isFinite(driftPct)) return false;
  return Math.abs(driftPct) > activeAbsoluteDeadZoneLimit();
}

/**
 * ADR-0301 — drift 가 STRONG 의심 임계 초과인지 판정 (호출자 단순화 헬퍼).
 * NaN/Infinity → false. ENV legacy 시 150 기준, default 80.
 */
export function isStrongDriftSuspected(driftPct: number): boolean {
  if (!Number.isFinite(driftPct)) return false;
  return Math.abs(driftPct) > activeStrongDriftPct();
}

/**
 * 일일 가격제한폭 기반 organic 타당성 가드 비활성 ENV.
 * `CORPORATE_ACTION_DAILY_LIMIT_GUARD_DISABLED=true` → 가드 끔(기존 절대-임계 동작 복원).
 * ADR-0157 정확 비교 의무.
 */
export function isCorporateActionDailyLimitGuardDisabled(): boolean {
  return process.env.CORPORATE_ACTION_DAILY_LIMIT_GUARD_DISABLED === 'true';
}

/**
 * N 영업일 동안 한국 ±30% 일일 제한폭으로 *이론상* 달성 가능한 최대 누적 drift(%).
 * 단일일 상한이 +30% 이므로 N 일 복리 = (1.30^N − 1)×100. N 은 최소 1 로 floor.
 */
export function maxOrganicDriftPct(elapsedTradingDays: number): number {
  const limit = CORPORATE_ACTION_THRESHOLDS.KOREAN_DAILY_LIMIT_PCT / 100;
  const n = Number.isFinite(elapsedTradingDays) ? Math.max(1, Math.floor(elapsedTradingDays)) : 1;
  return (Math.pow(1 + limit, n) - 1) * 100;
}

/**
 * 진입 ISO 시각으로부터 경과 영업일(근사). 캘린더 일수 × 5/7.
 *
 * 반환:
 *   - 양수: 신뢰 가능한 과거 시각 → 경과 영업일.
 *   - **null: 윈도우 판정 불가** — 미제공 / 파싱 불가(레거시 locale 문자열 등) / 미래·동시각.
 *     호출자는 null 을 "최근 단일일 갭임을 입증할 수 없음"으로 해석해야 한다(보수적 flag 금지).
 * (외부 캘린더 의존 없이 watchlistManager 가 코퍼레이트 액션 SSOT 를 통해 사용.)
 */
export function approxTradingDaysSince(entryIso: string | undefined, now: Date = new Date()): number | null {
  if (!entryIso) return null;
  const entryMs = Date.parse(entryIso);
  if (!Number.isFinite(entryMs)) return null;
  const diffMs = now.getTime() - entryMs;
  // 미래(음수)·비유한 → 윈도우 불명(null). 동시각(0)은 "방금 추가된 신뢰 윈도우" → 0 반환.
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return (diffMs / (24 * 3600 * 1000)) * (5 / 7);
}

/**
 * 누적 *상승* drift 가 경과 영업일 동안 ±30% 일일 제한폭으로 organic 하게 달성 가능한가?
 * true → 정상 모멘텀(점진적 상승)으로 코퍼레이트 액션/데이터 오염 아님 → 일반 drift 처리.
 *
 * 호출자(watchlistManager.applyEntryPriceDrift)가 addedAt 윈도우 컨텍스트로 직접 사용.
 * detectCorporateAction 자체는 magnitude-only 로 유지 (윈도우 판정은 caller 책임).
 *
 * - **양(+) drift 에만 적용** — 하락 drift 는 붕괴/데이터 이슈 가능성이라 면제 대상 아님.
 * - ENV 가드 비활성 시 항상 false (기존 절대-임계 동작).
 * - **윈도우 불명(null: addedAt 미제공/파싱 불가/미래) → 양수 drift 는 organic 으로 처리.**
 *   단일일 갭임을 입증할 수 없는데(레거시 타임스탬프 등) 보수적으로 코퍼레이트 액션 처리하면
 *   2배 모멘텀 랠리(147760 피엠티 등)를 반복 오탐한다. organic 처리 시 AUTO=REMOVE /
 *   MANUAL=UPDATE 로 안전 격리(실주문 0). 진짜 단일일 분할은 신뢰 윈도우(양수 일수)에서 포착.
 * - NaN drift → false.
 */
export function isOrganicallyPlausibleDrift(driftPct: number, elapsedTradingDays: number | null): boolean {
  if (isCorporateActionDailyLimitGuardDisabled()) return false;
  if (!Number.isFinite(driftPct)) return false;
  if (driftPct <= 0) return false;
  if (elapsedTradingDays === null) return true;
  return driftPct <= maxOrganicDriftPct(elapsedTradingDays);
}

/**
 * drift 패턴으로 코퍼레이트 액션 의심 분류.
 *
 * 분류 규칙 (ADR-0301 default):
 *   - |drift| > 80% AND drift > 0 → SPLIT (역분할/감자, 가격 상승)
 *   - |drift| > 80% AND drift < 0 → SPLIT (분할 후 가격 하락)
 *   - 50~80% AND windowDays=1 → RIGHTS (권리락 추정)
 *   - 그 외 → UNKNOWN (detected=false)
 *
 * ENV `CORPORATE_ACTION_LEGACY_THRESHOLDS=true` 시 150/150 임계 (ADR-0113 동작).
 */
export function detectCorporateAction(input: CorporateActionInput): CorporateActionResult {
  if (isCorporateActionDetectorDisabled()) return NOT_DETECTED;

  const { driftPct, windowDays } = input;
  if (!Number.isFinite(driftPct)) {
    return { ...NOT_DETECTED, reason: 'invalid_drift' };
  }

  const absDrift = Math.abs(driftPct);
  const STRONG = activeStrongDriftPct();
  const RIGHTS_MIN = CORPORATE_ACTION_THRESHOLDS.RIGHTS_DRIFT_MIN;
  const RIGHTS_MAX = activeRightsDriftMaxPct();

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
