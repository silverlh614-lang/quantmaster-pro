/**
 * sell/preMortem.ts — L2 펀더멘털 붕괴 (Pre-Mortem 5조건)
 *
 * 호출자(autoTradeEngine)가 최신 시장 데이터를 PreMortemData로 주입.
 *
 * 조건 1. ROE 유형 전이   — roeEngine.detectROETransition 단일 출처 소비
 * 조건 2. 외국인 순매도   — 5일 누적 순매도 시 30% 청산
 * 조건 3. 데드크로스       — MA20 < MA60 교차 시 전량 청산
 * 조건 4. R6 레짐 전환    — 30% 즉시 청산
 * 조건 5. 고점 대비 -30% — 추세 붕괴 선언, 전량 청산
 *
 * ROE 단일 출처 (Phase 2):
 *   과거 `entryROEType === 3 && currentROEType >= 4` 하드코딩을 제거하고
 *   roeEngine.detectROETransition([3,3,3,4] 패턴 + 총자산회전율 QoQ 하락)을
 *   그대로 소비한다. roeTypeHistory가 주입되면 정식 규칙으로, 없으면 기존
 *   currentROEType 단일값으로 [entry, current] 2원소 히스토리를 합성해 fallback.
 */

import type {
  ActivePosition,
  PreMortemData,
  PreMortemTrigger,
} from '../../../types/sell';
import type { ROEType, RegimeLevel } from '../../../types/core';
import { detectROETransition } from '../roeEngine';
import { calcDrawdown } from './util';
import { resolveDrawdownThreshold } from './drawdownThresholds';

/**
 * ROE 히스토리를 확정.
 * roeTypeHistory가 명시되면 그대로 사용, 없으면 position.entryROEType + data.currentROEType로
 * 최소 2원소 히스토리를 합성 (하위 호환).
 */
function resolveRoeHistory(
  position: ActivePosition,
  data: PreMortemData,
  explicitHistory?: ROEType[],
): ROEType[] {
  if (explicitHistory && explicitHistory.length > 0) return explicitHistory;

  const history: ROEType[] = [];
  if (position.entryROEType !== undefined) {
    history.push(position.entryROEType as ROEType);
  }
  if (data.currentROEType !== undefined) {
    history.push(data.currentROEType as ROEType);
  }
  return history;
}

export function evaluatePreMortems(
  position: ActivePosition,
  data: PreMortemData,
  options: {
    roeTypeHistory?: ROEType[];
    assetTurnoverHistory?: number[];
    /**
     * 2D 낙폭 역치 판정에 쓸 레짐.
     * 명시되지 않으면 data.currentRegime을 사용 (Phase 1 하위 호환).
     */
    regime?: RegimeLevel;
  } = {},
): PreMortemTrigger[] {
  const triggers: PreMortemTrigger[] = [];

  // 1. ROE 유형 전이 — roeEngine 단일 출처 소비
  const roeHistory = resolveRoeHistory(position, data, options.roeTypeHistory);
  if (roeHistory.length >= 2) {
    const roeResult = detectROETransition(
      roeHistory,
      options.assetTurnoverHistory ?? [],
    );

    if (roeResult.penaltyApplied) {
      // PENALTY 수준이면 전량 가까이, WATCH는 발동하지 않음
      // TYPE3_TO_4 단독이어도 패턴이 [3,3,3,4]면 매출 성장 동력 소실 → 50% 청산
      // BOTH(전이 + 총자산회전율 하락)면 더 위험 → 70% 청산
      const sellRatio = roeResult.transitionType === 'BOTH' ? 0.70 : 0.50;
      triggers.push({
        type: 'ROE_DRIFT',
        severity: roeResult.transitionType === 'BOTH' ? 'CRITICAL' : 'HIGH',
        sellRatio,
        reason: `${roeResult.actionMessage} (pattern=[${roeResult.pattern.join(',')}])`,
      });
    }
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

  // 5. 고점 대비 낙폭 — 레짐×프로파일 2D 역치 (Phase 3)
  const drawdown = calcDrawdown(position);
  const regimeForThreshold = options.regime ?? data.currentRegime;
  const drawdownThreshold = resolveDrawdownThreshold(regimeForThreshold, position.profile);
  if (drawdown <= drawdownThreshold) {
    triggers.push({
      type: 'TREND_COLLAPSE',
      severity: 'CRITICAL',
      sellRatio: 1.0,
      reason: `고점 대비 ${(drawdown * 100).toFixed(1)}% 추세 붕괴 `
        + `(기준 ${(drawdownThreshold * 100).toFixed(0)}%, regime=${regimeForThreshold}, profile=${position.profile}). 전량 청산.`,
    });
  }

  return triggers;
}
