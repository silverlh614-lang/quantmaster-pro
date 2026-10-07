// @responsibility Project strategy trades into compact dashboard rows.
import type { PaperStrategyScreenView, PaperStrategyTrade, PaperStrategyTradeSummary, PaperStrategyView } from '../../../src/types/paperStrategy.js';

/** Keeps every field the screen groups, filters or scores by; entry bars and duplicated evidence stay on the server. */
export function summarizePaperStrategyTrade(trade: PaperStrategyTrade): PaperStrategyTradeSummary {
  const { cohort, adaptiveEvidence, explorationEvidence } = trade.entryDecision;
  return {
    id: trade.id, strategyVersion: trade.strategyVersion, symbol: trade.symbol, name: trade.name, status: trade.status,
    entryAt: trade.entryAt, tradingDate: trade.tradingDate, horizon: trade.horizon, costModel: trade.costModel,
    policy: { exitModel: trade.policy.exitModel },
    ...(trade.exitPolicy ? { exitPolicy: { version: trade.exitPolicy.version, profile: trade.exitPolicy.profile } } : {}),
    entryDecision: { cohort,
      ...(adaptiveEvidence ? { adaptiveEvidence: { candidate: { rule: adaptiveEvidence.candidate.rule } } } : {}),
      ...(explorationEvidence ? { explorationEvidence: { candidate: { rule: explorationEvidence.candidate.rule } } } : {}) },
    exit: trade.exit && { netReturnPct: trade.exit.netReturnPct },
    ...(trade.exitResearch ? { exitResearch: { baseline: trade.exitResearch.baseline && { netReturnPct: trade.exitResearch.baseline.netReturnPct } } } : {}),
    ...(trade.measurement ? { measurement: { fromEntry: trade.measurement.fromEntry } } : {}),
  };
}

/** The strategy screen polls every 30 seconds, so it receives one compact row per trade. */
export function paperStrategyScreenView(view: PaperStrategyView): PaperStrategyScreenView {
  return { ...view, trades: view.trades.map(summarizePaperStrategyTrade) };
}
