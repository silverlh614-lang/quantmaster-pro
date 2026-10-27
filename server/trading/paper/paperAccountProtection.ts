// @responsibility Replay the virtual account's recorded fills under alternative protection rules, for research only.
import { createHash } from 'node:crypto';
import { paperAccountWeightPct, type PaperAccountLedger } from '../../../src/types/paperAccount.js';
import type { PaperCostModel } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';

export interface PaperProtectionRule {
  key: string; label: string;
  /** Share of equity the account may hold at once; 100 is the current rule. */
  investedCapPct: number;
  /** Stop new buys once equity falls this far below its peak, until the given trading day after the fall. */
  brake?: { drawdownPct: number; pauseTradingDays: number };
}
/** Fixed comparison set chosen with the user on 2026-10-27; the live account rules stay unchanged (option A). */
export const PAPER_PROTECTION_RULES: readonly PaperProtectionRule[] = [
  { key: 'CURRENT', label: '현행(다시 계산)', investedCapPct: 100 },
  { key: 'CAP_70', label: '투자 상한 70%', investedCapPct: 70 },
  { key: 'CAP_50', label: '투자 상한 50%', investedCapPct: 50 },
  { key: 'BRAKE_7', label: '손실 브레이크 −7%·5거래일', investedCapPct: 100, brake: { drawdownPct: 7, pauseTradingDays: 5 } },
  { key: 'BRAKE_10', label: '손실 브레이크 −10%·5거래일', investedCapPct: 100, brake: { drawdownPct: 10, pauseTradingDays: 5 } },
];
export interface PaperProtectionResult {
  key: string; label: string; returnPct: number; maxDrawdownPct: number;
  buyCount: number; pausedSkips: number; brakeCount: number;
}
export interface PaperProtectionStudy {
  asOf: string; since: string; candidateCount: number;
  /** Signals the account refused only for its holding limit; their prices come from the strategy record. */
  estimatedCount: number; results: PaperProtectionResult[];
}

interface Candidate {
  tradeId: string; symbol: string; at: string; rank: string; unitCost: number;
  exitAt: string | null; unitProceeds: number | null;
}
const SLOT_LIMIT_REASON = '동시 보유 한도';
const unitBuy = (price: number, cost: PaperCostModel) => price * (1 + cost.slippageRate) + price * cost.buyFeeRate;
const unitSell = (price: number, cost: PaperCostModel) =>
  price * (1 - cost.slippageRate) - price * cost.sellFeeRate - price * cost.sellTaxRate;

/** The Nth KRX trading day after `date`; buys resume on that day. */
function tradingDayAfter(date: string, count: number): string {
  const day = new Date(`${date}T12:00:00+09:00`);
  for (let left = count, guard = 0; left > 0 && guard < 60; guard++) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (isKrxTradingDay(toKstDateKey(day))) left--;
  }
  return toKstDateKey(day);
}

/**
 * Every buy the account made, plus every validated signal it refused only because its holding slots were full.
 * Filled orders use their own fills; refused ones use the strategy record's entry, exit or latest observed price.
 */
function accountCandidates(account: PaperAccountLedger, trades: ReadonlyMap<string, PaperStrategyTrade>) {
  const sells = new Map(account.orders.filter(order => order.side === 'SELL' && order.fill).map(order => [order.tradeId, order]));
  const candidates: Candidate[] = [];
  let estimated = 0;
  for (const order of account.orders) {
    if (order.side !== 'BUY') continue;
    const rank = createHash('sha256').update(`${toKstDateKey(order.submittedAt)}:${order.symbol}`).digest('hex');
    if (order.status === 'FILLED' && order.fill) {
      const sell = sells.get(order.tradeId)?.fill, mark = account.marks[order.tradeId];
      candidates.push({ tradeId: order.tradeId, symbol: order.symbol, at: order.submittedAt, rank, unitCost: -order.fill.cashDelta / order.fill.quantity,
        exitAt: sell?.at ?? null, unitProceeds: sell ? sell.cashDelta / sell.quantity : mark ? unitSell(mark.price, order.costModel) : null });
      continue;
    }
    const trade = trades.get(order.tradeId);
    if (order.status !== 'REJECTED' || !order.statusReason.startsWith(SLOT_LIMIT_REASON) || !trade) continue;
    const latest = trade.exit?.price ?? trade.measurement?.latest.price;
    candidates.push({ tradeId: order.tradeId, symbol: order.symbol, at: order.submittedAt, rank, unitCost: unitBuy(trade.entryPrice, order.costModel),
      exitAt: trade.exit?.decisionAt ?? null, unitProceeds: latest ? unitSell(latest, order.costModel) : null });
    estimated++;
  }
  candidates.sort((a, b) => a.at.localeCompare(b.at) || a.rank.localeCompare(b.rank));
  return { candidates, estimated };
}

