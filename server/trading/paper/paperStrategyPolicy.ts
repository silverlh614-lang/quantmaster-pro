// @responsibility Execute empirical Shadow strategy decisions.
import type { PaperCostModel, PaperExperiment, PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type {
  PaperStrategyDecision, PaperStrategyEvidence, PaperStrategyLedger, PaperStrategyReasonCode,
  PaperStrategyTrade, PaperStrategyView,
} from '../../../src/types/paperStrategy.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import type { HistoricalPaperSample } from '../../../src/types/paperResearch.js';
import { buildPaperStrategyEvidence, PAPER_STRATEGY_POLICY, paperStrategyCohort, scheduledPaperClose } from './paperStrategyEvidence.js';

function decision(
  snapshot: PaperSnapshot, observation: Pick<PaperObservation, 'symbol' | 'name'>,
  action: PaperStrategyDecision['action'], reasonCode: PaperStrategyReasonCode, reason: string,
  evidence: PaperStrategyEvidence | null = null, tradeId: string | null = null,
): PaperStrategyDecision {
  return { snapshotId: snapshot.id, decisionAt: snapshot.asOf, symbol: observation.symbol, name: observation.name,
    action, reasonCode, reason, cohort: evidence?.cohort ?? null, evidence, tradeId };
}

function entryDecision(snapshot: PaperSnapshot, observation: PaperObservation, experiments: PaperExperiment[], historical: HistoricalPaperSample[]): PaperStrategyDecision {
  const wait = (code: PaperStrategyReasonCode, reason: string, evidence: PaperStrategyEvidence | null = null) =>
    decision(snapshot, observation, 'WAIT', code, reason, evidence);
  const now = Date.parse(snapshot.asOf);
  const observed = Date.parse(observation.observedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now
    || toKstDateKey(new Date(now)) !== snapshot.tradingDate || toKstDateKey(new Date(observed)) !== snapshot.tradingDate) {
    return wait('OBSERVATION_TIME_INVALID', '현재 관측 시각을 확인할 수 없어 진입 대기');
  }
  if (!snapshot.marketOpen || !isKrxTradingDay(snapshot.tradingDate)) return wait('MARKET_CLOSED', '장중 가격 관측까지 진입 대기');
  if (observation.price === null || !Number.isFinite(observation.price) || observation.price <= 0 || observation.issue) {
    return wait('CURRENT_PRICE_UNAVAILABLE', '유효한 현재가를 확인할 수 없어 진입 대기');
  }
  const cohort = paperStrategyCohort(observation, snapshot.asOf);
  if (!cohort) return wait('TREND_UNKNOWN', '20일선 위치를 확인할 수 없어 진입 대기');
  const evidence = buildPaperStrategyEvidence(experiments, cohort, snapshot.asOf, PAPER_STRATEGY_POLICY, historical);
  if (evidence.sampleCount < PAPER_STRATEGY_POLICY.minimumSamples) {
    return wait('INSUFFICIENT_MATURE_SAMPLES', `동일 뉴스·추세의 성숙 표본 ${evidence.sampleCount}/${PAPER_STRATEGY_POLICY.minimumSamples}건으로 진입 대기`, evidence);
  }
  if (evidence.entryDateCount < PAPER_STRATEGY_POLICY.minimumEntryDates) {
    return wait('INSUFFICIENT_ENTRY_DATES', `표본의 진입일 ${evidence.entryDateCount}/${PAPER_STRATEGY_POLICY.minimumEntryDates}개로 진입 대기`, evidence);
  }
  const best = evidence.horizons.find((item) => item.horizon === evidence.selectedHorizon)!;
  if (!(best.meanNetReturnPct !== null && best.meanNetReturnPct > 0)) {
    return wait('NON_POSITIVE_EXPECTANCY', '동일 뉴스·추세의 비용 차감 후 평균 성과가 양수가 아니므로 진입 대기', evidence);
  }
  return decision(snapshot, observation, 'BUY', 'POSITIVE_COHORT_EXPECTANCY',
    `동일 뉴스·추세 ${evidence.sampleCount}건·${evidence.entryDateCount}개 진입일: D${best.horizon} 평균 순수익률 ${best.meanNetReturnPct.toFixed(2)}%, 거래일당 평균 성과가 가장 높아 1주 진입`, evidence);
}

function closeDecision(trade: PaperStrategyTrade, snapshot: PaperSnapshot, observation?: PaperObservation): PaperStrategyDecision {
  const evidence = trade.entryDecision.evidence;
  if (!(Date.parse(snapshot.asOf) >= Date.parse(trade.scheduledExitAt))) {
    return decision(snapshot, trade, 'HOLD', 'HORIZON_PENDING', `${trade.scheduledExitDate} 종가 청산 예정 · 진입 시 확정한 D${trade.horizon}까지 보유`, evidence, trade.id);
  }
  const close = observation?.dailyCloses.find((item) => item.tradingDate === trade.scheduledExitDate
    && Number.isFinite(item.close) && item.close > 0
    && Date.parse(item.availableAt) >= Date.parse(trade.scheduledExitAt)
    && Date.parse(item.availableAt) <= Date.parse(snapshot.asOf));
  if (!close) return decision(snapshot, trade, 'HOLD', 'SCHEDULED_CLOSE_UNAVAILABLE',
    `${trade.scheduledExitDate}의 확정 종가가 없어 청산 평가 대기`, evidence, trade.id);
  const exit = decision(snapshot, trade, 'EXIT', 'SCHEDULED_CLOSE_REACHED',
    `진입 시 확정한 D${trade.horizon}(${trade.scheduledExitDate}) 종가 ${close.close.toLocaleString('ko-KR')}원으로 가상 청산`, evidence, trade.id);
  trade.status = 'CLOSED';
  trade.exit = { model: 'SCHEDULED_CLOSE', snapshotId: snapshot.id, effectiveAt: trade.scheduledExitAt,
    observedAt: close.availableAt, decisionAt: snapshot.asOf, price: close.close, decision: structuredClone(exit),
    ...calculatePaperReturn(trade.entryPrice, close.close, trade.costModel) };
  return exit;
}

export function evaluatePaperStrategyScan(
  input: PaperStrategyLedger, experiments: PaperExperiment[], snapshot: PaperSnapshot,
  costForSymbol: (symbol: string) => PaperCostModel,
  historical: HistoricalPaperSample[] = [],
): PaperStrategyLedger {
  const ledger = structuredClone(input);
  const observations = new Map(snapshot.observations.map((item) => [item.symbol, item]));
  const decisions: PaperStrategyDecision[] = [];
  const handled = new Set<string>();
  for (const trade of ledger.trades.filter((item) => item.status === 'OPEN')) {
    decisions.push(closeDecision(trade, snapshot, observations.get(trade.symbol)));
    handled.add(trade.symbol);
  }
  for (const observation of observations.values()) {
    if (handled.has(observation.symbol)) continue;
    const today = ledger.trades.find((item) => item.symbol === observation.symbol && item.tradingDate === snapshot.tradingDate);
    if (today) {
      decisions.push(decision(snapshot, observation, 'WAIT', 'ALREADY_ENTERED_TODAY', '오늘 이미 진입한 종목으로 중복 진입 대기', null, today.id));
      continue;
    }
    const result = entryDecision(snapshot, observation, experiments, historical);
    if (result.action === 'BUY' && result.evidence?.selectedHorizon) {
      const horizon = result.evidence.selectedHorizon;
      const scheduledExitDate = addBusinessDaysFromKstDate(snapshot.tradingDate, horizon);
      result.tradeId = `${PAPER_STRATEGY_POLICY.version}:${snapshot.tradingDate}:${observation.symbol}`;
      const cutoff = Date.parse(snapshot.asOf);
      ledger.trades.push({
        id: result.tradeId, strategyVersion: PAPER_STRATEGY_POLICY.version, symbol: observation.symbol, name: observation.name,
        status: 'OPEN', entrySnapshotId: snapshot.id, entryAt: snapshot.asOf, tradingDate: snapshot.tradingDate,
        entryPrice: observation.price!, quantity: 1,
        entryObservation: structuredClone({ ...observation,
          news: observation.news.filter((item) => Date.parse(item.observedAt) <= cutoff),
          dailyCloses: observation.dailyCloses.filter((item) => Date.parse(item.availableAt) <= cutoff) }),
        entryDecision: structuredClone(result), policy: { ...PAPER_STRATEGY_POLICY }, costModel: { ...costForSymbol(observation.symbol) },
        horizon, scheduledExitDate, scheduledExitAt: scheduledPaperClose(scheduledExitDate), exit: null,
      });
    }
    decisions.push(result);
  }
  ledger.latestDecisions = decisions;
  ledger.lastRun = { snapshotId: snapshot.id, asOf: snapshot.asOf,
    openedCount: decisions.filter((item) => item.action === 'BUY').length,
    closedCount: decisions.filter((item) => item.action === 'EXIT').length,
    waitingCount: decisions.filter((item) => item.action === 'WAIT').length,
    holdingCount: decisions.filter((item) => item.action === 'HOLD').length };
  return ledger;
}

export function buildPaperStrategyView(ledger: PaperStrategyLedger, error?: string): PaperStrategyView {
  const values = ledger.trades.flatMap((trade) => trade.status === 'CLOSED' && trade.exit ? [trade.exit] : []);
  return {
    strategyVersion: PAPER_STRATEGY_POLICY.version, mode: 'SHADOW', policy: { ...PAPER_STRATEGY_POLICY },
    totalCount: ledger.trades.length, openCount: ledger.trades.filter((item) => item.status === 'OPEN').length,
    performance: { closedCount: values.length,
      meanNetReturnPct: values.length ? values.reduce((sum, item) => sum + item.netReturnPct, 0) / values.length : null,
      winRatePct: values.length ? values.filter((item) => item.netReturnPct > 0).length / values.length * 100 : null,
      totalNetPnl: values.length ? values.reduce((sum, item) => sum + item.netPnl, 0) : null },
    lastRun: ledger.lastRun, latestDecisions: ledger.latestDecisions,
    trades: ledger.trades.slice(-200).reverse(), ...(error ? { error } : {}),
  };
}
