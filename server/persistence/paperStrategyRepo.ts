// @responsibility Persist independent empirical Shadow strategy records.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperStrategyLedger } from '../../src/types/paperStrategy.js';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { assertPaperStrategyLedger } from '../trading/paper/paperStrategyValidation.js';

export const PAPER_STRATEGY_FILE = path.join(DATA_DIR, 'paper-strategy.json');

export function loadPaperStrategyLedger(): PaperStrategyLedger {
  if (!fs.existsSync(PAPER_STRATEGY_FILE)) return { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null };
  try {
    const value: unknown = JSON.parse(fs.readFileSync(PAPER_STRATEGY_FILE, 'utf8'));
    assertPaperStrategyLedger(value);
    return value;
  } catch (error) {
    throw new Error(`PAPER_STRATEGY_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function savePaperStrategyLedger(ledger: PaperStrategyLedger): void {
  assertPaperStrategyLedger(ledger);
  loadPaperStrategyLedger();
  ensureDataDir();
  const temporary = `${PAPER_STRATEGY_FILE}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify(ledger, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, PAPER_STRATEGY_FILE);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
