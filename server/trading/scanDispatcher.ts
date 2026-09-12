// @responsibility Route scans to the selected trading runtime.
import { getTradingMode } from '../state.js';
import type { PaperScanResult } from '../../src/types/paperExperiment.js';
import type { RunAutoSignalScanOptions } from './signalScanner/index.js';

export interface DispatchedScanResult {
  positionFull?: boolean;
  paperExperiment?: PaperScanResult;
}

export async function runAutoSignalScan(options?: RunAutoSignalScanOptions): Promise<DispatchedScanResult> {
  if (getTradingMode() === 'SHADOW') {
    const { runPaperExperimentScan } = await import('./paper/paperExperimentRunner.js');
    return { paperExperiment: await runPaperExperimentScan() };
  }
  const legacy = await import('./signalScanner/index.js');
  return legacy.runAutoSignalScan(options);
}
