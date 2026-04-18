/**
 * sell/preMortem.ts — L2 펀더멘털 붕괴 (Pre-Mortem 5조건)
 *
 * 호출자(autoTradeEngine)가 최신 시장 데이터를 PreMortemData로 주입.
 *
 * 조건 1. ROE 유형 전이   — 유형 3 → 4 이상 시 50% 청산
 * 조건 2. 외국인 순매도   — 5일 누적 순매도 시 30% 청산
 * 조건 3. 데드크로스       — MA20 < MA60 교차 시 전량 청산
 * 조건 4. R6 레짐 전환    — 30% 즉시 청산
 * 조건 5. 고점 대비 -30% — 추세 붕괴 선언, 전량 청산
 */

import type {
  ActivePosition,
  PreMortemData,
  PreMortemTrigger,
} from '../../../types/sell';
import { calcDrawdown } from './util';

export function evaluatePreMortems(
  position: ActivePosition,
  data: PreMortemData,
): PreMortemTrigger[] {
  const triggers: PreMortemTrigger[] = [];

  // 1. ROE 유형 전이
  if (
    position.entryROEType === 3 &&
    data.currentROEType !== undefined &&
    data.currentROEType >= 4
  ) {
    triggers.push({
      type: 'ROE_DRIFT',
      severity: 'HIGH',
      sellRatio: 0.50,
      reason: `ROE 유형 전이: 유형 3 → ${data.currentROEType}. 50% 청산.`,
    });
  }

  // 2. 외국인 5일 순매도
  if (data.foreignNetBuy5d < 0) {
    triggers.push({
      type: 'FOREIGN_SELLOUT',
      severity: 'MEDIUM',
      sellRatio: 0.30,
      reason: `외국인 5일 누적 순매도 ${Math.round(data.foreignNetBuy5d)}억. 30% 청산.`,
    });
  }

  // 3. 데드크로스 (20일선이 60일선 아래로 교차)
  const prevMa20 = position.prevMa20 ?? data.ma20;
  const prevMa60 = position.prevMa60 ?? data.ma60;
  const wasAbove  = prevMa20 >= prevMa60;
  const isBelow   = data.ma20 < data.ma60;
  if (wasAbove && isBelow) {
    triggers.push({
      type: 'MA_DEATH_CROSS',
      severity: 'HIGH',
      sellRatio: 1.0,
      reason: `20일선 데드크로스 (MA20 ${data.ma20.toFixed(0)} < MA60 ${data.ma60.toFixed(0)}). 전량 청산.`,
    });
  }

  // 4. R6 레짐 전환
  if (data.currentRegime === 'R6_DEFENSE') {
    triggers.push({
      type: 'REGIME_DEFENSE',
      severity: 'CRITICAL',
      sellRatio: 0.30,
      reason: 'R6 DEFENSE 레짐 전환. 기존 포지션 30% 즉시 청산.',
    });
  }

  // 5. 고점 대비 -30% 추세 붕괴
  const drawdown = calcDrawdown(position);
  if (drawdown <= -0.30) {
    triggers.push({
      type: 'TREND_COLLAPSE',
      severity: 'CRITICAL',
      sellRatio: 1.0,
      reason: `고점 대비 ${(drawdown * 100).toFixed(1)}% 추세 붕괴. 전량 청산.`,
    });
  }

  return triggers;
}
