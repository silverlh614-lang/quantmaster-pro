import { ServerShadowTrade, PositionFill, loadShadowTrades, saveShadowTrades } from './shadowTradeRepo.js';

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

function getBuyFills(trade: ServerShadowTrade): PositionFill[] {
  return (trade.fills ?? []).filter(f => f.type === 'BUY');
}

function getSellFills(trade: ServerShadowTrade): PositionFill[] {
  return (trade.fills ?? []).filter(f => f.type === 'SELL');
}

function calcRemainingQty(trade: ServerShadowTrade): number {
  const bought = getBuyFills(trade).reduce((s, f) => s + f.qty, 0);
  const sold = getSellFills(trade).reduce((s, f) => s + f.qty, 0);
  // fills가 없으면 trade.quantity 사용
  if (bought === 0) return trade.quantity ?? 0;
  return Math.max(0, bought - sold);
}

function calcWeightedPnlPct(trade: ServerShadowTrade): number {
  const sells = getSellFills(trade).filter(f => f.pnlPct !== undefined);
  if (sells.length === 0) return trade.returnPct ?? 0;
  const totalQty = sells.reduce((s, f) => s + f.qty, 0);
  if (totalQty === 0) return 0;
  return sells.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty;
}

function calcRealizedPnl(trade: ServerShadowTrade): number {
  return getSellFills(trade)
    .filter(f => f.pnl !== undefined)
    .reduce((s, f) => s + (f.pnl ?? 0), 0);
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
  const activeStatuses = new Set(['ACTIVE', 'PARTIALLY_FILLED', 'ORDER_SUBMITTED', 'PENDING']);
  const activeTrades = relevant.filter(t => activeStatuses.has(t.status));

  const openPositions: ActivePosition[] = activeTrades.map(t => {
    const remainingQty = calcRemainingQty(t);
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
  const closedStatuses = new Set(['HIT_TARGET', 'HIT_STOP', 'REJECTED']);
  // EUPHORIA_PARTIAL은 부분 청산 상태이므로 활성으로 분류하되
  // 전량 청산된 경우(remainingQty === 0)만 closed로 처리
  const closedTrades: ClosedTrade[] = relevant
    .filter(t => {
      if (closedStatuses.has(t.status)) return true;
      if (t.status === 'EUPHORIA_PARTIAL') return calcRemainingQty(t) === 0;
      return false;
    })
    .map(t => {
      const sells = getSellFills(t);
      const lastSell = sells.length > 0 ? sells[sells.length - 1] : null;
      const totalSoldQty = sells.reduce((s, f) => s + f.qty, 0);
      const realizedPnl = calcRealizedPnl(t);
      const weightedPnlPct = calcWeightedPnlPct(t);

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
  const totalRealizedPnl = closedTrades.reduce((s, t) => s + t.realizedPnl, 0);
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

  for (const t of all) {
    const fills = t.fills ?? [];
    const buyFillQty  = fills.filter(f => f.type === 'BUY').reduce((s, f) => s + f.qty, 0);
    const sellFillQty = fills.filter(f => f.type === 'SELL').reduce((s, f) => s + f.qty, 0);

    if (buyFillQty === 0) continue; // fill 없는 레거시 — 건드리지 않음

    const fillBasedQty = Math.max(0, buyFillQty - sellFillQty);
    const openStatuses = new Set(['ACTIVE', 'PARTIALLY_FILLED', 'EUPHORIA_PARTIAL', 'PENDING', 'ORDER_SUBMITTED']);
    const closedStatuses = new Set(['HIT_STOP', 'HIT_TARGET']);

    const qtyChanged = fillBasedQty !== t.quantity;
    const shouldBeClosed = fillBasedQty === 0 && openStatuses.has(t.status);
    const shouldBeOpen   = fillBasedQty > 0  && closedStatuses.has(t.status); // 잘못 닫힌 경우

    if (!qtyChanged && !shouldBeClosed && !shouldBeOpen) continue;

    const before = { qty: t.quantity, status: t.status };

    // 수량 교정
    if (qtyChanged) t.quantity = fillBasedQty;

    // originalQuantity 보장 (한 번도 설정 안 된 경우)
    if (!t.originalQuantity) t.originalQuantity = buyFillQty;

    // 상태 교정
    if (shouldBeClosed) {
      const lastSell = fills.filter(f => f.type === 'SELL').sort((a, b) => a.timestamp.localeCompare(b.timestamp)).pop();
      t.status    = 'HIT_STOP';
      t.exitTime  ??= lastSell?.timestamp ?? new Date().toISOString();
      t.exitPrice ??= lastSell?.price;
    }

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
