// @responsibility Preserve observed price paths for frozen Shadow trades.
import type { PaperObservation, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperAdaptiveRule } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyLedger, PaperStrategyTrade, PaperTradeMeasurementPoint,
  PaperTradeMeasurementRow } from '../../../src/types/paperStrategy.js';
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { calculatePaperReturn } from './paperAccounting.js';
import { adaptiveFeatureValue, adaptiveRuleMatches } from './paperAdaptiveSelection.js';

type RulePoint = Pick<PaperTradeMeasurementPoint, 'ruleValue' | 'ruleMatches' | 'ruleConnected' | 'featureAsOf'>;
const noRule: RulePoint = { ruleValue: null, ruleMatches: null, ruleConnected: null, featureAsOf: null };
const positive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;
function net(trade: PaperStrategyTrade, price: number) {
  const { netReturnPct, netPnl } = calculatePaperReturn(trade.entryPrice, price, trade.costModel);
  return { netReturnPct, netPnl };
}

function sameRule(left: PaperAdaptiveRule, right: PaperAdaptiveRule): boolean {
  if (left.feature !== right.feature || left.bucket !== right.bucket || left.horizon !== right.horizon) return false;
  if (!left.invention || !right.invention) return !left.invention && !right.invention;
  const identity = (rule: PaperAdaptiveRule) => {
    const invention = rule.invention!, { formula } = invention;
    return [invention.id, invention.createdAt, invention.discoveryCutoffAt, formula.version, formula.operation,
      formula.left.feature, formula.left.center, formula.left.scale, formula.right.feature, formula.right.center, formula.right.scale];
  };
  return JSON.stringify(identity(left)) === JSON.stringify(identity(right));
}

export function readPaperTradeRulePoint(trade: PaperStrategyTrade, observation: PaperObservation, ledger: PaperStrategyLedger, snapshot: PaperSnapshot): RulePoint {
  const rule = (trade.entryDecision.adaptiveEvidence ?? trade.entryDecision.explorationEvidence)?.candidate.rule;
  if (!rule) return { ...noRule };
  const state = ledger.adaptive;
  const ruleConnected = state?.tradingDate === snapshot.tradingDate && Date.parse(state.evaluatedAt) <= Date.parse(snapshot.asOf)
    ? state.candidates.some(item => item.active && sameRule(item.rule, rule))
      || Boolean(state.exploration?.rules.some(item => Date.parse(item.registeredAt) <= Date.parse(snapshot.asOf) && sameRule(item.candidate.rule, rule)))
    : null;
  const features = observation.features;
  const featureAsOf = features?.version === 'observation-features-v1'
    && Date.parse(features.asOf) <= Date.parse(snapshot.asOf) && toKstDateKey(features.asOf) === snapshot.tradingDate ? features.asOf : null;
  const value = featureAsOf ? adaptiveFeatureValue(observation, rule.feature, snapshot.asOf, rule.invention) : null;
  return { ruleValue: value, ruleMatches: value === null ? null : adaptiveRuleMatches(observation, rule, snapshot.asOf), ruleConnected, featureAsOf };
}

export function isPaperTradeQuoteAllowed(trade: PaperStrategyTrade, observation: PaperObservation, snapshot: PaperSnapshot): boolean {
  const now = Date.parse(snapshot.asOf), observed = Date.parse(observation.observedAt);
  const open = Date.parse(`${snapshot.tradingDate}T09:00:00+09:00`), close = Date.parse(`${snapshot.tradingDate}T15:30:00+09:00`);
  return snapshot.marketOpen && isKrxTradingDay(snapshot.tradingDate) && toKstDateKey(snapshot.asOf) === snapshot.tradingDate
    && now >= open && now < close && observed >= open && observed < close && observed <= now
    && toKstDateKey(observation.observedAt) === snapshot.tradingDate && observation.symbol === trade.symbol
    && observed > Date.parse(trade.entryAt)
    && (trade.policy.exitModel !== 'SCHEDULED_CLOSE' || observed <= Date.parse(trade.scheduledExitAt))
    && (trade.policy.exitModel === 'SCHEDULED_CLOSE' || now - observed <= 5 * 60_000)
    && positive(observation.price) && !observation.issue;
}

