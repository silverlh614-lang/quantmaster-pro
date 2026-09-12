// @responsibility Isolate strategy persistence failures from baseline sampling.
import type { PaperExperiment, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperStrategyLedger, PaperStrategyScanResult } from '../../../src/types/paperStrategy.js';
import { loadPaperStrategyLedger, savePaperStrategyLedger } from '../../persistence/paperStrategyRepo.js';
import { getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import { capturePaperCostModel } from './paperExperimentPolicy.js';
import { buildPaperStrategyView, evaluatePaperStrategyScan } from './paperStrategyPolicy.js';
import { getHistoricalPaperSamples } from './paperResearchRuntime.js';

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
    const ledger = evaluatePaperStrategyScan(state.ledger, experiments, snapshot, (symbol) =>
      capturePaperCostModel(getStockByCode(symbol)?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'), getHistoricalPaperSamples());
    savePaperStrategyLedger(ledger);
    lastFailure = undefined;
    return ledger.lastRun!;
  } catch (error) {
    lastFailure = `전략 처리 실패 · 기준 실험은 계속됩니다: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[PaperStrategy]', lastFailure);
    return { snapshotId: snapshot.id, asOf: snapshot.asOf, openedCount: 0, closedCount: 0, waitingCount: 0, holdingCount: 0, error: lastFailure };
  }
}

export function readPaperStrategyView() {
  const state = loadPaperStrategyState();
  return buildPaperStrategyView(state.ledger ?? { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null }, state.error ?? lastFailure);
}
