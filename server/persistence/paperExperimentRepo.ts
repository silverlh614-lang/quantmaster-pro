// @responsibility Persist paper experiments: open records hot, completed records in monthly files, last run apart.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperExperiment, PaperExperimentLedger } from '../../src/types/paperExperiment.js';
import { DATA_DIR, ensureDataDir } from './paths.js';

/** Open experiments. Before ADR-0681 it held every experiment and is still read as such. */
export const PAPER_EXPERIMENT_FILE = path.join(DATA_DIR, 'paper-experiments.json');
/** The per-minute scan summary; tiny, so it is the only file rewritten every scan. */
export const PAPER_EXPERIMENT_RUN_FILE = path.join(DATA_DIR, 'paper-experiments-run.json');
const COMPLETED_FILE = /^paper-experiments-completed-(\d{4}-\d{2})\.json$/;
const completedFile = (month: string) => path.join(DATA_DIR, `paper-experiments-completed-${month}.json`);

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

// Parsed files are reused until their size or mtime changes; records are shared and never mutated in place.
const files = new Map<string, { stamp: string; value: unknown }>();
let merged: { stamp: string; ledger: PaperExperimentLedger } | null = null;
const stampOf = (file: string) => { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`; };

function readFile(file: string): { stamp: string; value: unknown } {
  const stamp = stampOf(file);
  const cached = files.get(file);
  if (cached?.stamp === stamp) return cached;
  const entry = { stamp, value: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown };
  files.set(file, entry);
  return entry;
}

function completedFiles(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((name) => COMPLETED_FILE.test(name)).sort().map((name) => path.join(DATA_DIR, name));
}

function experimentsIn(value: unknown, file: string): PaperExperiment[] {
  const rows = (value as { schemaVersion?: unknown; experiments?: unknown } | null);
  if (rows?.schemaVersion !== 1 || !Array.isArray(rows.experiments)) throw new Error(`PAPER_LEDGER_INVALID: ${path.basename(file)}`);
  return rows.experiments as PaperExperiment[];
}

export function loadPaperExperimentLedger(): PaperExperimentLedger {
  try {
    const sources = [PAPER_EXPERIMENT_FILE, PAPER_EXPERIMENT_RUN_FILE, ...completedFiles()].filter((file) => fs.existsSync(file));
    const entries = sources.map((file) => [file, readFile(file)] as const);
    const stamp = entries.map(([file, entry]) => `${file}=${entry.stamp}`).join('|');
    if (merged?.stamp !== stamp) {
      const byId = new Map<string, PaperExperiment>();
      let lastRun: PaperExperimentLedger['lastRun'] = null;
      let runFile: PaperExperimentLedger['lastRun'] | undefined;
      for (const [file, entry] of entries) {
        if (file === PAPER_EXPERIMENT_RUN_FILE) {
          const value = entry.value as { schemaVersion?: unknown; lastRun?: unknown } | null;
          if (value?.schemaVersion !== 1 || !(value.lastRun === null || typeof value.lastRun === 'object')) {
            throw new Error('PAPER_LEDGER_INVALID: paper-experiments-run.json');
          }
          runFile = value.lastRun as PaperExperimentLedger['lastRun'];
          continue;
        }
        if (file === PAPER_EXPERIMENT_FILE) lastRun = (entry.value as PaperExperimentLedger | null)?.lastRun ?? null;
      }
      // Completed files win over the open file: a crash between the two writes can leave an older OPEN copy.
      for (const [file, entry] of entries) {
        if (file === PAPER_EXPERIMENT_FILE || file === PAPER_EXPERIMENT_RUN_FILE) continue;
        for (const experiment of experimentsIn(entry.value, file)) {
          if (byId.has(experiment.id)) throw new Error('PAPER_LEDGER_INVALID: duplicate completed experiment');
          byId.set(experiment.id, experiment);
        }
      }
      const hot = entries.find(([file]) => file === PAPER_EXPERIMENT_FILE);
      if (hot) for (const experiment of experimentsIn(hot[1].value, PAPER_EXPERIMENT_FILE)) {
        if (!byId.has(experiment?.id)) byId.set(experiment?.id, experiment);
      }
      const ledger: PaperExperimentLedger = { schemaVersion: 1, lastRun: runFile !== undefined ? runFile : lastRun,
        experiments: [...byId.values()].sort((a, b) => a.entryAt.localeCompare(b.entryAt) || a.id.localeCompare(b.id)) };
      assertLedger(ledger);
      merged = { stamp, ledger };
    }
    return { ...merged.ledger, experiments: [...merged.ledger.experiments] };
  } catch (error) {
    merged = null;
    throw new Error(`PAPER_LEDGER_UNREADABLE: ${PAPER_EXPERIMENT_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeAtomically(file: string, value: unknown): void {
  ensureDataDir();
  const temporary = `${file}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify(value), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  files.set(file, { stamp: stampOf(file), value });
}

const sameRecords = (left: PaperExperiment[], right: PaperExperiment[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

/**
 * Completed experiments never change, so they move to monthly files written only when a record is new or changed.
 * The open file is rewritten only when an open record changes; the per-minute summary goes to its own small file.
 */
export function savePaperExperimentLedger(ledger: PaperExperimentLedger): void {
  assertLedger(ledger);
  // Never replace a damaged on-disk ledger with an empty reconstruction.
  loadPaperExperimentLedger();
  const order = (a: PaperExperiment, b: PaperExperiment) => a.entryAt.localeCompare(b.entryAt) || a.id.localeCompare(b.id);
  const months = new Map<string, PaperExperiment[]>();
  for (const experiment of ledger.experiments) {
    if (experiment.status !== 'COMPLETED') continue;
    const month = experiment.tradingDate.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), experiment]);
  }
  const known = new Set(ledger.experiments.map((item) => item.id));
  for (const [month, records] of months) {
    const file = completedFile(month);
    const stored = fs.existsSync(file) ? experimentsIn(readFile(file).value, file) : [];
    // Records are append-only: anything already stored but absent from this ledger is kept, not dropped.
    const next = [...records, ...stored.filter((item) => !known.has(item.id))].sort(order);
    if (!sameRecords(next, stored)) writeAtomically(file, { schemaVersion: 1, month, experiments: next });
  }
  const open = ledger.experiments.filter((item) => item.status !== 'COMPLETED').sort(order);
  const hot = fs.existsSync(PAPER_EXPERIMENT_FILE) ? readFile(PAPER_EXPERIMENT_FILE).value as PaperExperimentLedger : null;
  if (!hot || !sameRecords(open, hot.experiments)) {
    writeAtomically(PAPER_EXPERIMENT_FILE, { schemaVersion: 1, experiments: open, lastRun: ledger.lastRun });
  }
  const run = fs.existsSync(PAPER_EXPERIMENT_RUN_FILE) ? (readFile(PAPER_EXPERIMENT_RUN_FILE).value as { lastRun?: unknown }).lastRun : undefined;
  if (JSON.stringify(run ?? null) !== JSON.stringify(ledger.lastRun)) {
    writeAtomically(PAPER_EXPERIMENT_RUN_FILE, { schemaVersion: 1, lastRun: ledger.lastRun });
  }
}
