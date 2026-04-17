import {
  type ServerShadowTrade,
  getRemainingQty,
} from '../persistence/shadowTradeRepo.js';

// ─── 인터페이스 ───────────────────────────────────────────────────────────────

export interface ExitComposition {
  tp:       { qty: number; pnl: number }; // 익절 (PARTIAL_TP, FULL_CLOSE)
  sl:       { qty: number; pnl: number }; // 손절 (STOP_LOSS, EMERGENCY)
  trailing: { qty: number; pnl: number }; // 트레일링 (TRAILING_TP)
}

// exitRuleTag → 짧은 한국어/영문 레이블
const EXIT_RULE_SHORT: Record<string, string> = {
  HARD_STOP:                   'HARD STOP',
  CASCADE_FINAL:               'CASCADE',
  CASCADE_HALF_SELL:           'CASCADE ½',
  R6_EMERGENCY_EXIT:           'R6 긴급',
  MA60_DEATH_FORCE_EXIT:       'MA60',
  TARGET_EXIT:                 '목표가',
  LIMIT_TRANCHE_TAKE_PROFIT:   'LIMIT TP',
  TRAILING_PROTECTIVE_STOP:    'TRAILING',
  RRR_COLLAPSE_PARTIAL:        'RRR',
  DIVERGENCE_PARTIAL:          'DIVG',
  EUPHORIA_PARTIAL:            '과열',
};

// fill.subType → 짧은 레이블 (exitRuleTag 없을 때 폴백)
const SUBTYPE_SHORT: Record<string, string> = {
  STOP_LOSS:   'STOP',
  EMERGENCY:   '긴급',
  PARTIAL_TP:  'LIMIT TP',
  TRAILING_TP: 'TRAILING',
  FULL_CLOSE:  '목표가',
};

export interface TagSummary {
  /** 청산 완료 여부에 따른 1차 분류 */
  primary: '전량 청산' | '부분 청산' | '보유중';
  /** fills에서 파생된 규칙 태그 목록 (중복 제거) */
  subs: string[];
  /** "부분 청산 (LIMIT TP · HARD STOP)" 형식의 한 줄 요약 */
  label: string;
}

export interface PositionSummary {
  positionId: string;
  stockCode: string;
  stockName: string;
  entryPrice: number;           // 가중평균 진입가 (BUY fills 기반, 없으면 shadowEntryPrice)
  entryQuantity: number;        // originalQuantity (불변)
  entryDate: string;            // YYYY-MM-DD (KST)
  closedQuantity: number;       // Σ SELL fills qty
  remainingQuantity: number;    // entryQuantity − closedQuantity (fills 단일 진실 원천)
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  weightedAvgExitPrice: number; // Σ(price×qty) / Σqty
  totalRealizedPnL: number;     // 원화 실현 손익
  weightedReturnPct: number;    // totalRealizedPnL / (entryPrice × entryQuantity) × 100
  exitComposition: ExitComposition;
  /** 계층화된 태그 요약 (아이디어 8) */
  tagSummary: TagSummary;
}

// ─── 핵심 집계 함수 ───────────────────────────────────────────────────────────

export function aggregatePosition(trade: ServerShadowTrade): PositionSummary {
  const fills      = trade.fills ?? [];
  const buyFills   = fills.filter(f => f.type === 'BUY');
  const sellFills  = fills.filter(f => f.type === 'SELL');

  // 진입가 — BUY fills 가중평균, 없으면 shadowEntryPrice
  const totalBuyQty = buyFills.reduce((s, f) => s + f.qty, 0);
  const entryPrice  = totalBuyQty > 0
    ? buyFills.reduce((s, f) => s + f.price * f.qty, 0) / totalBuyQty
    : (trade.shadowEntryPrice ?? 0);

  // 진입 수량 — originalQuantity → BUY fills 합산 → quantity 순으로 폴백
  const entryQuantity = trade.originalQuantity
    ?? (totalBuyQty > 0 ? totalBuyQty : trade.quantity);

  const closedQuantity    = sellFills.reduce((s, f) => s + f.qty, 0);
  const remainingQuantity = getRemainingQty(trade);

  const status: 'OPEN' | 'PARTIAL' | 'CLOSED' =
    remainingQuantity === 0 ? 'CLOSED' :
    closedQuantity    >  0 ? 'PARTIAL' : 'OPEN';

  // 가중평균 청산가
  const weightedAvgExitPrice = closedQuantity > 0
    ? sellFills.reduce((s, f) => s + f.price * f.qty, 0) / closedQuantity
    : 0;

  // 실현 손익 — pnl 없으면 (exitPrice - entryPrice) × qty 로 추정
  const totalRealizedPnL = sellFills.reduce((s, f) => {
    return s + (f.pnl ?? (f.price - entryPrice) * f.qty);
  }, 0);

  const costBasis        = entryPrice * entryQuantity;
  const weightedReturnPct = costBasis > 0 ? (totalRealizedPnL / costBasis) * 100 : 0;

  // 청산 구성 — 익절·손절·트레일링 분류
  const exitComposition: ExitComposition = {
    tp:       { qty: 0, pnl: 0 },
    sl:       { qty: 0, pnl: 0 },
    trailing: { qty: 0, pnl: 0 },
  };
  for (const f of sellFills) {
    const pnl = f.pnl ?? (f.price - entryPrice) * f.qty;
    if (f.subType === 'TRAILING_TP') {
      exitComposition.trailing.qty += f.qty;
      exitComposition.trailing.pnl += pnl;
    } else if (f.subType === 'STOP_LOSS' || f.subType === 'EMERGENCY') {
      exitComposition.sl.qty += f.qty;
      exitComposition.sl.pnl += pnl;
    } else {
      // PARTIAL_TP, FULL_CLOSE, undefined → 익절
      exitComposition.tp.qty += f.qty;
      exitComposition.tp.pnl += pnl;
    }
  }

  const entryDate = (() => {
    try {
      return new Date(new Date(trade.signalTime).getTime() + 9 * 3_600_000)
        .toISOString().slice(0, 10);
    } catch { return ''; }
  })();

  // 계층화된 태그 요약 (아이디어 8)
  const tagSummary: TagSummary = (() => {
    const primary: TagSummary['primary'] =
      status === 'CLOSED' ? '전량 청산' :
      status === 'PARTIAL' ? '부분 청산' : '보유중';

    const subSet = new Set<string>();
    for (const f of sellFills) {
      if (f.exitRuleTag) subSet.add(EXIT_RULE_SHORT[f.exitRuleTag] ?? f.exitRuleTag);
      else if (f.subType)  subSet.add(SUBTYPE_SHORT[f.subType]    ?? f.subType);
    }
    const subs = [...subSet];
    const label = subs.length > 0 ? `${primary} (${subs.join(' · ')})` : primary;
    return { primary, subs, label };
  })();

  return {
    positionId: trade.id ?? '',
    stockCode: trade.stockCode,
    stockName: trade.stockName,
    entryPrice,
    entryQuantity,
    entryDate,
    closedQuantity,
    remainingQuantity,
    status,
    weightedAvgExitPrice,
    totalRealizedPnL,
    weightedReturnPct,
    exitComposition,
    tagSummary,
  };
}

export function aggregatePositions(trades: ServerShadowTrade[]): PositionSummary[] {
  return trades.map(aggregatePosition);
}
