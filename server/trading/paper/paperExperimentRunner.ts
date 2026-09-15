// @responsibility Run the default Shadow experiment cycle.
import type { PaperCollectionProgress, PaperExperimentView, PaperScanResult } from '../../../src/types/paperExperiment.js';
import { loadPaperExperimentLedger, savePaperExperimentLedger } from '../../persistence/paperExperimentRepo.js';
import { getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import { collectPaperExperimentSnapshot } from './paperExperimentCollector.js';
import { summarizeCurrentInvestorFlow } from './paperInvestorFlowStudy.js';
import {
  buildPaperExperimentView, capturePaperCostModel, createPaperExperiment, paperExperimentId, updatePaperOutcomes,
} from './paperExperimentPolicy.js';
import { advancePaperStrategy, loadPaperStrategyState, readPaperStrategyView } from './paperStrategyRuntime.js';
import { refreshPaperResearch, getPaperResearchView } from './paperResearchRuntime.js';

let running: Promise<PaperScanResult> | null = null;
let collection: PaperCollectionProgress | undefined;

async function scan(): Promise<PaperScanResult> {
  const startedAt = new Date().toISOString();
  collection = { startedAt, lastProgressAt: startedAt, completed: 0, total: 0 };
  // Local historical research can proceed even if the following market-data collection fails.
  refreshPaperResearch();
  const ledger = loadPaperExperimentLedger();
  const strategy = loadPaperStrategyState();
  const openSymbols = [...new Set([
    ...ledger.experiments.filter((item) => item.status === 'OPEN').map((item) => item.symbol),
    ...(strategy.ledger?.trades ?? []).filter((item) => item.status === 'OPEN').map((item) => item.symbol),
  ])];
  const snapshot = await collectPaperExperimentSnapshot(openSymbols, (completed, total) => {
    collection = { startedAt, lastProgressAt: new Date().toISOString(), completed, total };
  });
  const observations = new Map(snapshot.observations.map((item) => [item.symbol, item]));
  let completedCount = 0;
  ledger.experiments = ledger.experiments.map((experiment) => {
    const observation = observations.get(experiment.symbol);
    if (!observation) return experiment;
    const updated = updatePaperOutcomes(experiment, observation, snapshot.asOf);
    if (experiment.status === 'OPEN' && updated.status === 'COMPLETED') completedCount++;
    return updated;
  });
  const ids = new Set(ledger.experiments.map((item) => item.id));
  let openedCount = 0;
  for (const observation of snapshot.observations) {
    if (ids.has(paperExperimentId(observation.symbol, snapshot.tradingDate))) continue;
    const market = getStockByCode(observation.symbol)?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
    const experiment = createPaperExperiment(snapshot, observation, capturePaperCostModel(market));
    if (!experiment) continue;
    ledger.experiments.push(experiment);
    ids.add(experiment.id);
    openedCount++;
  }
  const result: PaperScanResult = {
    snapshotId: snapshot.id, asOf: snapshot.asOf, candidateCount: snapshot.observations.length,
    durationMs: Date.now() - Date.parse(startedAt),
    observedCount: snapshot.observations.filter((item) => item.price !== null).length,
    openedCount, completedCount,
    missingPriceCount: snapshot.observations.filter((item) => item.price === null).length,
    marketOpen: snapshot.marketOpen,
    issues: snapshot.observations.flatMap((item) => item.issue ? [`${item.symbol}:${item.issue}`] : []),
    investorFlow: summarizeCurrentInvestorFlow(snapshot.observations, snapshot.asOf),
  };
  ledger.lastRun = result;
  savePaperExperimentLedger(ledger);
  // Baseline is durable before strategy work; strategy failures never discard observations.
  result.strategy = advancePaperStrategy(strategy, ledger.experiments, snapshot);
  return result;
}

export function runPaperExperimentScan(): Promise<PaperScanResult> {
  if (!running) running = scan().finally(() => { running = null; collection = undefined; });
  return running;
}

export function getPaperExperimentView(includeAllRecords = false): PaperExperimentView {
  const ledger = loadPaperExperimentLedger();
  const view = buildPaperExperimentView(ledger);
  if (includeAllRecords) view.experiments = [...ledger.experiments].reverse();
  return { ...view, ...(collection ? { collection: { ...collection } } : {}),
    strategy: readPaperStrategyView(includeAllRecords), research: getPaperResearchView() };
}
