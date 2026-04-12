/**
 * attributionEngine.ts — Gate별 수익 귀인 분석 (아이디어 9)
 *
 * 거래 종료 시 27조건 점수 × 수익/손실 결과를 귀인 스토어에 누적하고,
 * 서버에 귀인 레코드를 비동기 전송합니다.
 */

import type { ConditionId } from '../../types/quant';
import { debugLog } from '../../utils/debug';

/**
 * 거래 종료 시 호출 — 27조건 점수 × 수익/손실 결과를 귀인 스토어에 누적
 *
 * @param conditionScores  TradeRecord.conditionScores 스냅샷
 * @param pnlPct           수익률 (양수=WIN, 음수=LOSS)
 * @param accumulate       useAttributionStore.accumulate
 */
export function runAttributionAnalysis(
  conditionScores: Record<ConditionId, number>,
  pnlPct: number,
  accumulate: (scores: Record<ConditionId, number>, isWin: boolean) => void
): void {
  const isWin = pnlPct > 0;
  accumulate(conditionScores, isWin);
  debugLog(`[귀인 분석] ${isWin ? 'WIN' : 'LOSS'} (${pnlPct.toFixed(2)}%) — ${Object.keys(conditionScores).length}개 조건 누적`);
}

/**
 * 거래 종료 귀인 레코드를 서버에 비동기 전송.
 * 네트워크 실패는 비치명적(fire-and-forget) — 클라이언트 귀인 스토어는 이미 갱신됨.
 */
export async function pushAttributionToServer(payload: {
  tradeId:         string;
  stockCode:       string;
  stockName:       string;
  closedAt:        string;
  returnPct:       number;
  isWin:           boolean;
  conditionScores: Record<ConditionId, number>;
  holdingDays:     number;
  sellReason?:     string;
  entryRegime?:    string;
}): Promise<void> {
  try {
    await fetch('/api/attribution/record', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    debugLog(`[귀인 분석] 서버 전송 완료 — ${payload.stockName} (${payload.returnPct.toFixed(2)}%)`);
  } catch (err) {
    console.warn('[귀인 분석] 서버 전송 실패 (비치명적):', err);
  }
}
