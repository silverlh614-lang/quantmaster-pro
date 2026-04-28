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

/**
 * ADR-0028 §PR-D3-A: PriceBase 출처+시점 메타 SSOT.
 *
 * 단순 number 기반 base 의 한계:
 *   - *언제 시점의* 가격인가? (전일종가 / 5일 전 / 6개월 전 stale)
 *   - *어디서 온* 가격인가? (KIS 실시간 / Yahoo 캐시 / 추천 시점가)
 *   - sanity bound 가 *값의 절대 크기* 만 판정 — stale base 자체를 차단 불가
 *
 * 본 메타 도입은 *옵셔널* — base 가 number 이면 기존 동작 100% 유지 (후방호환).
 * base 가 PriceBase 객체이면 isStaleBase 검증 후 통과 시에만 value 채택.
 *
 * 출처별 stale 임계 정책 (mode 기반 default + staleAfterDays override):
 *   - INTRADAY (1일) — 일중 등락률 base 는 *오늘* 가격이어야 함
 *   - DAILY (3일) — 전일 갭 base 는 *최근 영업일* 가격
 *   - RECOMMENDATION_RETURN (30일) — 5일/20일 수익률 base 는 *해당 시점* 가격
 *   - LONG_TERM (90일) — 52주 수익률 base 는 *분기 내* 가격
 *   - SANITY_ONLY (7일) — 미분류 호출자 보수적 default
 */
export type PriceSource =
  | 'KIS_REALTIME'
  | 'KIS_DAILY'
  | 'KRX_OPENAPI'
  | 'YAHOO_INTRADAY'
  | 'YAHOO_HISTORICAL'
  | 'NAVER_FINANCE'
  | 'RECOMMENDATION_TIME'
  | 'CACHE'
  | 'UNKNOWN';

export interface PriceBase {
  /** 기준 가격 값 (양수, 0/NaN/Infinity 시 분모 가드 차단). */
  value: number;
  /** 이 가격의 시점 ISO timestamp (예: '2026-04-28T15:30:00.000Z'). */
  asOf: string;
  /** 데이터 출처 — 진단 로그 + stale 검증 입력. */
  source: PriceSource;
  /**
   * 출처별 stale 임계 override (일). 미명시 시 STALENESS_LIMITS_BY_MODE 의
   * mode 기반 default 사용. 명시 시 *항상 우선* — 호출자가 출처 특성 명시.
   */
  staleAfterDays?: number;
}

/**
 * 모드별 기본 stale 임계 (일). PriceBase.staleAfterDays override 가 우선.
 * 호출자가 mode 만 지정하면 자동 적용.
 */
export const STALENESS_LIMITS_BY_MODE: Record<PctChangeMode, number> = {
  SANITY_ONLY: 7,        // 미분류 보수적 default
  INTRADAY: 1,           // 일중 — 오늘 가격
  DAILY: 3,              // 전일 갭 — 최근 영업일 (주말 포함 3일)
  RECOMMENDATION_RETURN: 30, // 5일/20일 수익률 — 한 달 이내
  LONG_TERM: 90,         // 52주 — 분기 내
};

/** PriceBase | number 입력에서 *값* 만 추출. number 입력은 그대로, PriceBase 는 .value. */
function extractBaseValue(base: number | PriceBase): number {
  return typeof base === 'number' ? base : base.value;
}

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
 * PriceBase 입력의 stale 검증 — asOf 가 *너무 오래됐는지* 판정.
 *
 * 우선순위:
 *   1. base.staleAfterDays 명시 → 그 값 (호출자 출처 특성 직접 지정)
 *   2. opts.mode 명시 → STALENESS_LIMITS_BY_MODE[mode]
 *   3. 둘 다 미명시 → SANITY_ONLY default (7일)
 *
 * @returns
 *   - true: stale (sanity 위반과 별개로 차단 대상)
 *   - false: 신선 (정상 통과)
 *
 * 잘못된 ISO / NaN 시점 → true (보수적 차단 — 미상 시점은 stale 으로 간주).
 */
