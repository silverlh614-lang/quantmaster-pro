// @responsibility Isolate strategy persistence failures from baseline sampling.
import type { PaperExperiment, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger, PaperStrategyScanResult, PaperTradeMeasurementRow } from '../../../src/types/paperStrategy.js';
import { loadPaperStrategyLedger, savePaperStrategyLedger } from '../../persistence/paperStrategyRepo.js';
import { getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import { capturePaperCostModel, trimArchivedEntryBars } from './paperExperimentPolicy.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan, evaluatePaperHoldingPrices } from './paperStrategyPolicy.js';
import { getArchivedPaperBarCheck } from './paperResearchRuntime.js';
import { buildPaperStrategySelection } from './paperStrategySelection.js';
import { selectPaperAdaptiveState } from './paperAdaptiveSelection.js';
import { capturePaperTradeMeasurements } from './paperTradeMeasurements.js';
import { assertPaperTradeMeasurement } from './paperTradeMeasurementValidation.js';
import { savePaperTradeMeasurementBatch, recordPaperTradeMeasurementFailure, readPaperTradeMeasurementHistory } from '../../persistence/paperTradeMeasurementRepo.js';
import { capturePaperMorningSource, capturePaperMorningTracking, linkPaperMorningRecommendations } from './paperMorningRuntime.js';
import { queuePaperProgramResearch, readPaperProgramProposals, readPaperProgramResearch } from './paperProgramResearch.js';

export interface PaperStrategyState { ledger: PaperStrategyLedger | null; error?: string }
let lastFailure: string | undefined;

export function loadPaperStrategyState(): PaperStrategyState {
  try {
    return { ledger: loadPaperStrategyLedger() };
  } catch (error) {
    return { ledger: null, error: `전략 기록을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function advancePaperStrategy(
  state: PaperStrategyState, experiments: PaperExperiment[], snapshot: PaperSnapshot,
): PaperStrategyScanResult {
  try {
    if (!state.ledger) throw new Error(state.error ?? '전략 기록 없음');
    const ledger = snapshot.quoteOnly ? evaluatePaperHoldingPrices(state.ledger, snapshot)
      : evaluatePaperStrategyScan(state.ledger, snapshot, (symbol) =>
        capturePaperCostModel(getStockByCode(symbol)?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'),
      selectPaperAdaptiveState(state.ledger.adaptive, experiments, snapshot.asOf, snapshot.observations, readPaperProgramProposals(), state.ledger.trades));
    const archived = getArchivedPaperBarCheck();
    if (archived) ledger.trades = ledger.trades.map((trade) => {
      const entryObservation = trimArchivedEntryBars(trade.entryObservation, trade.tradingDate, archived);
      return entryObservation === trade.entryObservation ? trade : { ...trade, entryObservation };
    });
    linkPaperMorningRecommendations(ledger, snapshot);
    const previousMeasurements = ledger.trades.map(trade => trade.measurement);
    let rows: PaperTradeMeasurementRow[] = [], measurementError: unknown;
    try {
      rows = capturePaperTradeMeasurements(ledger, snapshot);
      for (const trade of ledger.trades) if (trade.measurement) assertPaperTradeMeasurement(trade, snapshot.asOf);
    } catch (error) {
      // SDS-ignore: recordPaperTradeMeasurementFailure logs and persists this after the core commit.
      measurementError = error;
      ledger.trades.forEach((trade, index) => {
        if (previousMeasurements[index]) trade.measurement = previousMeasurements[index];
        else delete trade.measurement;
      });
    }
    savePaperStrategyLedger(ledger);
    capturePaperMorningTracking(ledger, snapshot);
    if (!snapshot.quoteOnly) capturePaperMorningSource(ledger, snapshot);
    if (measurementError) recordPaperTradeMeasurementFailure(snapshot.id, snapshot.asOf, 0, measurementError, ledger.trades);
    else if (rows.length) {
      try { savePaperTradeMeasurementBatch(rows, ledger.trades); }
      catch (error) {
        // SDS-ignore: this helper logs and persists the failure without cancelling committed trades.
        recordPaperTradeMeasurementFailure(snapshot.id, snapshot.asOf, rows.length, error, ledger.trades);
      }
    }
    lastFailure = undefined;
    if (!snapshot.quoteOnly && ledger.adaptive) void queuePaperProgramResearch(ledger.adaptive, { asOf: snapshot.asOf, marketOpen: snapshot.marketOpen });
    return ledger.lastRun!;
  } catch (error) {
    lastFailure = `전략 처리 실패 · 기준 실험은 계속됩니다: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[PaperStrategy]', lastFailure);
    return { snapshotId: snapshot.id, asOf: snapshot.asOf, openedCount: 0, closedCount: 0, waitingCount: 0, holdingCount: 0, error: lastFailure };
  }
}

export function readPaperStrategyView(includeAllRecords = false, experiments?: PaperExperiment[], state = loadPaperStrategyState()) {
  const ledger: PaperStrategyLedger = state.ledger ?? { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null };
  const view = buildPaperStrategyView(ledger, state.error ?? lastFailure);
  if (view.adaptive) view.adaptive = { ...view.adaptive, programResearch: readPaperProgramResearch(view.adaptive) };
  view.measurementHistory = readPaperTradeMeasurementHistory(ledger);
  if (includeAllRecords) view.trades = [...ledger.trades].reverse();
  if (experiments && state.ledger) view.selection = buildPaperStrategySelection(ledger.trades, experiments);
  return view;
}
