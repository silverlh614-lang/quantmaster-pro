// @responsibility trading 영역 shadowTradeFills 컴포넌트
/**
 * Server Shadow Trade 의 fills 배열에서 파생되는 지표 계산 유틸.
 * 단일 진실 원천: fills. returnPct/status 는 지연·오염될 수 있으므로,
 * 여기 있는 함수들은 모두 fills 를 우선 참조하고 필드는 fallback 으로만 쓴다.
 */

import type { ServerShadowTrade } from '../../../api';

type Trade = Pick<ServerShadowTrade, 'fills' | 'status' | 'quantity' | 'returnPct'> & {
  originalQuantity?: number;
  shadowEntryPrice?: number;
  signalPrice?: number;
  stopLossExitType?: string;
  tradeLifecycleOutcome?: TradeLifecycleOutcome;
};
type Fill = NonNullable<ServerShadowTrade['fills']>[number];

export type TradeLifecycleOutcome =
  | 'FULL_WIN'
  | 'PARTIAL_WIN'
  | 'WIN_BREAKEVEN'
  | 'BREAKEVEN'
  | 'SMALL_WIN'
  | 'SMALL_LOSS'
  | 'FULL_LOSS'
  | 'FORCED_EXIT';

/** 체결된 매도 fill 의 수량 가중 평균 수익률(%). fills 가 없으면 trade.returnPct 반환. */
export function getWeightedPnlPct(trade: Trade): number {
  const sells = (trade.fills ?? []).filter((f) => f.type === 'SELL' && f.pnlPct != null);
  if (sells.length === 0) return trade.returnPct ?? 0;
  const totalQty = sells.reduce((s, f) => s + f.qty, 0);
  if (totalQty === 0) return 0;
  return sells.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty;
}

/** 실현 PnL(원) 합계 — SELL fill 만 집계. */
export function getTotalRealizedPnl(trade: Trade): number {
  return (trade.fills ?? [])
    .filter((f) => f.type === 'SELL' && f.pnl != null)
    .reduce((s, f) => s + (f.pnl ?? 0), 0);
}

/** SELL fill 만 추출. */
export function getSellFills(trade: Trade): Fill[] {
  return (trade.fills ?? []).filter((f) => f.type === 'SELL');
}

/**
 * 잔량(주) 재계산 — fills 단일 진실 원천.
 * BUY fill 이 없는 레거시 거래는 status 로 판정:
 *   종결 상태(HIT_TARGET/HIT_STOP/REJECTED)면 0, 그 외에는 quantity 그대로.
 */
export function getRemainingQty(trade: Trade): number {
  const fills = trade.fills ?? [];
  const buyQty  = fills.filter((f) => f.type === 'BUY').reduce((s, f) => s + f.qty, 0);
  const sellQty = fills.filter((f) => f.type === 'SELL').reduce((s, f) => s + f.qty, 0);
  if (buyQty > 0) return Math.max(0, buyQty - sellQty);
  if (trade.status === 'HIT_TARGET' || trade.status === 'HIT_STOP' || trade.status === 'REJECTED') return 0;
  return trade.quantity ?? 0;
}

/** 일부 청산 완료 상태인지 판정 (잔량 > 0 이면서 원 수량보다 적은 경우). */
export function isPartialPosition(trade: Trade): boolean {
  const orig = trade.originalQuantity ?? trade.quantity ?? 0;
  const remaining = getRemainingQty(trade);
  return remaining > 0 && remaining < orig && getSellFills(trade).length > 0;
}

/** fill timestamp 포맷 — 오늘이면 HH:MM, 다른 날이면 M월 D일. */
export function fmtFillTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString())
      return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

/** sell fill 의 subType → 한국어 레이블. */
export function fillLabel(f: Fill): string {
  if (f.type === 'BUY') return '매수';
  const st = f.subType ?? '';
  if (st === 'STOP_LOSS' || st === 'EMERGENCY') return '손절';
  if (st === 'FULL_CLOSE') return '전량익절';
  if (st === 'TRAILING_TP') return '트레일링';
  return '부분익절';
}
export function classifyUiTradeLifecycleOutcome(trade: Trade): TradeLifecycleOutcome {
  if (trade.tradeLifecycleOutcome) return trade.tradeLifecycleOutcome;
  const sells = getSellFills(trade);
  const finalSell = sells[sells.length - 1];
  const priorSells = sells.slice(0, -1);
  const hasTp = priorSells.some((f) =>
    f.subType === 'PARTIAL_TP'
    || f.subType === 'TRAILING_TP'
    || ((f.pnl ?? 0) > 0 && f.subType !== 'STOP_LOSS' && f.subType !== 'EMERGENCY')
  ) || sells.some((f) => f.subType === 'PARTIAL_TP' || f.subType === 'TRAILING_TP');
  const realizedPnl = getTotalRealizedPnl(trade);
  const weightedPnl = getWeightedPnlPct(trade);
  const finalPct = typeof finalSell?.pnlPct === 'number' ? finalSell.pnlPct : weightedPnl;
  const finalNearEntry = finalPct >= -0.5 && finalPct <= 0.5;

  if (hasTp && finalNearEntry && realizedPnl > 0) return 'WIN_BREAKEVEN';
  if (hasTp && realizedPnl > 0) return 'PARTIAL_WIN';
  if (trade.status === 'HIT_TARGET' || weightedPnl >= 1) return 'FULL_WIN';
  if (finalNearEntry && Math.abs(weightedPnl) <= 0.5) return 'BREAKEVEN';
  if (weightedPnl > 0 || realizedPnl > 0) return 'SMALL_WIN';
  if (finalSell?.subType === 'EMERGENCY') return 'FORCED_EXIT';
  if (weightedPnl > -1) return 'SMALL_LOSS';
  return 'FULL_LOSS';
}

export function tradeLifecycleLabel(outcome: TradeLifecycleOutcome): string {
  switch (outcome) {
    case 'FULL_WIN': return '전량 익절';
    case 'PARTIAL_WIN': return '부분익절 종료';
    case 'WIN_BREAKEVEN': return '부분익절 후 본절';
    case 'BREAKEVEN': return '본절 종료';
    case 'SMALL_WIN': return '소폭 수익';
    case 'SMALL_LOSS': return '소손실';
    case 'FULL_LOSS': return '손절 종료';
    case 'FORCED_EXIT': return '강제청산';
  }
}
