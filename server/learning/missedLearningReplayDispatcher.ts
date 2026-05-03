// @responsibility MissedLearningQueue replay dispatcher - jobName to actual learning job mapping

import { runWeeklyMiniBacktest } from './backtestEngine.js';
import { runNightlyReflection } from './nightlyReflectionEngine.js';
import { refreshGhostPortfolio } from './ghostPortfolioTracker.js';
import {
  resolveCounterfactuals,
  evaluateCounterfactualSuggestion,
} from './counterfactualShadow.js';
import {
  resolveLedger,
  evaluateLedgerSuggestion,
} from './ledgerSimulator.js';
import { evaluateKellySurfaceSuggestion } from './kellySurfaceMap.js';
import { evaluateRegimeCoverageSuggestion } from './regimeBalancedSampler.js';
import { computeSafetyGateAttribution } from './safetyGateAttribution.js';
import { computeShadowVsLiveDelta } from './shadowVsLiveDelta.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import type { MissedLearningJobName } from './missedLearningQueue.js';

async function runCounterfactualResolveReplay(): Promise<void> {
  await resolveCounterfactuals((code) => fetchCurrentPrice(code).catch(() => null));
  await evaluateCounterfactualSuggestion().catch((e) => {
    console.warn('[MissedLearningReplay][Counterfactual][suggest] failed:', e);
  });
}

async function runLedgerResolveReplay(): Promise<void> {
  await resolveLedger((code) => fetchCurrentPrice(code).catch(() => null));
  await evaluateLedgerSuggestion().catch((e) => {
    console.warn('[MissedLearningReplay][Ledger][suggest] failed:', e);
  });
  await evaluateKellySurfaceSuggestion({}).catch((e) => {
    console.warn('[MissedLearningReplay][KellySurface][suggest] failed:', e);
  });
  await evaluateRegimeCoverageSuggestion().catch((e) => {
    console.warn('[MissedLearningReplay][RegimeCoverage][suggest] failed:', e);
  });
}

async function refreshGhostPortfolioReplay(): Promise<void> {
  await refreshGhostPortfolio();
}

async function runNightlyReflectionReplay(): Promise<void> {
  await runNightlyReflection();
}

async function runDailyMiniBacktestReplay(): Promise<void> {
  await runWeeklyMiniBacktest();
}

async function runShadowLiveDeltaReportReplay(): Promise<void> {
  computeShadowVsLiveDelta({
    shadowSignals: loadShadowLearningOnlySignals(),
    liveTrades: loadShadowTrades(),
  });
}

async function runSafetyGateAttributionReplay(): Promise<void> {
  computeSafetyGateAttribution(loadShadowLearningOnlySignals());
}

export async function dispatchMissedLearningReplay(
  jobName: MissedLearningJobName,
): Promise<void> {
  switch (jobName) {
    case 'counterfactual_resolve':
      return runCounterfactualResolveReplay();
    case 'ledger_resolve':
      return runLedgerResolveReplay();
    case 'ghost_portfolio':
      return refreshGhostPortfolioReplay();
    case 'nightly_reflection':
      return runNightlyReflectionReplay();
    case 'daily_mini_backtest':
      return runDailyMiniBacktestReplay();
    case 'shadow_live_delta_report':
      return runShadowLiveDeltaReportReplay();
    case 'safety_gate_attribution':
      return runSafetyGateAttributionReplay();
  }
}
