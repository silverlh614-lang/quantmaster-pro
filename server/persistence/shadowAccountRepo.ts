import {
  ServerShadowTrade,
  PositionFill,
  loadShadowTrades,
  saveShadowTrades,
  syncPositionCache,
  getRemainingQty,
  getWeightedPnlPct,
  getTotalRealizedPnl,
} from './shadowTradeRepo.js';
import { loadTradingSettings } from './tradingSettingsRepo.js';

// ─── 섀도우 계좌 타입 정의 ────────────────────────────────────────────────────

/**
 * 개별 포지션의 집계 뷰.
 * ACTIVE 상태 거래에서 파생되며, fills 배열을 기반으로 계산된다.
 */
export interface ActivePosition {
  tradeId: string;
  stockCode: string;
  stockName: string;
  entryPrice: number;       // 진입가 (shadowEntryPrice)
  remainingQty: number;     // 현재 보유 수량
  originalQty: number;      // 최초 진입 수량
  investedCash: number;     // 현재 보유분에 투입된 원화 (remainingQty × entryPrice)
  stopLoss: number;
  targetPrice: number;
  signalTime: string;
  watchlistSource?: string;
  profileType?: string;
  // 현재가 주입 후 계산 (아래 두 필드는 선택적)
  currentPrice?: number;
  unrealizedPnl?: number;   // (currentPrice - entryPrice) × remainingQty
  unrealizedPct?: number;   // (currentPrice / entryPrice - 1) × 100
}

/**
 * 청산 완료된 포지션 요약.
 */
export interface ClosedTrade {
  tradeId: string;
  stockCode: string;
  stockName: string;
  entryPrice: number;
  exitPrice?: number;        // 마지막 SELL fill의 price (단순 표시용)
  originalQty: number;
  totalSoldQty: number;      // 모든 SELL fill의 qty 합산
  realizedPnl: number;       // 모든 SELL fill의 pnl 합산
  weightedPnlPct: number;    // 수량 가중 평균 수익률
  closeTime?: string;        // 마지막 SELL fill의 timestamp
  exitRuleTag?: string;      // 마지막 SELL fill의 exitRuleTag
  fills: PositionFill[];     // 해당 포지션의 전체 체결 내역
  status: string;
}

/**
 * 섀도우 계좌 전체 상태 스냅샷.
 */
export interface ShadowAccountState {
  startingCapital: number;
  cashBalance: number;       // 시작원금 - Σ(BUY fill: qty×price) + Σ(SELL fill: qty×price)
  totalInvested: number;     // Σ(ACTIVE 포지션 remainingQty × entryPrice)
  realizedPnl: number;       // 모든 청산 포지션의 실현 손익 합산
  unrealizedPnl: number;     // 현재가 기반 미실현 손익 합산 (currentPrice 주입 시)
  totalAssets: number;       // cashBalance + totalInvested + unrealizedPnl
  returnPct: number;         // (totalAssets / startingCapital - 1) × 100
  openPositions: ActivePosition[];
  closedTrades: ClosedTrade[];
  // 오늘(KST) 실현 성과 — 부분청산·전량청산 가리지 않고 금일 SELL fill 전부 합산
  todayRealizedPnl: number;  // 금일 SELL fill pnl 합산
  todaySellFillCount: number;
  // 통계
  stats: {
    totalTrades: number;     // 청산된 포지션 수
    winCount: number;
    lossCount: number;
    winRate: number;         // %
    avgWinPct: number;
    avgLossPct: number;
    expectancy: number;      // winRate×avgWin + lossRate×avgLoss
  };
  computedAt: string;        // ISO timestamp
}

// ─── 계산 헬퍼 ───────────────────────────────────────────────────────────────

function getSellFills(trade: ServerShadowTrade): PositionFill[] {
  return (trade.fills ?? []).filter(f => f.type === 'SELL');
}

