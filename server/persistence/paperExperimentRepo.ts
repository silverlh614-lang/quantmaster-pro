// @responsibility Persist independent paper experiment records.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperExperimentLedger } from '../../src/types/paperExperiment.js';
import { DATA_DIR, ensureDataDir } from './paths.js';

export const PAPER_EXPERIMENT_FILE = path.join(DATA_DIR, 'paper-experiments.json');

function assertLedger(value: unknown): asserts value is PaperExperimentLedger {
  const ledger = value as PaperExperimentLedger | null;
  if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.experiments)
    || !(ledger.lastRun === null || typeof ledger.lastRun === 'object')) {
    throw new Error('PAPER_LEDGER_INVALID: unsupported ledger structure');
  }
  const ids = new Set<string>();
  for (const experiment of ledger.experiments) {
    if (!experiment || typeof experiment.id !== 'string' || ids.has(experiment.id)
      || !/^\d{6}$/.test(experiment.symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(experiment.tradingDate)
      || !Number.isFinite(Date.parse(experiment.entryAt))
      || !Number.isFinite(experiment.entryPrice) || experiment.entryPrice <= 0 || experiment.quantity !== 1
      || !['OPEN', 'COMPLETED'].includes(experiment.status) || !Array.isArray(experiment.outcomes)
      || !experiment.entryObservation || !Array.isArray(experiment.entryObservation.news)
      || !experiment.costModel || !['buyFeeRate', 'sellFeeRate', 'sellTaxRate', 'slippageRate']
        .every((key) => Number.isFinite(experiment.costModel[key as keyof typeof experiment.costModel]))) {
      throw new Error('PAPER_LEDGER_INVALID: invalid experiment record');
    }
    if (experiment.outcomes.some((item) => !item || ![1, 3, 5].includes(item.horizon)
      || !Number.isFinite(item.netReturnPct) || !Number.isFinite(item.netPnl)
      || !Number.isFinite(item.exitPrice) || item.exitPrice <= 0)) {
      throw new Error('PAPER_LEDGER_INVALID: invalid outcome record');
    }
    ids.add(experiment.id);
  }
}

export function loadPaperExperimentLedger(): PaperExperimentLedger {
  if (!fs.existsSync(PAPER_EXPERIMENT_FILE)) return { schemaVersion: 1, experiments: [], lastRun: null };
  try {
    const ledger: unknown = JSON.parse(fs.readFileSync(PAPER_EXPERIMENT_FILE, 'utf8'));
    assertLedger(ledger);
    return ledger;
  } catch (error) {
    throw new Error(`PAPER_LEDGER_UNREADABLE: ${PAPER_EXPERIMENT_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function savePaperExperimentLedger(ledger: PaperExperimentLedger): void {
  assertLedger(ledger);
  // Never replace a damaged on-disk ledger with an empty reconstruction.
  loadPaperExperimentLedger();
  ensureDataDir();
  const temporary = `${PAPER_EXPERIMENT_FILE}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify(ledger, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, PAPER_EXPERIMENT_FILE);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
