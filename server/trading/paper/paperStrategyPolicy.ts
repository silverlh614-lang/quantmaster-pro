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
import { paperAdaptiveRuleLabel, type PaperAdaptiveCandidate, type PaperAdaptiveState, type PaperExplorationTrial } from '../../../src/types/paperAdaptive.js';
import { adaptiveFeatureValue, adaptiveRuleMatches, PAPER_ADAPTIVE_POLICY } from './paperAdaptiveSelection.js';
import { advancePaperExitResearch, freezePaperExitPolicy, initializePaperExitResearch, selectPaperExitLearning } from './paperAdaptiveExit.js';
import { readPaperTradeRulePoint } from './paperTradeMeasurements.js';
import { allocatePaperAutonomyEntry, recoverPaperAutonomyState } from './paperAutonomyAllocation.js';

export const ADAPTIVE_STRATEGY_POLICY = Object.freeze({ version: PAPER_ADAPTIVE_POLICY.version,
  newsLookbackHours: PAPER_NEWS_LOOKBACK_HOURS, minimumSamples: PAPER_ADAPTIVE_POLICY.minimumSamples,
  minimumEntryDates: PAPER_ADAPTIVE_POLICY.minimumEntryDates, horizonSelection: 'FORWARD_VALIDATED_FEATURE' as const,
  exitModel: 'ADAPTIVE_OBSERVED' as const });

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
  const trials = state.exploration?.rules ?? [];
  if (!active.length && !trials.length) return decision(snapshot, observation, 'WAIT', 'ADAPTIVE_NO_ACTIVE_RULE', '사용할 지표와 탐색 규칙을 확인 중 · 기본 관측과 지표 재평가는 계속됩니다.');
  const eligible = trials.filter(trial => {
    const registered = Date.parse(trial.registeredAt), candidate = trial.candidate;
    return !candidate.active && ['MISSING_INPUT', 'INSUFFICIENT_TRAINING', 'INSUFFICIENT_VALIDATION', 'FORWARD_OBSERVATION'].includes(candidate.reason)
      && registered < Date.parse(observation.observedAt) && registered < Date.parse(observation.features?.asOf ?? '')
      && (!candidate.rule.invention || Date.parse(candidate.rule.invention.createdAt) <= registered);
  });
  const choices: Array<{ candidate: PaperAdaptiveCandidate; trial?: PaperExplorationTrial }> = [
    ...active.map(candidate => ({ candidate })), ...eligible.map(trial => ({ candidate: trial.candidate, trial })),
  ];
  const matching = choices.filter(item => adaptiveRuleMatches(observation, item.candidate.rule, snapshot.asOf));
  if (!matching.length) {
    const available = choices.some(item => adaptiveFeatureValue(observation, item.candidate.rule.feature, snapshot.asOf, item.candidate.rule.invention) !== null);
    return decision(snapshot, observation, 'WAIT', available ? 'ADAPTIVE_RULE_NOT_MATCHED' : 'ADAPTIVE_FEATURE_UNAVAILABLE',
      available ? '연결 중인 지표의 진입 구간에 해당하지 않아 대기' : '연결 지표의 현재값 또는 탐색 등록 이후 새 관측을 확인 중 · 성과 악화로 처리하지 않습니다.');
  }
  const { choice: { candidate: selected, trial }, allocation } = allocatePaperAutonomyEntry(matching, state.exploration?.autonomy, observation.symbol, snapshot.asOf);
  if (trial) return { ...decision(snapshot, observation, 'BUY', 'ADAPTIVE_EXPLORATION_SELECTED',
    `${paperAdaptiveRuleLabel(selected.rule)} 탐색 가상 진입 · 성과 검증 전 가설을 1주로 관측`),
    ...(allocation ? { allocation } : {}), explorationEvidence: { cutoffAt: state.cutoffAt, evaluatedAt: state.evaluatedAt,
      validationStartDate: state.validationStartDate, trialId: trial.id, registeredAt: trial.registeredAt,
      policy: structuredClone(state.policy), candidate: structuredClone(selected) } };
  return { ...decision(snapshot, observation, 'BUY', 'ADAPTIVE_FEATURE_SELECTED',
    `${paperAdaptiveRuleLabel(selected.rule)} 자동 선택 · ${selected.rule.invention ? '생성 후 검증' : '후반 확인'} ${selected.validation.sampleCount}건/${selected.validation.dateCount}일, 일당 대조군 차이 ${selected.validation.meanDailyExcessPct!.toFixed(2)}%p · 1주 진입`),
    ...(allocation ? { allocation } : {}), adaptiveEvidence: { cutoffAt: state.cutoffAt, evaluatedAt: state.evaluatedAt,
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
    return wait('CURRENT_PRICE_UNAVAILABLE', observation.issue === 'TRADING_HALTED'
      ? '거래정지 종목 · 진입 대상에서 제외' : '유효한 현재가를 확인할 수 없어 진입 대기');
  }
  return adaptiveEntryDecision(snapshot, observation, adaptive);
}

