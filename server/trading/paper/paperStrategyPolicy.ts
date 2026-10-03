// @responsibility Execute empirical Shadow strategy decisions.
import type { PaperCostModel, PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type {
  PaperStrategyDecision, PaperStrategyEvidence, PaperStrategyLedger, PaperStrategyReasonCode,
  PaperStrategyTrade, PaperStrategyView,
} from '../../../src/types/paperStrategy.js';
import { addBusinessDaysFromKstDate } from '../krxHolidays.js';
import { toKstDateKey, isKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { PAPER_NEWS_LOOKBACK_HOURS, scheduledPaperClose } from './paperStrategyEvidence.js';
import { summarizePaperNews } from '../../../src/utils/paperNews.js';
import { paperAdaptiveRuleLabel, type PaperAdaptiveState } from '../../../src/types/paperAdaptive.js';
import { adaptiveFeatureValue, adaptiveRuleMatches, PAPER_ADAPTIVE_POLICY } from './paperAdaptiveSelection.js';

export const ADAPTIVE_STRATEGY_POLICY = Object.freeze({ version: PAPER_ADAPTIVE_POLICY.version,
  newsLookbackHours: PAPER_NEWS_LOOKBACK_HOURS, minimumSamples: PAPER_ADAPTIVE_POLICY.minimumSamples,
  minimumEntryDates: PAPER_ADAPTIVE_POLICY.minimumEntryDates, horizonSelection: 'FORWARD_VALIDATED_FEATURE' as const,
  exitModel: 'SCHEDULED_CLOSE' as const });

function decision(
  snapshot: PaperSnapshot, observation: Pick<PaperObservation, 'symbol' | 'name'> & Partial<Pick<PaperObservation, 'news' | 'investorFlow'>>,
  action: PaperStrategyDecision['action'], reasonCode: PaperStrategyReasonCode, reason: string,
  evidence: PaperStrategyEvidence | null = null, tradeId: string | null = null,
): PaperStrategyDecision {
  return { snapshotId: snapshot.id, decisionAt: snapshot.asOf, symbol: observation.symbol, name: observation.name,
    action, reasonCode, reason, cohort: evidence?.cohort ?? null, evidence, tradeId,
    ...(observation.news ? { newsSummary: summarizePaperNews(observation.news, snapshot.asOf, PAPER_NEWS_LOOKBACK_HOURS) } : {}),
    ...(observation.investorFlow ? { investorFlow: structuredClone(observation.investorFlow) } : {}) };
}

function adaptiveEntryDecision(snapshot: PaperSnapshot, observation: PaperObservation, state: PaperAdaptiveState): PaperStrategyDecision {
  const active = state.candidates.filter(item => item.active);
  if (!active.length) return decision(snapshot, observation, 'WAIT', 'ADAPTIVE_NO_ACTIVE_RULE', '사용할 지표의 성과를 확인 중 · 기본 관측과 지표 재평가는 계속됩니다.');
  const selected = active.find(item => adaptiveRuleMatches(observation, item.rule, snapshot.asOf));
  if (!selected) {
    const available = active.some(item => adaptiveFeatureValue(observation, item.rule.feature, snapshot.asOf, item.rule.invention) !== null);
    return decision(snapshot, observation, 'WAIT', available ? 'ADAPTIVE_RULE_NOT_MATCHED' : 'ADAPTIVE_FEATURE_UNAVAILABLE',
      available ? '연결 중인 지표의 진입 구간에 해당하지 않아 대기' : '연결 중인 지표의 현재 관측값이 없어 대기 · 성과 악화로 처리하지 않습니다.');
  }
  return { ...decision(snapshot, observation, 'BUY', 'ADAPTIVE_FEATURE_SELECTED',
    `${paperAdaptiveRuleLabel(selected.rule)} 자동 선택 · ${selected.rule.invention ? '생성 후 검증' : '후반 확인'} ${selected.validation.sampleCount}건/${selected.validation.dateCount}일, 일당 대조군 차이 ${selected.validation.meanDailyExcessPct!.toFixed(2)}%p · 1주 진입`),
    adaptiveEvidence: { cutoffAt: state.cutoffAt, evaluatedAt: state.evaluatedAt,
      validationStartDate: selected.rule.invention
        ? addBusinessDaysFromKstDate(toKstDateKey(new Date(selected.rule.invention.createdAt)), 1)
        : state.validationStartDate!,
      policy: structuredClone(state.policy), candidate: structuredClone(selected) } };
}

function entryDecision(snapshot: PaperSnapshot, observation: PaperObservation, adaptive: PaperAdaptiveState): PaperStrategyDecision {
  const wait = (code: PaperStrategyReasonCode, reason: string) =>
    decision(snapshot, observation, 'WAIT', code, reason);
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
  return adaptiveEntryDecision(snapshot, observation, adaptive);
}

function closeDecision(trade: PaperStrategyTrade, snapshot: PaperSnapshot, observation?: PaperObservation): PaperStrategyDecision {
  const evidence = trade.entryDecision.evidence;
  const carry = (result: PaperStrategyDecision): PaperStrategyDecision => ({ ...result,
    ...(trade.entryDecision.adaptiveEvidence ? { adaptiveEvidence: structuredClone(trade.entryDecision.adaptiveEvidence) } : {}) });
  if (!(Date.parse(snapshot.asOf) >= Date.parse(trade.scheduledExitAt))) {
    return carry(decision(snapshot, trade, 'HOLD', 'HORIZON_PENDING', `${trade.scheduledExitDate} 종가 청산 예정 · 진입 시 확정한 D${trade.horizon}까지 보유`, evidence, trade.id));
  }
  const close = observation?.dailyCloses.find((item) => item.tradingDate === trade.scheduledExitDate
    && Number.isFinite(item.close) && item.close > 0
    && Date.parse(item.availableAt) >= Date.parse(trade.scheduledExitAt)
    && Date.parse(item.availableAt) <= Date.parse(snapshot.asOf));
  if (!close) return carry(decision(snapshot, trade, 'HOLD', 'SCHEDULED_CLOSE_UNAVAILABLE',
    `${trade.scheduledExitDate}의 확정 종가가 없어 청산 평가 대기`, evidence, trade.id));
  const exit = carry(decision(snapshot, trade, 'EXIT', 'SCHEDULED_CLOSE_REACHED',
    `진입 시 확정한 D${trade.horizon}(${trade.scheduledExitDate}) 종가 ${close.close.toLocaleString('ko-KR')}원으로 가상 청산`, evidence, trade.id));
  trade.status = 'CLOSED';
  trade.exit = { model: 'SCHEDULED_CLOSE', snapshotId: snapshot.id, effectiveAt: trade.scheduledExitAt,
    observedAt: close.availableAt, decisionAt: snapshot.asOf, price: close.close, decision: structuredClone(exit),
    ...calculatePaperReturn(trade.entryPrice, close.close, trade.costModel) };
  return exit;
}

export function evaluatePaperStrategyScan(
  input: PaperStrategyLedger, snapshot: PaperSnapshot,
  costForSymbol: (symbol: string) => PaperCostModel,
  adaptive: PaperAdaptiveState,
): PaperStrategyLedger {
  const ledger = structuredClone(input);
  ledger.adaptive = structuredClone(adaptive);
  const policy = ADAPTIVE_STRATEGY_POLICY;
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
    const result = entryDecision(snapshot, observation, ledger.adaptive);
    const horizon = result.adaptiveEvidence?.candidate.rule.horizon;
    if (result.action === 'BUY' && horizon) {
      const scheduledExitDate = addBusinessDaysFromKstDate(snapshot.tradingDate, horizon);
      result.tradeId = `${policy.version}:${snapshot.tradingDate}:${observation.symbol}`;
      const cutoff = Date.parse(snapshot.asOf);
      ledger.trades.push({
        id: result.tradeId, strategyVersion: policy.version, symbol: observation.symbol, name: observation.name,
        status: 'OPEN', entrySnapshotId: snapshot.id, entryAt: snapshot.asOf, tradingDate: snapshot.tradingDate,
        entryPrice: observation.price!, quantity: 1,
        entryObservation: structuredClone({ ...observation,
          news: observation.news.filter((item) => Date.parse(item.observedAt) <= cutoff),
          dailyCloses: observation.dailyCloses.filter((item) => Date.parse(item.availableAt) <= cutoff) }),
        entryDecision: structuredClone(result), policy: { ...policy }, costModel: { ...costForSymbol(observation.symbol) },
        horizon, scheduledExitDate, scheduledExitAt: scheduledPaperClose(scheduledExitDate), exit: null,
      });
    }
    decisions.push(result);
  }
  ledger.latestDecisions = decisions;
  const at = Date.parse(snapshot.asOf);
  if (snapshot.marketOpen && isKrxTradingDay(snapshot.tradingDate)
    && at >= Date.parse(`${snapshot.tradingDate}T09:00:00+09:00`) && at < Date.parse(`${snapshot.tradingDate}T15:30:00+09:00`)
    && (!ledger.lastMarketSession || at >= Date.parse(ledger.lastMarketSession.asOf))) {
    const reasonCounts: NonNullable<PaperStrategyLedger['lastMarketSession']>['reasonCounts'] = {};
    for (const item of decisions) reasonCounts[item.reasonCode] = (reasonCounts[item.reasonCode] ?? 0) + 1;
    ledger.lastMarketSession = { tradingDate: snapshot.tradingDate, snapshotId: snapshot.id, asOf: snapshot.asOf,
      decisionCount: decisions.length, reasonCounts };
  }
  ledger.lastRun = { snapshotId: snapshot.id, asOf: snapshot.asOf,
    openedCount: decisions.filter((item) => item.action === 'BUY').length,
    closedCount: decisions.filter((item) => item.action === 'EXIT').length,
    waitingCount: decisions.filter((item) => item.action === 'WAIT').length,
    holdingCount: decisions.filter((item) => item.action === 'HOLD').length };
  return ledger;
}

export function buildPaperStrategyView(ledger: PaperStrategyLedger, error?: string): PaperStrategyView {
  const values = ledger.trades.flatMap((trade) => trade.status === 'CLOSED' && trade.exit ? [trade.exit] : []);
  const performanceByVersion: NonNullable<PaperStrategyView['performanceByVersion']> = {};
  for (const version of ['news-trend-v1', 'news-trend-v2', 'adaptive-features-v1'] as const) {
    const closed = ledger.trades.flatMap(trade => trade.strategyVersion === version && trade.status === 'CLOSED' && trade.exit ? [trade.exit] : []);
    performanceByVersion[version] = { closedCount: closed.length,
      meanNetReturnPct: closed.length ? closed.reduce((sum, item) => sum + item.netReturnPct, 0) / closed.length : null,
      winRatePct: closed.length ? closed.filter(item => item.netReturnPct > 0).length / closed.length * 100 : null,
      totalNetPnl: closed.length ? closed.reduce((sum, item) => sum + item.netPnl, 0) : null };
  }
  return {
    strategyVersion: ADAPTIVE_STRATEGY_POLICY.version,
    mode: 'SHADOW', policy: { ...ADAPTIVE_STRATEGY_POLICY },
    ...(ledger.adaptive ? { adaptive: structuredClone(ledger.adaptive) } : {}),
    performanceByVersion,
    totalCount: ledger.trades.length, openCount: ledger.trades.filter((item) => item.status === 'OPEN').length,
    performance: { closedCount: values.length,
      meanNetReturnPct: values.length ? values.reduce((sum, item) => sum + item.netReturnPct, 0) / values.length : null,
      winRatePct: values.length ? values.filter((item) => item.netReturnPct > 0).length / values.length * 100 : null,
      totalNetPnl: values.length ? values.reduce((sum, item) => sum + item.netPnl, 0) : null },
    lastRun: ledger.lastRun, latestDecisions: ledger.latestDecisions, lastMarketSession: ledger.lastMarketSession,
    trades: ledger.trades.slice(-200).reverse(), ...(error ? { error } : {}),
  };
}
