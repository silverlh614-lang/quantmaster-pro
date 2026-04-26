// @responsibility 3-플래그 Enemy Checklist 평가 순수 함수 (ADR-0031 PR-D)

import type { StockRecommendation } from '../services/stockService';
import type { EnemyChecklistFlag, EnemyChecklistSummary } from '../types/ui';

const MARGIN_OVERHEAT_PCT = 5;     // 신용잔고 5일 ≥ 5% 증가 → 과열
const WEEKLY_RSI_OVERHEAT = 70;    // 주봉 RSI ≥ 70 → 과열

export interface EnemyChecklistInput {
  stock: StockRecommendation;
  /** macroEnv.marginBalance5dChange — 시장 전체 신용잔고 5일 변화율 (%). */
  marginBalance5dChange?: number | null;
  /** weeklyRsiValues[stock.code] — 종목 주봉 RSI. */
  weeklyRsi?: number | null;
}

function asFiniteNumber(n: number | null | undefined): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n;
}

/**
 * 3 플래그 매수 거부 신호 평가:
 *   - 공매도 잔고 증가 (shortSelling.trend === 'INCREASING')
 *   - 신용잔고 과열 (marginBalance5dChange ≥ 5%)
 *   - 주봉 RSI 과열 (weeklyRsi ≥ 70)
 *
 * verdict: ≥2 WARNING → BLOCK / 1 → CAUTION / 0 → CLEAR.
 *
 * 데이터 부재 시 해당 플래그는 'CLEAR' (안전 fallback) — 잘못된 BLOCK 회피.
 */
export function evaluateEnemyChecklist(input: EnemyChecklistInput): EnemyChecklistSummary {
  const { stock, marginBalance5dChange, weeklyRsi } = input;

  const shortIncreasing = stock?.shortSelling?.trend === 'INCREASING';
  const margin = asFiniteNumber(marginBalance5dChange);
  const marginOverheat = margin != null && margin >= MARGIN_OVERHEAT_PCT;
  const rsi = asFiniteNumber(weeklyRsi);
  const rsiOverheat = rsi != null && rsi >= WEEKLY_RSI_OVERHEAT;

  const flags: EnemyChecklistFlag[] = [
    {
      id: 'SHORT_INCREASING',
      label: '공매도 잔고 증가',
      status: shortIncreasing ? 'WARNING' : 'CLEAR',
      detail: stock?.shortSelling
        ? `잔고 ${stock.shortSelling.trend === 'INCREASING' ? '증가' : '감소'} 추세`
        : '공매도 데이터 미수신',
    },
    {
      id: 'MARGIN_OVERHEAT',
      label: '신용잔고 과열',
      status: marginOverheat ? 'WARNING' : 'CLEAR',
      detail: margin != null
        ? `5일 ${margin.toFixed(1)}% ${marginOverheat ? '≥ 5% 과열' : '< 5% 정상'}`
        : '신용잔고 데이터 미수신',
    },
    {
      id: 'WEEKLY_RSI_OVERHEAT',
      label: '주봉 RSI 과열',
      status: rsiOverheat ? 'WARNING' : 'CLEAR',
      detail: rsi != null
        ? `RSI ${rsi.toFixed(1)} ${rsiOverheat ? '≥ 70 과열' : '< 70 정상'}`
        : '주봉 RSI 데이터 미수신',
    },
  ];

  const warningCount = flags.filter(f => f.status === 'WARNING').length;

  let verdict: EnemyChecklistSummary['verdict'];
  if (warningCount === 0) verdict = 'CLEAR';
  else if (warningCount === 1) verdict = 'CAUTION';
  else verdict = 'BLOCK';

  return { flags, warningCount, verdict };
}
