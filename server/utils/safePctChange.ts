/**
 * @responsibility 갭/수익률 % 변화율 계산 단일 안전 SSOT — sanity bound + stale 가드
 *
 * ADR-0028. 코드베이스 78곳에 분산된 `((current - base) / base) * 100` 패턴을
 * 한 점으로 모아 5종 가드 일괄 적용:
 *   1. 분모 가드 — base ≤ 0 / NaN / Infinity → null
 *   2. 분자 가드 — current < 0 / NaN / Infinity → null
 *   3. 결과 NaN/Infinity 가드 → null
 *   4. Sanity bound (default ±90%) — 위반 시 null + 진단 로그 (1분 throttle)
 *   5. 호출자 컨텍스트 — label 옵션으로 위반 발생 위치 식별
 *
 * 배경: ADR-0004 의 PKX/SSNLF/SKM 상장폐지 ADR -93.69% 케이스가 *해당 경로 한정*
 * 으로만 차단됐고, 다른 경로 (marketDataRefresh.nDayReturn / riskManager.returnPct
 * / dxyMonitor.nDayPct 등) 는 stale base price + sanity bound 부재로 동일 패턴 잠재.
 *
 * 본 헬퍼는 **0% fallback 금지** — null 반환으로 호출자가 명시적으로 분기하도록
 * 강제. 기존 코드의 "stale 시 0% 로 정상 처리되던" silent degradation 차단.
 */

const DEFAULT_SANITY_BOUND_PCT = 90;
const LOG_THROTTLE_MS = 60_000;

/** 라벨별 마지막 진단 로그 시각 — 운영 로그 폭주 방지. */
const _lastWarnAt = new Map<string, number>();

/**
 * ADR-0028 §모드 분기: 변화율 계산의 *목적별* 임계값 SSOT.
 *
 * 단일 ±90% 임계가 모든 호출자에 적용되던 한계 해소:
 *   - INTRADAY (상한가 ±30%) — 일중 등락률은 30% 초과 = 비정상
 *   - DAILY (전일 갭 ±50%) — 갭 + 상한가 합산 50%
 *   - RECOMMENDATION_RETURN (장기 추천 ±300%) — 5일/20일 수익률, 테마주 폭등 정상 통과
 *   - LONG_TERM (52주 / 연간 ±1000%) — 장기 수익률, 자릿수 mismatch 만 차단
 *   - SANITY_ONLY (기본 ±90%) — 미분류 호출자 후방호환
 *
 * 호출자가 *명시 적용한 경우만* 모드별 임계 사용. 미명시 = 기존 동작 (SANITY_ONLY).
 * 즉 본 SSOT 도입은 *후방호환* — 기존 51 호출자 무수정.
 */
export type PctChangeMode =
  | 'SANITY_ONLY'
  | 'INTRADAY'
  | 'DAILY'
  | 'RECOMMENDATION_RETURN'
  | 'LONG_TERM';

export const MODE_LIMITS: Record<PctChangeMode, number> = {
  SANITY_ONLY: 90,
  INTRADAY: 30,
  DAILY: 50,
  RECOMMENDATION_RETURN: 300,
  LONG_TERM: 1000,
};

export interface SafePctChangeOptions {
  /**
   * 절대값 임계 (default 90%). 위반 시 null 반환.
   * `mode` 와 동시 명시 시 *sanityBoundPct 가 우선* — 기존 호출자 후방호환 보장.
   * 예: sectorEnergyProvider 의 거래량 ±1000% override 그대로 작동.
   */
  sanityBoundPct?: number;
  /**
   * 변화율 계산의 *목적별* 임계 모드. `sanityBoundPct` 미명시 시에만 작동.
   * 권장 매핑:
   *   - 일중 등락률 → 'INTRADAY'
   *   - 전일 대비 → 'DAILY'
   *   - 5일/20일 수익률 / 추천가 대비 → 'RECOMMENDATION_RETURN'
   *   - 52주 / 연간 → 'LONG_TERM'
   *   - 미분류 → 'SANITY_ONLY' (또는 미명시)
   */
  mode?: PctChangeMode;
  /** 진단 로그용 호출자 라벨 (예: 'marketDataRefresh.nDayReturn:KOSPI'). */
  label?: string;
  /** sanity 위반 진단 로그 출력 차단 (테스트 / 알려진 stale 경로 silent 처리). */
  silent?: boolean;
}

/**
 * 옵션의 sanityBoundPct / mode / default 우선순위 SSOT.
 * 호출자/테스트가 *어떤 임계가 적용될지* 결정적으로 산출 가능하도록 export.
 */
export function resolveSanityBound(opts: SafePctChangeOptions): number {
  if (typeof opts.sanityBoundPct === 'number' && Number.isFinite(opts.sanityBoundPct)) {
    return opts.sanityBoundPct;
  }
  if (opts.mode && opts.mode in MODE_LIMITS) {
    return MODE_LIMITS[opts.mode];
  }
  return DEFAULT_SANITY_BOUND_PCT;
}

/**
 * 안전 % 변화율 계산.
 *
 * @returns 계산 가능 + sanity 통과 시 number, 그 외 모두 null.
 *
 * @example
 *   const pct = safePctChange(currentPrice, prevClose, { label: 'gapProbe:005930' });
 *   if (pct === null) { return SKIP_NO_DATA; }
 */
export function safePctChange(
  current: number,
  base: number,
  opts: SafePctChangeOptions = {},
): number | null {
  // 1. 분모 가드
  if (!Number.isFinite(base) || base <= 0) return null;
  // 2. 분자 가드 — 음수 가격은 데이터 오류
  if (!Number.isFinite(current) || current < 0) return null;

  const result = ((current - base) / base) * 100;

  // 3. 결과 NaN/Infinity 가드
  if (!Number.isFinite(result)) return null;

  // 4. Sanity bound — sanityBoundPct > mode > default 우선순위 SSOT.
  const bound = resolveSanityBound(opts);
  if (Math.abs(result) > bound) {
    if (!opts.silent) {
      const label = opts.label ?? 'unknown';
      const now = Date.now();
      const last = _lastWarnAt.get(label) ?? 0;
      if (now - last >= LOG_THROTTLE_MS) {
        _lastWarnAt.set(label, now);
        console.warn(
          `[safePctChange] sanity 위반 @${label} — |${result.toFixed(2)}%| > ${bound}% ` +
          `(current=${current}, base=${base}). stale base 또는 데이터 오류 의심.`,
        );
      }
    }
    return null;
  }

  return result;
}

/**
 * 절대 sanity bound 만 검증 (이미 계산된 % 값을 후처리). 호출자가 직접 계산했지만
 * sanity 만 빠르게 검증하고 싶을 때 사용.
 */
export function isSanePct(pct: number, sanityBoundPct = DEFAULT_SANITY_BOUND_PCT): boolean {
  return Number.isFinite(pct) && Math.abs(pct) <= sanityBoundPct;
}

/** 테스트 전용 — 진단 로그 throttle 상태 초기화. */
export function __resetSafePctChangeWarnsForTests(): void {
  _lastWarnAt.clear();
}