/** ISO 타임스탬프를 KST 기준 YYYY-MM-DD 문자열로 변환. */
function kstDateString(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

// ─── 핵심 계산 함수 ───────────────────────────────────────────────────────────

/**
 * 모든 섀도우 거래로부터 계좌 전체 상태를 파생한다.
 * currentPrices가 제공되면 미실현 손익을 계산한다.
 *
 * @param trades - loadShadowTrades()의 결과
 * @param startingCapital - 시작 원금 (tradingSettings.startingCapital)
 * @param currentPrices - 종목코드 → 현재가 맵 (선택적)
 */
export function computeShadowAccount(
  trades: ServerShadowTrade[],
  startingCapital: number,
  currentPrices: Record<string, number> = {},
): ShadowAccountState {
  // SHADOW 또는 LIVE 모드 모두 포함 (모드 미설정 포함)
  const relevant = trades.filter(t =>
    ['PENDING', 'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'ACTIVE',
     'REJECTED', 'HIT_TARGET', 'HIT_STOP', 'EUPHORIA_PARTIAL'].includes(t.status)
  );

  // ── 현금 잔고 계산 ──────────────────────────────────────────────
  let cashUsed = 0;   // BUY fill로 지출한 현금 합산
  let cashIn = 0;     // SELL fill로 회수한 현금 합산

  for (const t of relevant) {
    for (const f of (t.fills ?? [])) {
      if (f.type === 'BUY') cashUsed += f.qty * f.price;
      if (f.type === 'SELL') cashIn += f.qty * f.price;
    }
    // fills가 없는 레거시 거래: 최초 진입가로 추정
    if (!t.fills || t.fills.length === 0) {
      cashUsed += t.quantity * t.shadowEntryPrice;
      // 청산된 경우 회수 추정
      if (t.exitPrice && t.status !== 'ACTIVE') {
        cashIn += t.quantity * t.exitPrice;
      }
    }
  }

  const cashBalance = startingCapital - cashUsed + cashIn;

  // ── 활성 포지션 ─────────────────────────────────────────────────
  // 🔑 보유/완결 분류는 fills 기반 잔량을 단일 진실 원천으로 삼는다 (AutoTradePage와 동일 규칙).
  // status 필드만으로 분류하면 (1) status='ACTIVE' 인데 잔량 0 → 빈 포지션 유령 표시,
  // (2) status='HIT_STOP' 인데 잔량 > 0 → 보유분을 잃어버리는 불일치,
  // (3) EUPHORIA_PARTIAL + 잔량 > 0 → 어느 리스트에도 속하지 않는 누락이 발생한다.
  // 레거시(BUY fill 없는) 거래는 getRemainingQty가 trade.quantity로 폴백하므로
  // status가 종결(HIT_TARGET/HIT_STOP)일 때 여기서 제외하여 완결과의 중복을 방지한다.
  const closedTerminalStatuses = new Set(['HIT_TARGET', 'HIT_STOP']);
  const activeTrades = relevant.filter(t => {
    if (t.status === 'REJECTED') return false;
    const fills = t.fills ?? [];
    const hasBuyFill = fills.some(f => f.type === 'BUY');
    if (hasBuyFill) return getRemainingQty(t) > 0;
    return !closedTerminalStatuses.has(t.status); // 레거시: fills 없으면 status로 판정
  });

  const openPositions: ActivePosition[] = activeTrades.map(t => {
    const remainingQty = getRemainingQty(t);
    const entryPrice = t.shadowEntryPrice;
    const investedCash = remainingQty * entryPrice;
    const currentPrice = currentPrices[t.stockCode];
    const unrealizedPnl = currentPrice !== undefined
      ? (currentPrice - entryPrice) * remainingQty
      : undefined;
    const unrealizedPct = currentPrice !== undefined
      ? ((currentPrice / entryPrice) - 1) * 100
      : undefined;

    return {
      tradeId: t.id,
      stockCode: t.stockCode,
      stockName: t.stockName,
      entryPrice,
      remainingQty,
      originalQty: t.originalQuantity ?? t.quantity,
      investedCash,
      stopLoss: t.stopLoss,
      targetPrice: t.targetPrice,
      signalTime: t.signalTime,
      watchlistSource: t.watchlistSource,
      profileType: t.profileType,
      currentPrice,
      unrealizedPnl,
      unrealizedPct,
    };
  });

  // ── 청산 포지션 ─────────────────────────────────────────────────
  // 완결 판정 규칙 (AutoTradePage와 동일 — activeTrades 필터의 여집합):
  // - REJECTED: 주문 자체가 거부 — 완결로 분류 (체결 내역도 없음)
  // - 그 외: fills 기반 잔량이 0 이면 완결. BUY fill이 없는 레거시 거래는
  //   status가 종결 상태(HIT_TARGET/HIT_STOP)일 때만 완결로 인정한다.
  const closedTrades: ClosedTrade[] = relevant
    .filter(t => {
      if (t.status === 'REJECTED') return true;
      const fills = t.fills ?? [];
      const hasBuyFill = fills.some(f => f.type === 'BUY');
      if (hasBuyFill) return getRemainingQty(t) === 0;
      return closedTerminalStatuses.has(t.status); // 레거시: fills 없고 status가 종결
    })
    .map(t => {
      const sells = getSellFills(t);
      const lastSell = sells.length > 0 ? sells[sells.length - 1] : null;
      const totalSoldQty = sells.reduce((s, f) => s + f.qty, 0);
      const realizedPnl = getTotalRealizedPnl(t);
      const weightedPnlPct = getWeightedPnlPct(t);

      return {
        tradeId: t.id,
        stockCode: t.stockCode,
        stockName: t.stockName,
        entryPrice: t.shadowEntryPrice,
        exitPrice: lastSell?.price ?? t.exitPrice,
        originalQty: t.originalQuantity ?? t.quantity,
        totalSoldQty,
        realizedPnl,
        weightedPnlPct,
        closeTime: lastSell?.timestamp ?? t.exitTime,
        exitRuleTag: lastSell?.exitRuleTag ?? t.exitRuleTag,
        fills: t.fills ?? [],
        status: t.status,
      };
    })
    // 최근 청산 순으로 정렬
    .sort((a, b) => {
      const ta = a.closeTime ?? '';
      const tb = b.closeTime ?? '';
      return tb.localeCompare(ta);
    });

  // ── 총자산 / 수익률 ─────────────────────────────────────────────
  const totalInvested = openPositions.reduce((s, p) => s + p.investedCash, 0);
  // 🔑 실현손익은 "완결된 포지션"뿐 아니라 ACTIVE 포지션의 부분청산(PARTIAL_TP /
  // TRAILING_TP / STOP_LOSS 등) SELL fill의 pnl까지 모두 포함해야 한다. 예전에
  // closedTrades만 합산하면 금일 RRR_COLLAPSE_PARTIAL·DIVERGENCE_PARTIAL·
  // EUPHORIA_PARTIAL 등으로 실현된 이익이 "실현손익 +0원"으로 누락된다.
  const totalRealizedPnl = relevant.reduce((s, t) => s + getTotalRealizedPnl(t), 0);
  const totalUnrealizedPnl = openPositions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  // 총자산 = 현금 + 보유 종목 평가액(현재가 기준 or 진입가 기준)
  const portfolioValue = openPositions.reduce((s, p) => {
    if (p.currentPrice !== undefined) return s + p.currentPrice * p.remainingQty;
    return s + p.investedCash;
  }, 0);
  const totalAssets = cashBalance + portfolioValue;
  const returnPct = startingCapital > 0 ? ((totalAssets / startingCapital) - 1) * 100 : 0;

  // ── 통계 ────────────────────────────────────────────────────────
  const wins = closedTrades.filter(t => t.weightedPnlPct > 0);
  const losses = closedTrades.filter(t => t.weightedPnlPct <= 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
  const avgWinPct = winCount > 0
    ? wins.reduce((s, t) => s + t.weightedPnlPct, 0) / winCount
    : 0;
  const avgLossPct = lossCount > 0
    ? losses.reduce((s, t) => s + t.weightedPnlPct, 0) / lossCount
    : 0;
  const lossRate = 100 - winRate;
  const expectancy = (winRate / 100) * avgWinPct + (lossRate / 100) * avgLossPct;

  // ── 오늘(KST) 실현 성과 ─────────────────────────────────────────
  // closedTrades 외에도 부분청산이 일어난 ACTIVE 포지션의 SELL fill까지 포함해야
  // "오늘 발생한 현금흐름"을 정확히 반영한다. relevant 전체를 다시 훑는다.
  const todayKst = kstDateString(new Date());
  let todayRealizedPnl = 0;
  let todaySellFillCount = 0;
  for (const t of relevant) {
    for (const f of (t.fills ?? [])) {
      if (f.type !== 'SELL') continue;
      if (kstDateString(new Date(f.timestamp)) !== todayKst) continue;
      todayRealizedPnl += f.pnl ?? 0;
      todaySellFillCount++;
    }
  }

  return {
    startingCapital,
    cashBalance,
    totalInvested,
    realizedPnl: totalRealizedPnl,
    unrealizedPnl: totalUnrealizedPnl,
    totalAssets,
    returnPct,
    openPositions,
    closedTrades,
    todayRealizedPnl,
    todaySellFillCount,
    stats: {
      totalTrades,
      winCount,
      lossCount,
      winRate,
      avgWinPct,
      avgLossPct,
      expectancy,
    },
    computedAt: new Date().toISOString(),
  };
}

// ─── 월간 실현 거래 통계 (자기학습 카드용) ──────────────────────────────────
/**
 * 당월(KST) SELL fill의 실제 실현 성과를 집계한다.
 *
 * - 부분청산·전량청산 구분 없이 해당 월의 모든 SELL fill을 하나의 "결산 이벤트"로 센다.
 * - 평균 수익률은 요청대로 시작원금(1억원) 기준 — (fill.pnl / startingCapital) × 100.
 * - totalReturnPct는 월간 누적 실현손익의 1억원 대비 비율.
 */
export interface MonthlyShadowTradeStats {
  month: string;                // YYYY-MM (KST)
  startingCapital: number;
  total: number;                // 당월 SELL fill 수 (결산 건수)
  wins: number;
  losses: number;
  winRate: number;              // %
  totalRealizedPnl: number;     // 원화 합계
  totalReturnPct: number;       // Σpnl / startingCapital × 100
  avgReturnPct: number;         // mean(pnl/startingCapital × 100)
}

export function computeMonthlyShadowTradeStats(
  trades?: ServerShadowTrade[],
  startingCapital?: number,
): MonthlyShadowTradeStats {
  const all = trades ?? loadShadowTrades();
  const capital = startingCapital ?? loadTradingSettings().startingCapital;

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const month = kst.toISOString().slice(0, 7); // YYYY-MM

  let total = 0;
  let wins = 0;
  let losses = 0;
  let totalRealizedPnl = 0;

  for (const t of all) {
    for (const f of (t.fills ?? [])) {
      if (f.type !== 'SELL') continue;
      if (f.pnl === undefined) continue;
      const fillMonth = new Date(new Date(f.timestamp).getTime() + 9 * 3_600_000)
        .toISOString().slice(0, 7);
      if (fillMonth !== month) continue;
      total++;
      totalRealizedPnl += f.pnl;
      if (f.pnl > 0) wins++;
      else if (f.pnl < 0) losses++;
    }
  }

  const winRate        = total > 0 ? (wins / total) * 100 : 0;
  const totalReturnPct = capital > 0 ? (totalRealizedPnl / capital) * 100 : 0;
  const avgReturnPct   = total > 0 ? totalReturnPct / total : 0;

  return { month, startingCapital: capital, total, wins, losses, winRate, totalRealizedPnl, totalReturnPct, avgReturnPct };
}

// ─── 재조정 (Reconciler) ──────────────────────────────────────────────────────

export interface ReconcileResult {
  checked: number;
  fixed: number;
  details: { id: string; stockCode: string; before: { qty: number; status: string }; after: { qty: number; status: string } }[];
}

/**
 * 모든 섀도우 거래의 `quantity` 필드를 fills 배열에서 재계산하여 불일치를 교정한다.
 * 서버 시작 시 1회, 그리고 필요 시 수동 호출.
 *
 * 교정 규칙:
 * - BUY fill이 있으면 fill-based 잔량 = Σ(BUY qty) - Σ(SELL qty) 가 진실 원천
 * - fill-based 잔량 === 0 이고 status가 ACTIVE/PARTIALLY_FILLED/EUPHORIA_PARTIAL 이면 → HIT_STOP
 * - fill-based 잔량 > 0 이고 status가 HIT_STOP/HIT_TARGET 이면 → ACTIVE (잘못 닫힌 경우)
 * - BUY fill 없고 PENDING/ACTIVE 이면 → originalQuantity 또는 quantity 유지
 */
export function reconcileShadowQuantities(trades?: ServerShadowTrade[]): ReconcileResult {
  const all = trades ?? loadShadowTrades();
  const result: ReconcileResult = { checked: all.length, fixed: 0, details: [] };

  const openStatuses = new Set(['ACTIVE', 'PARTIALLY_FILLED', 'EUPHORIA_PARTIAL', 'PENDING', 'ORDER_SUBMITTED']);
  const closedStatuses = new Set(['HIT_STOP', 'HIT_TARGET']);

  for (const t of all) {
    const fills = t.fills ?? [];
    const buyFillQty = fills.filter(f => f.type === 'BUY').reduce((s, f) => s + f.qty, 0);
    if (buyFillQty === 0) continue; // fill 없는 레거시 — 건드리지 않음

    const before = { qty: t.quantity, status: t.status };

    // 1) quantity / originalQuantity 파생 동기화 (fills 단일 진실 원천)
    const qtyChanged = syncPositionCache(t);

    // 2) 상태 교정 — reconciler 전용 자동 닫힘 판정
    const shouldBeClosed = t.quantity === 0 && openStatuses.has(t.status);
    const shouldBeOpen   = t.quantity > 0  && closedStatuses.has(t.status); // 잘못 닫힌 경우
    if (shouldBeClosed) {
      const lastSell = fills.filter(f => f.type === 'SELL').sort((a, b) => a.timestamp.localeCompare(b.timestamp)).pop();
      t.status    = 'HIT_STOP';
      t.exitTime  ??= lastSell?.timestamp ?? new Date().toISOString();
      t.exitPrice ??= lastSell?.price;
    }

    const statusChanged = before.status !== t.status;
    if (!qtyChanged && !statusChanged && !shouldBeOpen) continue;

    result.fixed++;
    result.details.push({ id: t.id, stockCode: t.stockCode, before, after: { qty: t.quantity, status: t.status } });
    console.log(`[Reconcile] ${t.stockCode} ${t.stockName}: qty ${before.qty}→${t.quantity}, status ${before.status}→${t.status}`);
  }

  if (result.fixed > 0) {
    saveShadowTrades(all);
    console.log(`[Reconcile] ✅ ${result.fixed}건 교정 완료`);
  } else {
    console.log(`[Reconcile] ✅ ${result.checked}건 이상 없음`);
  }

  return result;
}
