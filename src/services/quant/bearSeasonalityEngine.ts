/**
 * bearSeasonalityEngine.ts — 아이디어 11: Bear 계절성 캘린더
 *
 * 통계적으로 약세 빈도가 높은 구간(9~10월, 12월 중순~1월 초, 실적 시즌 직전, FOMC 직전)을
 * 감지하여 Gate -1 임계치를 자동 조정한다.
 */

import type {
  MacroEnvironment,
  BearSeasonalityResult,
} from '../../types/quant';

const FOMC_APPROX_MEETINGS: Array<{ month: number; day: number }> = [
  { month: 1, day: 31 },
  { month: 3, day: 20 },
  { month: 5, day: 10 },
  { month: 6, day: 20 },
  { month: 7, day: 31 },
  { month: 9, day: 20 },
  { month: 11, day: 10 },
  { month: 12, day: 20 },
];

function isWithinMonthDayRange(month: number, day: number, startMonth: number, startDay: number, endMonth: number, endDay: number): boolean {
  const current = month * 100 + day;
  const start = startMonth * 100 + startDay;
  const end = endMonth * 100 + endDay;
  if (start <= end) {
    return current >= start && current <= end;
  }
  return current >= start || current <= end;
}

/**
 * 아이디어 11: 계절성 Bear Calendar
 * 통계적으로 약세 빈도가 높은 구간(9~10월, 12월 중순~1월 초, 실적 시즌 직전, FOMC 직전)을
 * 감지하여 Gate -1 임계치를 자동 조정한다.
 */
export function evaluateBearSeasonality(
  macroEnv: MacroEnvironment,
  asOfDate: Date = new Date(),
): BearSeasonalityResult {
  const now = asOfDate.toISOString();
  const month = asOfDate.getUTCMonth() + 1;
  const day = asOfDate.getUTCDate();
  const year = asOfDate.getUTCFullYear();

  const isAutumnWeakness = month === 9 || month === 10;
  const isYearEndClearing = isWithinMonthDayRange(month, day, 12, 15, 1, 10);
  const isPreQ1Earnings = isWithinMonthDayRange(month, day, 3, 25, 4, 20);

  const todayUTC = Date.UTC(year, month - 1, day);
  const isPreFomc = FOMC_APPROX_MEETINGS.some(({ month: meetingMonth, day: meetingDay }) => {
    const meetingUTC = Date.UTC(year, meetingMonth - 1, meetingDay);
    const dayDiff = Math.floor((meetingUTC - todayUTC) / (1000 * 60 * 60 * 24));
    return dayDiff >= 1 && dayDiff <= 7;
  });

  const windows: BearSeasonalityResult['windows'] = [
    {
      id: 'AUTUMN_WEAKNESS',
      name: '9~10월 약세 시즌',
      active: isAutumnWeakness,
      description: '여름 랠리 소진 + 외국인 연말 리밸런싱 선반영 구간',
      period: '9월~10월',
    },
    {
      id: 'YEAR_END_CLEARING',
      name: '연말/연초 청산 압력',
      active: isYearEndClearing,
      description: '12월 윈도우드레싱 이후 포지션 정리 물량 출회 구간',
      period: '12/15~1/10',
    },
    {
      id: 'PRE_Q1_EARNINGS',
      name: '1Q 실적 시즌 직전',
      active: isPreQ1Earnings,
      description: '어닝 쇼크 우려 선반영 매도 가능성이 높은 기간',
      period: '3/25~4/20',
    },
    {
      id: 'PRE_FOMC',
      name: 'FOMC 직전 불확실성',
      active: isPreFomc,
      description: '정책 발표 직전 리스크 오프 성향 강화 구간',
      period: 'FOMC D-7~D-1',
    },
  ];

  const activeWindowIds = windows.filter(window => window.active).map(window => window.id);
  const isBearSeason = activeWindowIds.length > 0;
  const vkospiRisingConfirmed = macroEnv.vkospiRising === true;
  const inverseEntryWeightPct = isBearSeason && vkospiRisingConfirmed ? 20 : 0;
  const gateThresholdAdjustment = isBearSeason ? -1 : 0;

  const actionMessage = !isBearSeason
    ? '계절성 Bear Calendar 비활성 — Gate -1 기본 임계치(5개) 유지.'
    : inverseEntryWeightPct > 0
      ? `약세 계절성 + VKOSPI 동반 상승 확인. 인버스 진입 확률 가중치 +${inverseEntryWeightPct}% 적용, Gate -1 민감도 강화.`
      : '약세 계절성 구간 감지. Gate -1 임계치를 자동 하향 조정하여 민감도를 높입니다.';

  return {
    isBearSeason,
    windows,
    activeWindowIds,
    gateThresholdAdjustment,
    inverseEntryWeightPct,
    vkospiRisingConfirmed,
    actionMessage,
    lastUpdated: now,
  };
}