function record(trade: PaperStrategyTrade, point: PaperTradeMeasurementPoint): PaperTradeMeasurementRow | null {
  const previous = trade.measurement;
  if (previous && (previous.latest.kind === 'SCHEDULED_CLOSE' || previous.latest.kind === 'ADAPTIVE_EXIT'
    || Date.parse(point.recordedAt) <= Date.parse(previous.latest.recordedAt)
    || Date.parse(point.effectiveAt) < Date.parse(previous.latest.effectiveAt)
    || (point.kind === 'QUOTE' && Date.parse(point.effectiveAt) === Date.parse(previous.latest.effectiveAt)))) return null;
  if (!previous) trade.measurement = { version: 'observed-trade-path-v1', startedAt: point.recordedAt,
    fromEntry: point.kind === 'ENTRY', pointCount: 1, latest: structuredClone(point), highest: structuredClone(point), lowest: structuredClone(point) };
  else trade.measurement = { ...previous, pointCount: previous.pointCount + 1, latest: structuredClone(point),
    highest: structuredClone(point.netReturnPct > previous.highest.netReturnPct ? point : previous.highest),
    lowest: structuredClone(point.netReturnPct < previous.lowest.netReturnPct ? point : previous.lowest) };
  return { ...structuredClone(point), tradeId: trade.id, entrySnapshotId: trade.entrySnapshotId };
}

export function capturePaperTradeMeasurements(ledger: PaperStrategyLedger, snapshot: PaperSnapshot): PaperTradeMeasurementRow[] {
  if (!Number.isFinite(Date.parse(snapshot.asOf)) || toKstDateKey(snapshot.asOf) !== snapshot.tradingDate) return [];
  const observations = new Map(snapshot.observations.map(item => [item.symbol, item]));
  const decisions = new Map(ledger.latestDecisions.filter(item => item.snapshotId === snapshot.id && item.decisionAt === snapshot.asOf)
    .map(item => [item.tradeId, item]));
  const rows: PaperTradeMeasurementRow[] = [];
  for (const trade of ledger.trades) {
    const decision = decisions.get(trade.id);
    if (!decision || decision.symbol !== trade.symbol) continue;
    let point: PaperTradeMeasurementPoint | undefined;
    if (trade.status === 'CLOSED') {
      const exit = trade.exit;
      if (!exit || exit.snapshotId !== snapshot.id || exit.decisionAt !== snapshot.asOf || decision.action !== 'EXIT'
        || !positive(exit.price) || !(Date.parse(exit.effectiveAt) <= Date.parse(exit.observedAt))
        || !(Date.parse(exit.observedAt) <= Date.parse(snapshot.asOf))) continue;
      if (exit.model === 'ADAPTIVE_OBSERVED') {
        const quote = exit.observedQuote;
        if (!quote || quote.price !== exit.price || quote.observedAt !== exit.observedAt) continue;
        point = { snapshotId: snapshot.id, kind: 'ADAPTIVE_EXIT', effectiveAt: exit.effectiveAt, observedAt: exit.observedAt,
          recordedAt: snapshot.asOf, price: exit.price, source: quote.source,
          ...net(trade, exit.price), action: 'EXIT', reasonCode: decision.reasonCode,
          ruleValue: quote.ruleValue, ruleMatches: quote.ruleMatches, ruleConnected: quote.ruleConnected, featureAsOf: quote.featureAsOf };
      } else point = { snapshotId: snapshot.id, kind: 'SCHEDULED_CLOSE', effectiveAt: exit.effectiveAt, observedAt: exit.observedAt,
        recordedAt: snapshot.asOf, price: exit.price, source: 'SCHEDULED_CLOSE_CONFIRMED',
        ...net(trade, exit.price), action: 'EXIT', reasonCode: decision.reasonCode, ...noRule };
    } else if (!trade.measurement && trade.entrySnapshotId === snapshot.id && trade.entryAt === snapshot.asOf && decision.action === 'BUY') {
      const observation = trade.entryObservation;
      if (!positive(trade.entryPrice) || !Number.isFinite(Date.parse(observation.observedAt))
        || Date.parse(observation.observedAt) > Date.parse(snapshot.asOf)) continue;
      point = { snapshotId: snapshot.id, kind: 'ENTRY', effectiveAt: trade.entryAt, observedAt: observation.observedAt,
        recordedAt: snapshot.asOf, price: trade.entryPrice, source: observation.source,
        ...net(trade, trade.entryPrice), action: 'BUY', reasonCode: decision.reasonCode,
        ...readPaperTradeRulePoint(trade, observation, ledger, snapshot) };
    } else {
      const observation = observations.get(trade.symbol);
      if (!observation || decision.action !== 'HOLD' || !isPaperTradeQuoteAllowed(trade, observation, snapshot)) continue;
      if (trade.policy.exitModel === 'ADAPTIVE_OBSERVED' && decision.reasonCode !== 'ADAPTIVE_EXIT_HOLD') continue;
      point = { snapshotId: snapshot.id, kind: 'QUOTE', effectiveAt: observation.observedAt, observedAt: observation.observedAt,
        recordedAt: snapshot.asOf, price: observation.price!, source: observation.source,
        ...net(trade, observation.price!), action: 'HOLD', reasonCode: decision.reasonCode,
        ...readPaperTradeRulePoint(trade, observation, ledger, snapshot) };
    }
    if (!Number.isFinite(point.netReturnPct) || !Number.isFinite(point.netPnl)) continue;
    const row = record(trade, point);
    if (row) rows.push(row);
  }
  return rows;
}
