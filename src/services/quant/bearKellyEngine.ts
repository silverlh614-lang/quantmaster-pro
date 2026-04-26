// @responsibility quant bearKellyEngine 엔진 모듈
/**
 * bearKellyEngine.ts — 아이디어 6: Bear Mode Kelly Criterion
 *
 * 인버스 ETF에 대한 최적 포지션 비중 자동 계산 및 Time-Stop 관리.
 */

import type {
  BearRegimeResult,
  BearKellyResult,
} from '../../types/quant';

/** 두 날짜(ISO 문자열) 사이의 거래일(영업일) 수를 계산한다. (토·일 제외)
 * 진입일(from)은 day 0으로 간주하고, from 다음 날부터 카운트를 시작한다.
 * 예: 월요일 진입 → 화요일 end면 1거래일 경과.
 */
function countTradingDaysBetween(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  if (end <= start) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1); // 진입일(day 0) 제외, 다음 날부터 카운트
  while (cursor <= end) {
    const day = cursor.getDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Bear Mode Kelly Criterion — 인버스 ETF에 대한 최적 포지션 비중 자동 계산.
 *
 * Bear Kelly = (p × b - q) / b
 *   p = Bear 신호 합치 확률 (Gate -1 충족도로 추정)
 *   b = 기대 수익률 배수 (인버스 2X ETF ≈ 1.8)
 *   q = 1 - p
 *
 * 인버스 ETF는 시간가치 손실(음의 롤링 비용)이 있으므로
 * 최대 보유 기간을 30거래일로 제한하는 Time-Stop 로직을 포함한다.
 *
 * @param bearRegimeResult Gate -1 Bear Regime 평가 결과
 * @param entryDate 포지션 진입일 (ISO 날짜 문자열, null이면 미진입)
 */
export function evaluateBearKelly(
  bearRegimeResult: BearRegimeResult,
  entryDate: string | null = null,
  inverseEntryWeightPct: number = 0,
): BearKellyResult {
  const now = new Date().toISOString();
  const today = now.split('T')[0];

  const MAX_HOLDING_DAYS = 30;
  // 인버스 2X ETF 기대 수익률 배수 (실전 슬리피지·롤링 비용 감안 1.8)
  const B = 1.8;

  const isActive = bearRegimeResult.regime === 'BEAR';

  // rawP = 충족 조건 수 / 전체 조건 수 (Gate -1 기준, 경계 없는 원시 확률)
  const rawP = bearRegimeResult.conditions.length > 0
    ? bearRegimeResult.triggeredCount / bearRegimeResult.conditions.length
    : 0;
  // p = Bear Mode 활성 시 rawP에 0.5 하한 적용 (최소한의 Bear 신뢰도 보장);
  // Bear Mode가 아닐 때는 0으로 처리
  const weightedP = rawP * (1 + Math.max(0, inverseEntryWeightPct) / 100);
  const p = isActive ? Math.max(0.5, Math.min(weightedP, 1.0)) : 0;
  const q = 1 - p;

  // Bear Kelly 공식: (p × b - q) / b
  const rawKellyFraction = p > 0 ? Math.max(0, (p * B - q) / B) : 0;

  // 전체 켈리 포지션 (%) — 최대 30% 상한 (인버스 ETF 레버리지 위험 감안)
  const kellyPct = Math.min(rawKellyFraction * 100, 30);

  // 반 켈리 — 실전 권고 (시간가치 손실·슬리피지 보정)
  const halfKellyPct = kellyPct / 2;

  // Time-Stop 계산
  let tradingDaysElapsed = 0;
  let tradingDaysRemaining = MAX_HOLDING_DAYS;
  let timeStopTriggered = false;

  if (entryDate) {
    tradingDaysElapsed = countTradingDaysBetween(entryDate, today);
    tradingDaysRemaining = Math.max(0, MAX_HOLDING_DAYS - tradingDaysElapsed);
    timeStopTriggered = tradingDaysElapsed >= MAX_HOLDING_DAYS;
  }

  const timeStopAlert = timeStopTriggered
    ? `⚠️ Time-Stop 발동 — 진입일(${entryDate})로부터 30거래일 경과. 인버스 ETF 즉시 청산 권고. 시간가치 손실 누적으로 추가 보유 시 음(-)의 기대수익.`
    : entryDate
      ? `⏱ 잔여 ${tradingDaysRemaining}거래일 (${tradingDaysElapsed}/${MAX_HOLDING_DAYS}일 경과) — Time-Stop 30거래일 내 포지션 청산 권고.`
      : '포지션 진입 후 Time-Stop이 자동 카운트다운됩니다. 30거래일 도달 시 자동 청산 알림이 발송됩니다.';

  const formulaNote = `Bear Kelly = (p × b − q) / b = (${p.toFixed(2)} × ${B} − ${q.toFixed(2)}) / ${B} = ${rawKellyFraction.toFixed(3)} → 전체켈리 ${kellyPct.toFixed(1)}% / 반켈리 ${halfKellyPct.toFixed(1)}%`;

  let actionMessage: string;
  if (!isActive) {
    actionMessage = '🟢 Bear Regime 비활성 — Bear Kelly 포지션 없음. Gate -1이 Bear Mode를 감지하면 켈리 공식이 자동 계산됩니다.';
  } else if (timeStopTriggered) {
    actionMessage = `🔴 Time-Stop 발동 — 인버스 ETF 즉시 청산. Bear Kelly: 반켈리 ${halfKellyPct.toFixed(1)}% (전체켈리 ${kellyPct.toFixed(1)}%)`;
  } else if (kellyPct < 5) {
    actionMessage = `🟡 Bear 신호 약함 — 켈리 포지션 ${halfKellyPct.toFixed(1)}% (반켈리). 조건 추가 충족 확인 후 진입 권고.`;
  } else {
    actionMessage = `🔴 Bear Kelly 활성 — 인버스 ETF 권장 비중 ${halfKellyPct.toFixed(1)}% (반켈리). 최대 30거래일 보유, Time-Stop 엄수.`;
  }

  return {
    isActive,
    p,
    b: B,
    q,
    rawKellyFraction,
    kellyPct,
    halfKellyPct,
    maxHoldingDays: MAX_HOLDING_DAYS,
    entryDate,
    tradingDaysElapsed,
    tradingDaysRemaining,
    timeStopTriggered,
    timeStopAlert,
    formulaNote,
    actionMessage,
    lastUpdated: now,
  };
}
