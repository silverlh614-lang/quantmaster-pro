// @responsibility drift 패턴으로 액면분할/병합/권리락 의심 분류 + 일봉 연속성 검증 SSOT (ADR-0518)
/**
 * corporateActionDetector.ts (ADR-0113 + ADR-0301 + ADR-0518) — 코퍼레이트 액션 detector.
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
 *
 * ADR-0518 (2026-05-24) — 일봉 연속성 검증 (false-positive 차단):
 *   magnitude-only(>80%) 판정은 "수 주간 정상 +99.6% 랠리"와 "하룻밤 +100% 권리락/병합 갭"을
 *   구분하지 못함. KRX 일일 ±30% 상한가/하한가 → 정상 매매로는 하루 ±30% 초과 불가.
 *   분할/병합/권리락 ex-date 는 기계적 조정이라 단일일 갭이 ±30% 초과.
 *   따라서 RAW 일봉에서 단일일 |close-to-close| 갭 > 35%(=30%+마진) 가 있으면 CONFIRMED,
 *   없으면 GENUINE_RALLY (corporate action 아님 → benign 강등).
 *   본 SSOT 는 **PURE** — 일봉 조회(네트워크)는 caller(entryPriceDrift.ts)가 주입한다.
 *   kisChartDataFetcher 를 import 하지 않는다 (import 0건 원칙 유지).
 *   ENV `CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED=true` → 검증 skip (보수적 기존 동작 복원).
 *   ENV `CORPORATE_ACTION_GAP_THRESHOLD_PCT` → 갭 임계 override (유한 & >0 일 때).
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

// ── ADR-0518: 일봉 연속성 검증 (false-positive 차단) ────────────────────────────

/** KRX 일일 가격 제한폭 — 정상 매매로는 단일일 ±30% 초과 불가. */
export const KRX_DAILY_PRICE_LIMIT_PCT = 30;
/** corporate action 확정 갭 임계 — KRX ±30% 한계 + 마진. ENV override 가능. */
export const CORPORATE_ACTION_GAP_THRESHOLD_PCT = 35;

export type DailyBarVerdictStatus = 'CONFIRMED' | 'GENUINE_RALLY' | 'UNVERIFIABLE';

/** 일봉 최소 형태 — date(YYYYMMDD) + close 만 사용. */
export interface DailyBarLike {
  date: string;
  close: number;
}

export interface DailyBarVerdict {
  status: DailyBarVerdictStatus;
  /** 스캔 구간 내 최대 단일일 |close-to-close| 변동률(%). 검증 불가 시 null. */
  maxSingleDayMovePct: number | null;
  /** CONFIRMED 시 갭 발생 bar 의 date. */
  gapDate?: string;
  /** 실제 인접 쌍 비교에 사용된 candle 수. */
  barsExamined: number;
  reason: string;
}

/** ADR-0518 ENV gate — true 시 일봉 검증 skip (기존 보수적 동작 복원). ADR-0157 정확 비교. */
export function isDailyBarVerificationDisabled(): boolean {
  return process.env.CORPORATE_ACTION_DAILYBAR_VERIFY_DISABLED === 'true';
}

/** ADR-0518 활성 갭 임계 — ENV CORPORATE_ACTION_GAP_THRESHOLD_PCT 가 유한 & >0 이면 사용, 아니면 35. */
export function activeCorporateActionGapThresholdPct(): number {
  const raw = Number(process.env.CORPORATE_ACTION_GAP_THRESHOLD_PCT);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return CORPORATE_ACTION_GAP_THRESHOLD_PCT;
}

/** YYYYMMDD 또는 ISO 날짜 문자열을 YYYYMMDD 숫자(비교용)로 정규화. 실패 시 null. */
function normalizeDateKey(value: string | undefined | null): number | null {
  if (!value) return null;
  // KIS date 는 'YYYYMMDD', addedAt 은 ISO('2026-05-24T...'). 둘 다 숫자 8자리로 정규화.
  const digits = value.replace(/[^0-9]/g, '').slice(0, 8);
  if (digits.length < 8) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * ADR-0518 — RAW 일봉(old→new) 연속성 검증. **PURE** (네트워크 호출 없음).
 *
 * opts.sinceDate(YYYYMMDD or ISO) 가 있으면 그 날짜 **이후(>=)** candle 만 스캔한다
 * (addedAt 이후 구간만 검증 — 그 이전의 분할 갭은 무관). 스캔 대상 < 2개면 UNVERIFIABLE.
 * 인접 close 쌍 `|close[i]/close[i-1]-1|*100` 최대값을 구한다 (close<=0 인 쌍은 건너뜀).
 * 최대값 > activeThreshold → CONFIRMED(gapDate=해당 bar.date), 아니면 GENUINE_RALLY.
 */
export function verifyDailyBarContinuity(
  candles: DailyBarLike[],
  opts?: { sinceDate?: string; thresholdPct?: number },
): DailyBarVerdict {
  const threshold = Number.isFinite(opts?.thresholdPct) && (opts?.thresholdPct as number) > 0
    ? (opts!.thresholdPct as number)
    : activeCorporateActionGapThresholdPct();

  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      status: 'UNVERIFIABLE',
      maxSingleDayMovePct: null,
      barsExamined: 0,
      reason: 'no_candles',
    };
  }

  const sinceKey = normalizeDateKey(opts?.sinceDate);
  // sinceDate 가 있으면 그 날짜 이후(>=) candle 만 스캔. 날짜 파싱 실패 candle 은 보수적으로 포함.
  const scanned = sinceKey === null
    ? candles
    : candles.filter((c) => {
        const key = normalizeDateKey(c.date);
        return key === null || key >= sinceKey;
      });

  if (scanned.length < 2) {
    return {
      status: 'UNVERIFIABLE',
      maxSingleDayMovePct: null,
      barsExamined: scanned.length,
      reason: `insufficient_bars_${scanned.length}_after_since_${opts?.sinceDate ?? 'none'}`,
    };
  }

  let maxMovePct: number | null = null;
  let gapDate: string | undefined;
  let comparedPairs = 0;
  for (let i = 1; i < scanned.length; i++) {
    const prev = scanned[i - 1].close;
    const cur = scanned[i].close;
    // close<=0 또는 비유한 값 쌍은 검증 불가 → 건너뜀 (0으로 나누기 방지).
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) continue;
    comparedPairs++;
    const movePct = Math.abs((cur / prev - 1) * 100);
    if (maxMovePct === null || movePct > maxMovePct) {
      maxMovePct = movePct;
      gapDate = scanned[i].date;
    }
  }

  if (comparedPairs === 0 || maxMovePct === null) {
    return {
      status: 'UNVERIFIABLE',
      maxSingleDayMovePct: null,
      barsExamined: scanned.length,
      reason: 'no_valid_close_pairs',
    };
  }

  if (maxMovePct > threshold) {
    return {
      status: 'CONFIRMED',
      maxSingleDayMovePct: maxMovePct,
      gapDate,
      barsExamined: scanned.length,
      reason: `single_day_gap_${maxMovePct.toFixed(1)}%_gt_${threshold}%_on_${gapDate ?? 'unknown'}_corporate_action_confirmed`,
    };
  }

  return {
    status: 'GENUINE_RALLY',
    maxSingleDayMovePct: maxMovePct,
    barsExamined: scanned.length,
    reason: `max_single_day_move_${maxMovePct.toFixed(1)}%_le_${threshold}%_over_${scanned.length}_bars_genuine_rally`,
  };
}
