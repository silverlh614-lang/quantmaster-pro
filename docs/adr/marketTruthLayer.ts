import {
  DataMode,
  MarketCode,
  SessionState,
  TradingContext,
  TradingPermissions,
} from './tradingContext';

// --- 내부 유틸리티: 실제 프로젝트에서는 marketDayClassifier.ts, marketClock.ts 등으로 분리됩니다. ---

const KRX_HOLIDAYS = new Set(['2026-01-01', '2026-05-05']); // 예시 휴장일

const krxTradingDayUtil = {
  isHoliday: (date: Date): boolean => {
    return KRX_HOLIDAYS.has(formatDate(date));
  },
  isWeekend: (date: Date): boolean => {
    const day = date.getDay();
    return day === 0 || day === 6; // 0: Sunday, 6: Saturday
  },
  isTradingDay: (date: Date): boolean => {
    return !krxTradingDayUtil.isHoliday(date) && !krxTradingDayUtil.isWeekend(date);
  },
  findPreviousTradingDay: (date: Date): Date => {
    const newDate = new Date(date);
    do {
      newDate.setDate(newDate.getDate() - 1);
    } while (!krxTradingDayUtil.isTradingDay(newDate));
    return newDate;
  },
  findNextTradingDay: (date: Date): Date => {
    const newDate = new Date(date);
    do {
      newDate.setDate(newDate.getDate() + 1);
    } while (!krxTradingDayUtil.isTradingDay(newDate));
    return newDate;
  },
};

function formatDate(date: Date, timeZone = 'Asia/Seoul'): string {
  return new Intl.DateTimeFormat('fr-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
}

function getSessionState(
  now: Date,
  isTradingDay: boolean,
  isHoliday: boolean,
): SessionState {
  if (!isTradingDay) {
    return isHoliday ? 'HOLIDAY' : 'WEEKEND';
  }

  const marketOpen = new Date(now);
  marketOpen.setHours(9, 0, 0, 0);
  const marketClose = new Date(now);
  marketClose.setHours(15, 30, 0, 0);

  if (now >= marketOpen && now < marketClose) {
    return 'OPEN';
  }
  return 'CLOSED';
}

function getPermissionsAndDataMode(
  sessionState: SessionState,
): { permissions: TradingPermissions; dataMode: DataMode } {
  switch (sessionState) {
    case 'OPEN':
      return {
        permissions: {
          allowSignalGeneration: true,
          allowWatchlistRefresh: true,
          allowShadowLearning: false, // 장중에는 학습보다 실시간 대응
          allowBackfill: false,
          allowFutureReturnResolve: false,
          allowFreshnessDecay: true,
        },
        dataMode: 'LIVE',
      };
    case 'CLOSED':
      return {
        permissions: {
          allowSignalGeneration: true,
          allowWatchlistRefresh: true,
          allowShadowLearning: true,
          allowBackfill: true,
          allowFutureReturnResolve: true,
          allowFreshnessDecay: true,
        },
        dataMode: 'EOD_CONFIRMED',
      };
    case 'HOLIDAY':
    case 'WEEKEND':
      return {
        permissions: {
          allowSignalGeneration: false,
          allowWatchlistRefresh: false,
          allowShadowLearning: true, // 휴장일은 학습/백필의 시간
          allowBackfill: true,
          allowFutureReturnResolve: false,
          allowFreshnessDecay: false, // 거래일 기준 decay만 허용
        },
        dataMode: 'HOLIDAY_SNAPSHOT',
      };
    case 'DATA_UNAVAILABLE':
    default:
      return {
        permissions: {
          allowSignalGeneration: false,
          allowWatchlistRefresh: false,
          allowShadowLearning: false,
          allowBackfill: false,
          allowFutureReturnResolve: false,
          allowFreshnessDecay: false,
        },
        dataMode: 'BLOCKED',
      };
  }
}

// --- 공개 API ---

/**
 * 시스템의 시간 기준이 되는 단일 TradingContext를 생성합니다.
 * 모든 하위 모듈은 이 컨텍스트를 주입받아 사용해야 합니다.
 * @param params.market - 시장 코드 (현재 'KRX'만 지원)
 * @param params.now - 테스트 또는 특정 시점 조회를 위한 기준 시간 (주입 가능)
 * @returns 시스템의 현재 상태와 기준 거래일이 담긴 TradingContext
 */
export async function resolveTradingContext(params?: {
  market?: MarketCode;
  now?: Date;
}): Promise<TradingContext> {
  const now = params?.now ?? new Date();
  const market = params?.market ?? 'KRX';

  const calendarDate = formatDate(now);
  const isHoliday = krxTradingDayUtil.isHoliday(now);
  const isTradingDay = krxTradingDayUtil.isTradingDay(now);

  const sessionState = getSessionState(now, isTradingDay, isHoliday);

  const { permissions, dataMode } = getPermissionsAndDataMode(sessionState);

  let effectiveTradingDateObj: Date;
  if (isTradingDay && sessionState !== 'OPEN') {
    // 장마감 후에는 당일 데이터가 확정되었으므로 당일을 기준일로 삼음
    effectiveTradingDateObj = now;
  } else if (isTradingDay && sessionState === 'OPEN') {
    // 장중에는 전일 데이터가 확정 기준
    effectiveTradingDateObj = krxTradingDayUtil.findPreviousTradingDay(now);
  } else {
    // 휴장일, 주말에는 직전 마지막 거래일을 기준일로 삼음
    effectiveTradingDateObj = krxTradingDayUtil.findPreviousTradingDay(now);
  }

  const effectiveTradingDate = formatDate(effectiveTradingDateObj);
  const previousTradingDate = formatDate(
    krxTradingDayUtil.findPreviousTradingDay(effectiveTradingDateObj),
  );
  const nextTradingDate = formatDate(
    krxTradingDayUtil.findNextTradingDay(now),
  );

  const context: TradingContext = {
    calendarDate,
    market,
    isTradingDay,
    sessionState,
    effectiveTradingDate,
    previousTradingDate,
    nextTradingDate,
    dataMode,
    permissions,
    generatedAt: now.toISOString(),
    source: 'MarketTruthLayer',
  };

  return context;
}