/**
 * Sizing follows the live rule (equity × weight, capped by cash) but values open holdings at their purchase cost,
 * since no mark history is stored; the brake therefore reacts to realized losses. Exits release cash first.
 */
function replay(account: PaperAccountLedger, candidates: readonly Candidate[], rule: PaperProtectionRule, asOf: string): PaperProtectionResult {
  let cash = account.config.initialCash, peak = cash, maxDrawdownPct = 0;
  let buyCount = 0, pausedSkips = 0, brakeCount = 0;
  // Held in an object: `observe` sets it from inside a closure, which plain narrowing would not see.
  const pause: { resumeDate: string | null } = { resumeDate: null };
  const held = new Map<string, { quantity: number; unitCost: number; candidate: Candidate }>();
  const equityAtCost = () => cash + [...held.values()].reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const observe = (at: string) => {
    const equity = equityAtCost();
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? (peak - equity) / peak * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
    if (rule.brake && pause.resumeDate === null && drawdown >= rule.brake.drawdownPct) {
      pause.resumeDate = tradingDayAfter(toKstDateKey(at), rule.brake.pauseTradingDays); brakeCount++;
    }
  };
  const settleThrough = (at: string) => {
    const due = [...held.entries()].filter(([, item]) => item.candidate.exitAt !== null && item.candidate.exitAt <= at)
      .sort(([, a], [, b]) => a.candidate.exitAt!.localeCompare(b.candidate.exitAt!));
    for (const [tradeId, item] of due) {
      cash += item.quantity * (item.candidate.unitProceeds ?? item.unitCost);
      held.delete(tradeId);
      observe(item.candidate.exitAt!);
    }
  };
  for (const candidate of candidates) {
    settleThrough(candidate.at);
    if (pause.resumeDate !== null) {
      if (toKstDateKey(candidate.at) < pause.resumeDate) { pausedSkips++; continue; }
      // A resumed account measures later falls from where it restarted.
      pause.resumeDate = null; peak = equityAtCost();
    }
    const weight = paperAccountWeightPct(account, candidate.at);
    const slots = Math.max(1, Math.floor(Math.min(rule.investedCapPct, 100) / weight + 1e-9));
    // The live account never holds the same stock twice.
    if (held.size >= slots || [...held.values()].some(item => item.candidate.symbol === candidate.symbol)) continue;
    const budget = Math.floor(Math.min(equityAtCost() * weight / 100, cash) * 100) / 100;
    const quantity = Math.floor(budget / candidate.unitCost);
    if (quantity <= 0) continue;
    cash -= quantity * candidate.unitCost;
    held.set(candidate.tradeId, { quantity, unitCost: candidate.unitCost, candidate });
    buyCount++;
  }
  settleThrough(asOf);
  const equity = cash + [...held.values()].reduce((sum, item) => sum + item.quantity * (item.candidate.unitProceeds ?? item.unitCost), 0);
  maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (peak - equity) / peak * 100 : 0);
  return { key: rule.key, label: rule.label, returnPct: (equity / account.config.initialCash - 1) * 100,
    maxDrawdownPct, buyCount, pausedSkips, brakeCount };
}

/** Research only: the live account keeps its own rules, and nothing here is written back. */
export function studyPaperAccountProtection(account: PaperAccountLedger, trades: readonly PaperStrategyTrade[], asOf: string,
  rules: readonly PaperProtectionRule[] = PAPER_PROTECTION_RULES): PaperProtectionStudy {
  const { candidates, estimated } = accountCandidates(account, new Map(trades.map(trade => [trade.id, trade])));
  return { asOf, since: account.startedAt, candidateCount: candidates.length, estimatedCount: estimated,
    results: rules.map(rule => replay(account, candidates, rule, asOf)) };
}
