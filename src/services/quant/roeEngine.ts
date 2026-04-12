/**
 * roeEngine.ts — ROE 유형 전이 감지기
 *
 * ROE 유형 패턴([3,3,3,4])과 총자산회전율 QoQ 하락으로
 * 매출 성장 동력 소실을 선행 감지하여 Gate 1 패널티를 부여.
 */

import type { ROEType, ROETransitionResult } from '../../types/quant';

// ─── IDEA 3: ROE 유형 전이 감지기 ────────────────────────────────────────────

/**
 * ROE 유형 전이 감지
 *
 * 규칙 A — [3,3,3,4] 패턴: 최근 4분기 중 마지막이 Type 4 → Gate 1 패널티
 * 규칙 B — 총자산회전율 QoQ 하락 5% 이상: Type 3→4 전이 경보
 *
 * @param roeTypeHistory  최근 분기 ROE 유형 배열 (오래된 것→최신 순)
 * @param assetTurnoverHistory  최근 2개 분기 총자산회전율 (오래된 것→최신 순, 없으면 [])
 */
export function detectROETransition(
  roeTypeHistory: ROEType[],
  assetTurnoverHistory: number[] = [],
): ROETransitionResult {
  const pattern = roeTypeHistory.slice(-4);
  const len = pattern.length;

  // 규칙 A: [3,3,3,4] 패턴 — 최근 분기가 4이고 직전 3개 이상이 3
  const latestIsType4 = len >= 1 && pattern[len - 1] === 4;
  const prev3AllType3 = len >= 4 && pattern.slice(0, len - 1).every(t => t === 3);
  const ruleA = latestIsType4 && prev3AllType3;

  // 연속 Type 4 카운트 (끝에서 역순)
  let consecutiveType4Count = 0;
  for (let i = pattern.length - 1; i >= 0; i--) {
    if (pattern[i] === 4) consecutiveType4Count++;
    else break;
  }

  // 규칙 B: 총자산회전율 QoQ 하락 5% 이상
  let assetTurnoverDropPct = 0;
  if (assetTurnoverHistory.length >= 2) {
    const prev = assetTurnoverHistory[assetTurnoverHistory.length - 2];
    const curr = assetTurnoverHistory[assetTurnoverHistory.length - 1];
    if (prev > 0) assetTurnoverDropPct = ((prev - curr) / prev) * 100;
  }
  const ruleB = assetTurnoverDropPct >= 5;

  const detected = ruleA || ruleB;

  let transitionType: ROETransitionResult['transitionType'] = 'NONE';
  if (ruleA && ruleB) transitionType = 'BOTH';
  else if (ruleA) transitionType = 'TYPE3_TO_4';
  else if (ruleB) transitionType = 'ASSET_TURNOVER_DROP';

  // alert 수준: PENALTY(Gate 1 패널티) / WATCH(1분기만 감지) / NONE
  let alert: ROETransitionResult['alert'] = 'NONE';
  if (ruleA || (ruleB && latestIsType4)) alert = 'PENALTY';
  else if (latestIsType4 || ruleB) alert = 'WATCH';

  const penaltyApplied = alert === 'PENALTY';

  let actionMessage = '이상 없음 — ROE 유형 안정적';
  if (transitionType === 'BOTH') {
    actionMessage = '⛔ ROE 유형 3→4 전이 확인 + 총자산회전율 QoQ 하락 — Gate 1 패널티 자동 적용';
  } else if (transitionType === 'TYPE3_TO_4') {
    actionMessage = '⛔ [3,3,3,4] 패턴 감지 — 매출 성장 동력 소실, Gate 1 패널티 자동 적용';
  } else if (transitionType === 'ASSET_TURNOVER_DROP') {
    actionMessage = `⚠️ 총자산회전율 QoQ ${assetTurnoverDropPct.toFixed(1)}% 하락 — Type 3→4 전이 경보`;
  } else if (alert === 'WATCH') {
    actionMessage = `⚠️ Type 4 분기 감지 (연속 ${consecutiveType4Count}분기) — 추가 분기 확인 필요`;
  }

  return {
    detected,
    pattern,
    transitionType,
    consecutiveType4Count,
    assetTurnoverDropPct,
    alert,
    penaltyApplied,
    actionMessage,
  };
}
