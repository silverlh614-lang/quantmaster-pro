// @responsibility Route every mode to the current regime-free signal model.
import type { PaperScanResult } from '../../src/types/paperExperiment.js';
import type { RunAutoSignalScanOptions } from './signalScanner/index.js';

export interface DispatchedScanResult {
  positionFull?: boolean;
  paperExperiment?: PaperScanResult;
}

export async function runAutoSignalScan(_options?: RunAutoSignalScanOptions): Promise<DispatchedScanResult> {
  // LIVE/PAPER regime-based automatic entry was retired by the operator on 2026-09-13.
  // Signals, observations and research continue without promoting virtual fills to broker orders.
  const { runPaperExperimentScan } = await import('./paper/paperExperimentRunner.js');
  return { paperExperiment: await runPaperExperimentScan() };
}
