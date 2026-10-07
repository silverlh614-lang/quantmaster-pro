// @responsibility Execute cash-constrained virtual orders from frozen Shadow signals.
import type { PaperAccountConfig, PaperAccountFill, PaperAccountLedger, PaperAccountOrder, PaperAccountQuote, PaperAccountView } from '../../../src/types/paperAccount.js';
import type { PaperCostModel, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger, PaperStrategyTrade } from '../../../src/types/paperStrategy.js';
import { tradeSignalIdentity } from '../../../src/utils/paperTradeReview.js';
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { accountEntryRefusal, isAccountRuleSignal, selectAccountPolicy } from './paperAccountSelection.js';

export const ACCOUNT_QUOTE_MAX_AGE_MS = 120_000;
/** Without orders, marks or policy changes, the processed time is still persisted at this interval. */
export const ACCOUNT_IDLE_SAVE_MS = 5 * 60_000;
const money = (value: number) => Math.round(value * 100) / 100;
export function assertAccountConfig(value: unknown): asserts value is PaperAccountConfig {
  const config = value as PaperAccountConfig | null;
  if (!config || !Number.isSafeInteger(config.initialCash) || config.initialCash < 1000 || config.initialCash > 1e12
    || !Number.isFinite(config.maxPositionPct) || config.maxPositionPct < 1 || config.maxPositionPct > 100
    || typeof config.includeExploration !== 'boolean') throw new Error('예수금은 1천~1조 원의 정수, 종목 비중은 1~100%, 탐색 포함은 참/거짓이어야 합니다.');
}
export function createPaperAccount(config: PaperAccountConfig, at: string, id: string): PaperAccountLedger {
  assertAccountConfig(config);
  if (!Number.isFinite(Date.parse(at)) || !id) throw new Error('계좌 시작 정보가 올바르지 않습니다.');
  return { version: 'virtual-account-v1', id, startedAt: at,
    config: { initialCash: config.initialCash, maxPositionPct: config.maxPositionPct, includeExploration: config.includeExploration }, buyPaused: false,
    controls: [], lastSnapshotAt: null, orders: [], marks: {},
    risk: { since: at, updatedAt: at, observations: 1, peakEquity: config.initialCash, maxDrawdownPct: 0 } };
}
/** Fee bases match the frozen signal cost model; slippage changes the simulated fill price. */
export function accountFill(side: 'BUY' | 'SELL', quantity: number, quote: PaperAccountQuote, cost: PaperCostModel, at: string, id: string): PaperAccountFill {
  const price = quote.price * (1 + (side === 'BUY' ? cost.slippageRate : -cost.slippageRate));
  const grossAmount = money(price * quantity);
  const fee = money(quote.price * quantity * (side === 'BUY' ? cost.buyFeeRate : cost.sellFeeRate));
  const tax = side === 'SELL' ? money(quote.price * quantity * cost.sellTaxRate) : 0;
  return { id, at, snapshotId: quote.snapshotId, quote: { ...quote }, quantity, price, grossAmount, fee, tax,
    cashDelta: money(side === 'BUY' ? -grossAmount - fee : grossAmount - fee - tax) };
}
export function accountBalances(account: PaperAccountLedger) {
  let cash = account.config.initialCash, realizedPnl = 0;
  const buys = new Map<string, PaperAccountOrder>();
  for (const order of account.orders) {
    if (!order.fill) continue;
    cash = money(cash + order.fill.cashDelta);
    if (order.side === 'BUY') buys.set(order.tradeId, order);
    else {
      const buy = buys.get(order.tradeId);
      if (!buy?.fill || buy.quantity !== order.quantity) throw new Error('가상 계좌 체결 수량 대사 불일치');
      realizedPnl = money(realizedPnl + buy.fill.cashDelta + order.fill.cashDelta);
      buys.delete(order.tradeId);
    }
  }
  return { cash, realizedPnl, buys };
}
export function buildPaperAccountView(account: PaperAccountLedger | null, asOf: string, error?: string): PaperAccountView {
  if (!account) return { account, asOf, ...(error ? { error } : {}), cash: null, realizedPnl: null,
    unrealizedPnl: null, equity: null, returnPct: null, positions: [] };
  const { cash, realizedPnl, buys } = accountBalances(account);
  const positions = [...buys.values()].map(order => {
    const mark = account.marks[order.tradeId] ?? null;
    const stale = !mark || Date.parse(asOf) - Date.parse(mark.observedAt) > ACCOUNT_QUOTE_MAX_AGE_MS || Date.parse(mark.observedAt) > Date.parse(asOf);
    const liquidationValue = mark ? accountFill('SELL', order.quantity, mark, order.costModel, asOf, '').cashDelta : null;
    return { tradeId: order.tradeId, symbol: order.symbol, name: order.name, quantity: order.quantity,
      entryCost: -order.fill!.cashDelta, mark, stale, liquidationValue,
      unrealizedPnl: liquidationValue === null ? null : money(liquidationValue + order.fill!.cashDelta) };
  });
  const complete = positions.every(position => position.liquidationValue !== null);
  const equity = complete ? money(cash + positions.reduce((sum, position) => sum + position.liquidationValue!, 0)) : null;
  return { account, asOf, ...(error ? { error } : {}), cash, realizedPnl, positions, equity,
    unrealizedPnl: complete ? money(positions.reduce((sum, position) => sum + position.unrealizedPnl!, 0)) : null,
    returnPct: equity === null ? null : (equity / account.config.initialCash - 1) * 100 };
}
function assessQuote(snapshot: PaperSnapshot, symbol: string, notBefore?: string): { quote: PaperAccountQuote | null; refusal: string | null } {
  const observation = snapshot.observations.find(item => item.symbol === symbol);
  const age = Date.parse(snapshot.asOf) - Date.parse(observation?.observedAt ?? '');
  let refusal: string | null = null;
  if (!snapshot.marketOpen || !isKrxTradingDay(snapshot.tradingDate)) refusal = '정규장 실측 가격 대기';
  else if (!observation) refusal = '해당 종목 가격 관측 없음';
  else if (observation.issue) refusal = `가격 수집 오류: ${observation.issue}`;
  else if (!['KIS', 'KIS_REST_REQUEST_OBSERVED', 'KRX'].includes(observation.source)) refusal = '체결에 사용할 수 없는 가격 출처';
  else if (!Number.isFinite(observation.price) || observation.price! <= 0) refusal = '유효한 현재가 없음';
  else if (!Number.isFinite(age) || age < 0) refusal = '가격 관측 시각 오류 또는 미래 시각';
  else if (toKstDateKey(new Date(snapshot.asOf)) !== snapshot.tradingDate
    || toKstDateKey(new Date(observation.observedAt)) !== snapshot.tradingDate) refusal = '당일 거래일 가격 아님';
  else if (notBefore && Date.parse(observation.observedAt) < Date.parse(notBefore)) refusal = '계좌 시작 이전에 수집한 가격';
  else if (age > ACCOUNT_QUOTE_MAX_AGE_MS) refusal = `가격 유효시간 초과 · ${Math.ceil(age / 1000)}초 전 관측 (허용 ${ACCOUNT_QUOTE_MAX_AGE_MS / 1000}초) · 관측 ${observation.observedAt}`;
  return { refusal, quote: refusal ? null : { price: observation!.price!, observedAt: observation!.observedAt,
    source: observation!.source, snapshotId: snapshot.id } };
}
function orderFor(trade: PaperStrategyTrade, side: 'BUY' | 'SELL', snapshot: PaperSnapshot): PaperAccountOrder {
  const identity = tradeSignalIdentity(trade);
  return { id: `${trade.id}:${side}`, tradeId: trade.id, symbol: trade.symbol, name: trade.name, side,
    signalAt: side === 'BUY' ? trade.entryAt : trade.exit!.decisionAt, submittedAt: snapshot.asOf, updatedAt: snapshot.asOf,
    signalSnapshotId: side === 'BUY' ? trade.entrySnapshotId : trade.exit!.snapshotId,
    signalReason: side === 'BUY' ? trade.entryDecision.reason : trade.exit!.decision.reason,
    signalLabel: identity.label, purpose: identity.purpose === 'EXPLORATION' ? 'EXPLORATION' : 'VALIDATED',
    costModel: { ...trade.costModel }, quantity: 0, budget: 0, status: 'PENDING', statusReason: '유효한 새 장중 가격 대기', fill: null };
}
function countSkippedSignal(account: PaperAccountLedger, trade: PaperStrategyTrade, reason: string): void {
  const skipped = account.skippedSignals ??= { through: trade.entryAt, counts: {} };
  const day = skipped.counts[trade.tradingDate] ??= {};
  day[reason] = (day[reason] ?? 0) + 1;
}
function materialState(account: PaperAccountLedger): string {
  const { lastSnapshotAt: _processedAt, risk, ...rest } = account;
  return JSON.stringify({ ...rest, risk: risk && { since: risk.since, peakEquity: risk.peakEquity, maxDrawdownPct: risk.maxDrawdownPct } });
}
/** The processed time and evaluation count alone do not rewrite the ledger on every quote batch. */
export function accountNeedsSave(prior: PaperAccountLedger, next: PaperAccountLedger): boolean {
  if (next === prior) return false;
  if (!prior.lastSnapshotAt || !next.lastSnapshotAt) return true;
  return Date.parse(next.lastSnapshotAt) - Date.parse(prior.lastSnapshotAt) >= ACCOUNT_IDLE_SAVE_MS
    || materialState(prior) !== materialState(next);
}
function completeOrder(order: PaperAccountOrder, quote: PaperAccountQuote, at: string): void {
  order.fill = accountFill(order.side, order.quantity, quote, order.costModel, at, `${order.id}:fill`);
  order.status = 'FILLED'; order.statusReason = '관측 현재가에 슬리피지·비용을 반영한 가상 체결'; order.updatedAt = at;
}
/** One synchronous transition is persisted atomically. No provider or broker calls, no historic fills. */
export function advancePaperAccount(current: PaperAccountLedger, strategy: PaperStrategyLedger, snapshot: PaperSnapshot): PaperAccountLedger {
  const now = Date.parse(snapshot.asOf);
  if (!Number.isFinite(now) || now < Date.parse(current.startedAt) || current.lastSnapshotAt && now <= Date.parse(current.lastSnapshotAt)) return current;
  const account = structuredClone(current);
  const selection = selectAccountPolicy(account, strategy.adaptive, snapshot);
  const signals = new Map(strategy.trades.map(trade => [trade.id, trade]));
  const orders = new Map(account.orders.map(order => [order.id, order]));
  // Exits release cash before new signals compete for the remaining budget.
  for (const buy of accountBalances(account).buys.values()) {
    const { quote } = assessQuote(snapshot, buy.symbol);
    if (quote && Date.parse(quote.observedAt) >= Date.parse(account.marks[buy.tradeId]?.observedAt ?? buy.fill!.quote.observedAt)) account.marks[buy.tradeId] = quote;
    const trade = signals.get(buy.tradeId);
    if (!trade?.exit || Date.parse(trade.exit.decisionAt) > now) continue;
    let sell = orders.get(`${buy.tradeId}:SELL`);
    if (!sell) { sell = orderFor(trade, 'SELL', snapshot); sell.quantity = buy.quantity; account.orders.push(sell); orders.set(sell.id, sell); }
    if (sell.status === 'PENDING' && quote && Date.parse(quote.observedAt) >= Date.parse(trade.exit.observedAt)) {
      completeOrder(sell, quote, snapshot.asOf); delete account.marks[buy.tradeId];
    }
  }
  // Full scans run one at a time and stamp new signals with their own time, so this watermark never skips one.
  const handledThrough = Date.parse(account.skippedSignals?.through ?? '');
  const entries = strategy.trades.filter(trade => trade.strategyVersion === 'adaptive-features-v1'
    && Date.parse(trade.entryAt) >= Date.parse(account.startedAt) && Date.parse(trade.entryAt) <= now
    && !(Date.parse(trade.entryAt) <= handledThrough) && !orders.has(`${trade.id}:BUY`)).sort((a, b) => a.entryAt.localeCompare(b.entryAt)
      || Number(!!a.entryDecision.explorationEvidence) - Number(!!b.entryDecision.explorationEvidence) || a.symbol.localeCompare(b.symbol));
  for (const trade of entries) {
    const ruleRefusal = accountEntryRefusal(trade, selection);
    if (!isAccountRuleSignal(trade, selection)) { countSkippedSignal(account, trade, ruleRefusal); continue; }
    const order = orderFor(trade, 'BUY', snapshot);
    account.orders.push(order); orders.set(order.id, order);
    if (selection) order.selectionId = selection.id;
    let refusal = account.buyPaused ? '계좌 신규 매수 일시정지' : ruleRefusal;
    if (trade.entrySnapshotId !== snapshot.id || trade.status !== 'OPEN') {
      order.status = 'EXPIRED'; order.statusReason = '신호 발생 시점 처리 누락 · 과거 가격 소급 체결 금지'; continue;
    }
    const balances = accountBalances(account), checkedQuote = assessQuote(snapshot, trade.symbol, account.startedAt);
    if ([...balances.buys.values()].some(buy => buy.symbol === trade.symbol)
      || account.orders.some(prior => prior !== order && prior.side === 'BUY' && prior.status === 'PENDING' && prior.symbol === trade.symbol)) refusal = '동일 종목 보유 중';
    refusal = refusal || checkedQuote.refusal || '';
    if (refusal) { order.status = 'REJECTED'; order.statusReason = refusal; continue; }
    // Executable signals are collected before allocating cash, avoiding ticker-order concentration.
  }
  const latestEntry = entries.reduce<string | undefined>((latest, trade) =>
    !latest || Date.parse(trade.entryAt) > Date.parse(latest) ? trade.entryAt : latest, undefined);
  if (account.skippedSignals && latestEntry && Date.parse(latestEntry) > Date.parse(account.skippedSignals.through)) {
    account.skippedSignals.through = latestEntry;
  }
  const candidates = account.orders.filter(order => order.side === 'BUY' && order.status === 'PENDING');
  const balances = accountBalances(account), equity = buildPaperAccountView(account, snapshot.asOf).equity;
  const budget = candidates.length ? Math.floor(Math.min(balances.cash / candidates.length, (equity ?? 0) * account.config.maxPositionPct / 100) * 100) / 100 : 0;
  for (const order of candidates) {
    const quote = assessQuote(snapshot, order.symbol, account.startedAt).quote!;
    order.budget = budget;
    const unit = quote!.price * (1 + order.costModel.slippageRate + order.costModel.buyFeeRate);
    order.quantity = Math.max(0, Math.floor(order.budget / unit));
    while (order.quantity > 0 && -accountFill('BUY', order.quantity, quote!, order.costModel, snapshot.asOf, '').cashDelta > order.budget) order.quantity--;
    if (!order.quantity) { order.status = 'REJECTED'; order.statusReason = '현금 또는 종목 비중 한도로 1주 매수 불가'; continue; }
    completeOrder(order, quote!, snapshot.asOf); account.marks[order.tradeId] = quote!;
  }
  account.lastSnapshotAt = snapshot.asOf;
  const view = buildPaperAccountView(account, snapshot.asOf);
  if (view.equity !== null && !view.positions.some(position => position.stale)) {
    const prior = account.risk;
    const peakEquity = Math.max(prior?.peakEquity ?? view.equity, view.equity);
    account.risk = { since: prior?.since ?? snapshot.asOf, updatedAt: snapshot.asOf,
      observations: (prior?.observations ?? 0) + 1, peakEquity,
      maxDrawdownPct: Math.max(prior?.maxDrawdownPct ?? 0, peakEquity ? (peakEquity - view.equity) / peakEquity * 100 : 0) };
  }
  return account;
}
