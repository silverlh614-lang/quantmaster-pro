/**
 * @responsibility 시스템 전체의 시간축과 시장 상태를 제어하는 단일 진실 원천 (SSOT)
 */

export type MarketCode = 'KRX';

export type SessionState =
  | 'OPEN'
  | 'CLOSED'
  | 'HOLIDAY'
  | 'WEEKEND'
  | 'DATA_UNAVAILABLE';

export type DataMode =
  | 'LIVE'
  | 'EOD_CONFIRMED'
  | 'HOLIDAY_SNAPSHOT'
  | 'STALE_ALLOWED'
  | 'BLOCKED';

export interface TradingPermissions {
  allowSignalGeneration: boolean;
  allowWatchlistRefresh: boolean;
  allowShadowLearning: boolean;
  allowBackfill: boolean;
  allowFutureReturnResolve: boolean;
  allowFreshnessDecay: boolean;
}

/**
 * MarketTruthLayer 가 생성하여 모든 하위 모듈로 주입하는 런타임 컨텍스트.
 * 모듈 내에서 직접 `new Date()`를 호출하는 것은 엄격히 금지된다.
 */
export interface TradingContext {
  /** 달력 상의 실제 오늘 날짜 (YYYY-MM-DD) */
  calendarDate: string;
  market: MarketCode;

  isTradingDay: boolean;
  sessionState: SessionState;

  /** 분석의 기준이 되는 거래일 (휴장일일 경우 마지막 확정 거래일) */
  effectiveTradingDate: string;
  /** effectiveTradingDate 기준 실제 직전 개장일 (비교 지표 연산용) */
  previousTradingDate: string;
  /** 다음 실제 개장 예정일 */
  nextTradingDate: string;

  dataMode: DataMode;
  
  permissions: TradingPermissions;

  /** 컨텍스트 생성 시점의 ISO 타임스탬프 */
  generatedAt: string;
  /** 컨텍스트 생성 주체 */
  source: 'MarketTruthLayer';
  reason?: string;
}