function closeDecision(trade: PaperStrategyTrade, snapshot: PaperSnapshot, ledger: PaperStrategyLedger, observation?: PaperObservation): PaperStrategyDecision {
  const evidence = trade.entryDecision.evidence;
  const carry = (result: PaperStrategyDecision): PaperStrategyDecision => ({ ...result,
    ...(trade.entryDecision.allocation ? { allocation: structuredClone(trade.entryDecision.allocation) } : {}),
    ...(trade.entryDecision.adaptiveEvidence ? { adaptiveEvidence: structuredClone(trade.entryDecision.adaptiveEvidence) } : {}),
    ...(trade.entryDecision.explorationEvidence ? { explorationEvidence: structuredClone(trade.entryDecision.explorationEvidence) } : {}) });
  if (trade.policy.exitModel === 'ADAPTIVE_OBSERVED') {
    const update = advancePaperExitResearch(trade, snapshot, observation);
    trade.exitResearch = update.research;
    const trigger = update.trigger;
    if (!trigger || trigger.reason === 'D5_BENCHMARK') return carry(decision(snapshot, trade, 'HOLD',
      update.quoteAccepted ? 'ADAPTIVE_EXIT_HOLD' : 'ADAPTIVE_EXIT_QUOTE_UNAVAILABLE',
      update.quoteAccepted ? '새 가격 확인 · 손실 제한·수익 반납·진입 근거 약화 조건 미충족, D일 강제 청산 없음'
        : observation?.issue === 'TRADING_HALTED' ? '거래정지 · 멈춘 가격으로 매도 판단하지 않고 정지 해제 후 첫 유효 가격을 기다립니다.'
        : '매도 판단용 유효한 새 장중 가격 대기 · 누락 자료를 매도 신호로 취급하지 않습니다.', evidence, trade.id));
    const reasons = { ADAPTIVE_STOP_LOSS: '비용 차감 손실 제한', ADAPTIVE_TRAILING_STOP: '관측 수익 고점 대비 반납',
      ADAPTIVE_SIGNAL_LOST: '진입 조건의 지속적인 약화' };
    const exit = carry(decision(snapshot, trade, 'EXIT', trigger.reason,
      `${reasons[trigger.reason]} · 관측 ${trigger.price.toLocaleString('ko-KR')}원으로 가상 청산 · D일과 독립적으로 판단`, evidence, trade.id));
    trade.status = 'CLOSED';
    trade.exit = { model: 'ADAPTIVE_OBSERVED', snapshotId: trigger.snapshotId, effectiveAt: trigger.effectiveAt,
      observedAt: trigger.observedAt, decisionAt: snapshot.asOf, price: trigger.price, decision: structuredClone(exit),
      observedTrigger: structuredClone(trigger),
      observedQuote: { source: observation!.source, price: observation!.price!, observedAt: observation!.observedAt,
        ...readPaperTradeRulePoint(trade, observation!, ledger, snapshot) },
      ...calculatePaperReturn(trade.entryPrice, trigger.price, trade.costModel) };
    return exit;
  }
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
  recoverPaperAutonomyState(ledger.adaptive);
  // Only already completed forward evidence can affect a new entry's frozen exit policy.
  ledger.exitLearning = selectPaperExitLearning(ledger.trades, snapshot.asOf);
  const policy = ADAPTIVE_STRATEGY_POLICY;
  const observations = new Map(snapshot.observations.map((item) => [item.symbol, item]));
  const decisions: PaperStrategyDecision[] = [];
  const handled = new Set<string>();
  for (const trade of ledger.trades.filter(item => item.status === 'CLOSED' && item.exitResearch && !item.exitResearch.completedAt)) {
    trade.exitResearch = advancePaperExitResearch(trade, snapshot, observations.get(trade.symbol)).research;
  }
  for (const trade of ledger.trades.filter((item) => item.status === 'OPEN')) {
    decisions.push(closeDecision(trade, snapshot, ledger, observations.get(trade.symbol)));
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
    const horizon = (result.adaptiveEvidence ?? result.explorationEvidence)?.candidate.rule.horizon;
    if (result.action === 'BUY' && horizon) {
      const scheduledExitDate = addBusinessDaysFromKstDate(snapshot.tradingDate, horizon);
      result.tradeId = `${policy.version}:${snapshot.tradingDate}:${observation.symbol}`;
      const cutoff = Date.parse(snapshot.asOf);
      const trade: PaperStrategyTrade = {
        id: result.tradeId, strategyVersion: policy.version, symbol: observation.symbol, name: observation.name,
        status: 'OPEN', entrySnapshotId: snapshot.id, entryAt: snapshot.asOf, tradingDate: snapshot.tradingDate,
        entryPrice: observation.price!, quantity: 1,
        entryObservation: structuredClone({ ...observation,
          news: observation.news.filter((item) => Date.parse(item.observedAt) <= cutoff),
          dailyCloses: observation.dailyCloses.filter((item) => Date.parse(item.availableAt) <= cutoff) }),
        entryDecision: structuredClone(result), policy: { ...policy }, costModel: { ...costForSymbol(observation.symbol) },
        horizon, scheduledExitDate, scheduledExitAt: scheduledPaperClose(scheduledExitDate), exit: null,
        exitPolicy: freezePaperExitPolicy(ledger.exitLearning, snapshot.asOf),
      };
      trade.exitResearch = initializePaperExitResearch(trade);
      ledger.trades.push(trade);
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
    const haltedCount = decisions.filter(item => item.action === 'WAIT' && item.reasonCode === 'CURRENT_PRICE_UNAVAILABLE'
      && observations.get(item.symbol)?.issue === 'TRADING_HALTED').length;
    ledger.lastMarketSession = { tradingDate: snapshot.tradingDate, snapshotId: snapshot.id, asOf: snapshot.asOf,
      decisionCount: decisions.length, reasonCounts, ...(haltedCount ? { haltedCount } : {}) };
  }
  ledger.lastRun = { snapshotId: snapshot.id, asOf: snapshot.asOf,
    openedCount: decisions.filter((item) => item.action === 'BUY').length,
    closedCount: decisions.filter((item) => item.action === 'EXIT').length,
    waitingCount: decisions.filter((item) => item.action === 'WAIT').length,
    holdingCount: decisions.filter((item) => item.action === 'HOLD').length };
  return ledger;
}

/** Update only monitored holdings; entries, rule selection and broad scan counts stay independent. */
export function evaluatePaperHoldingPrices(input: PaperStrategyLedger, snapshot: PaperSnapshot): PaperStrategyLedger {
  if (!snapshot.quoteOnly) throw new Error('Holding monitor requires a price-only snapshot');
  const ledger = structuredClone(input);
  const observations = new Map(snapshot.observations.map(item => [item.symbol, item]));
  const decisions: PaperStrategyDecision[] = [];
  for (const trade of ledger.trades) {
    const observation = observations.get(trade.symbol);
    if (!observation) continue;
    if (trade.status === 'OPEN') decisions.push(closeDecision(trade, snapshot, ledger, observation));
    else if (trade.exitResearch && !trade.exitResearch.completedAt) {
      trade.exitResearch = advancePaperExitResearch(trade, snapshot, observation).research;
    }
  }
  const replaced = new Set(decisions.map(item => item.symbol));
  ledger.latestDecisions = [...ledger.latestDecisions.filter(item => !replaced.has(item.symbol)), ...decisions];
  ledger.lastRun = { snapshotId: snapshot.id, asOf: snapshot.asOf, openedCount: 0,
    closedCount: decisions.filter(item => item.action === 'EXIT').length, waitingCount: 0,
    holdingCount: decisions.filter(item => item.action === 'HOLD').length };
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
  const performanceByPurpose = {} as NonNullable<PaperStrategyView['performanceByPurpose']>;
  for (const purpose of ['VALIDATED', 'EXPLORATION'] as const) {
    const trades = ledger.trades.filter(trade => trade.strategyVersion === 'adaptive-features-v1'
      && Boolean(trade.entryDecision.explorationEvidence) === (purpose === 'EXPLORATION'));
    const closed = trades.flatMap(trade => trade.status === 'CLOSED' && trade.exit ? [trade.exit] : []);
    performanceByPurpose[purpose] = { openCount: trades.filter(trade => trade.status === 'OPEN').length,
      closedCount: closed.length,
      meanNetReturnPct: closed.length ? closed.reduce((sum, item) => sum + item.netReturnPct, 0) / closed.length : null,
      winRatePct: closed.length ? closed.filter(item => item.netReturnPct > 0).length / closed.length * 100 : null,
      totalNetPnl: closed.length ? closed.reduce((sum, item) => sum + item.netPnl, 0) : null };
  }
  const open = ledger.trades.filter(trade => trade.status === 'OPEN');
  const today = ledger.lastRun ? toKstDateKey(new Date(ledger.lastRun.asOf)) : null;
  // A close is normally read on the next scan; one still missing after its date has passed is reported, not guessed.
  const overdue = today ? open.filter(trade => trade.policy.exitModel !== 'ADAPTIVE_OBSERVED' && trade.scheduledExitDate < today)
    .map(trade => trade.scheduledExitDate).sort() : [];
  const current = open.filter(trade => trade.strategyVersion === ADAPTIVE_STRATEGY_POLICY.version).length;
  return {
    strategyVersion: ADAPTIVE_STRATEGY_POLICY.version,
    mode: 'SHADOW', policy: { ...ADAPTIVE_STRATEGY_POLICY },
    openBreakdown: { current, legacy: open.length - current, overdueScheduledCount: overdue.length, oldestOverdueExitDate: overdue[0] ?? null },
    ...(ledger.adaptive ? { adaptive: structuredClone(ledger.adaptive) } : {}),
    ...(ledger.exitLearning ? { exitLearning: structuredClone(ledger.exitLearning) } : {}),
    performanceByVersion, performanceByPurpose,
    totalCount: ledger.trades.length, openCount: open.length,
    performance: { closedCount: values.length,
      meanNetReturnPct: values.length ? values.reduce((sum, item) => sum + item.netReturnPct, 0) / values.length : null,
      winRatePct: values.length ? values.filter((item) => item.netReturnPct > 0).length / values.length * 100 : null,
      totalNetPnl: values.length ? values.reduce((sum, item) => sum + item.netPnl, 0) : null },
    lastRun: ledger.lastRun, latestDecisions: ledger.latestDecisions, lastMarketSession: ledger.lastMarketSession,
    trades: ledger.trades.slice(-200).reverse(), ...(error ? { error } : {}),
  };
}