export function isStaleBase(
  base: PriceBase,
  mode: PctChangeMode | undefined,
  now: Date = new Date(),
): boolean {
  const asOfTime = new Date(base.asOf).getTime();
  if (!Number.isFinite(asOfTime)) return true; // 잘못된 ISO → stale 처리

  const ageMs = now.getTime() - asOfTime;
  if (ageMs < 0) return false; // 미래 시점은 stale 아님 (시계 어긋남 시 통과)

  const limitDays = base.staleAfterDays
    ?? (mode ? STALENESS_LIMITS_BY_MODE[mode] : STALENESS_LIMITS_BY_MODE.SANITY_ONLY);
  const limitMs = limitDays * 24 * 60 * 60 * 1000;
  return ageMs > limitMs;
}

/**
 * 안전 % 변화율 계산.
 *
 * @param current 현재 값 (양수 가격, NaN/Infinity/음수 → null).
 * @param base 기준 값. number 또는 PriceBase 객체:
 *   - number: 기존 동작 (후방호환). 출처/시점 검증 없음.
 *   - PriceBase: stale 검증 추가. asOf/source 진단 로그에 노출.
 *     stale 시 null 반환 (sanity 위반과 별개 차단).
 * @param opts 모드 / sanity 임계 / 라벨 / silent 옵션.
 * @returns 계산 가능 + sanity 통과 + stale 통과 시 number, 그 외 모두 null.
 *
 * @example
 *   // 기존 호출자 후방호환 — number 그대로
 *   const pct = safePctChange(currentPrice, prevClose, { label: 'gapProbe:005930' });
 *
 *   // 신규 PriceBase — stale 자동 차단
 *   const pct = safePctChange(currentPrice, {
 *     value: prevClose,
 *     asOf: '2026-04-28T15:30:00Z',
 *     source: 'KIS_DAILY',
 *   }, { mode: 'DAILY', label: 'gapProbe:005930' });
 */
export function safePctChange(
  current: number,
  base: number | PriceBase,
  opts: SafePctChangeOptions = {},
): number | null {
  const baseValue = extractBaseValue(base);
  const isPriceBase = typeof base !== 'number';

  // 1. 분모 가드
  if (!Number.isFinite(baseValue) || baseValue <= 0) return null;
  // 2. 분자 가드 — 음수 가격은 데이터 오류
  if (!Number.isFinite(current) || current < 0) return null;

  // 2.5. PR-D3-A: PriceBase 입력 시 stale 검증 — sanity 계산 *전에* 차단.
  // stale 차단은 sanity 위반과 별개 라벨 ('STALE_BASE') 로 진단 로그 분리.
  if (isPriceBase && isStaleBase(base, opts.mode)) {
    if (!opts.silent) {
      const label = opts.label ?? 'unknown';
      const staleLabel = `${label}:STALE_BASE`;
      const now = Date.now();
      const last = _lastWarnAt.get(staleLabel) ?? 0;
      if (now - last >= LOG_THROTTLE_MS) {
        _lastWarnAt.set(staleLabel, now);
        const ageDays = ((now - new Date(base.asOf).getTime()) / (24 * 60 * 60 * 1000)).toFixed(1);
        console.warn(
          `[safePctChange] STALE_BASE @${label} — base.asOf=${base.asOf} ` +
          `(age=${ageDays}일, source=${base.source}, mode=${opts.mode ?? 'SANITY_ONLY'}). ` +
          `stale 차단으로 변화율 계산 스킵.`,
        );
      }
    }
    return null;
  }

  const result = ((current - baseValue) / baseValue) * 100;

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
        // PriceBase 입력 시 출처/시점도 진단 로그에 노출 — stale 검증은 통과했지만
        // sanity 위반인 케이스 (예: 진짜 자릿수 mismatch) 의 호출자 컨텍스트 강화.
        const baseDetail = isPriceBase
          ? `(current=${current}, base=${baseValue}@${base.asOf} src=${base.source})`
          : `(current=${current}, base=${baseValue})`;
        console.warn(
          `[safePctChange] sanity 위반 @${label} — |${result.toFixed(2)}%| > ${bound}% ` +
          `${baseDetail}. stale base 또는 데이터 오류 의심.`,
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
