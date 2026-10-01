// @responsibility Persist independent empirical Shadow strategy records.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperStrategyLedger } from '../../src/types/paperStrategy.js';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { assertPaperStrategyLedger } from '../trading/paper/paperStrategyValidation.js';
import { paperEvidenceDigest } from '../trading/paper/paperStrategyEvidence.js';

export const PAPER_STRATEGY_FILE = path.join(DATA_DIR, 'paper-strategy.json');
/** Write-once copy of evidence ID lists stored before ADR-0680; never read on the scan path. */
export const PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE = path.join(DATA_DIR, 'paper-strategy-evidence-archive.json');

type Raw = Record<string, any>;

/** Replaces pre-ADR-0680 full ID lists with their digest in place and returns the unique lists by digest. */
function compactLegacyEvidence(value: unknown): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  const ledger = value as Raw | null;
  if (!ledger || typeof ledger !== 'object') return lists;
  const decisions: unknown[] = [
    ...(Array.isArray(ledger.latestDecisions) ? ledger.latestDecisions : []),
    ...(Array.isArray(ledger.trades) ? ledger.trades.flatMap((trade: Raw) => [trade?.entryDecision, trade?.exit?.decision]) : []),
  ];
  for (const decision of decisions) {
    const evidence = (decision as Raw | null)?.evidence as Raw | null | undefined;
    if (!evidence || !Array.isArray(evidence.experimentIds) || evidence.experimentIdsDigest !== undefined) continue;
    const ids = evidence.experimentIds as unknown[];
    // A malformed legacy list is left in place so validation rejects it instead of hiding it behind a digest.
    if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length
      || ids.length !== evidence.sampleCount) continue;
    const digest = paperEvidenceDigest(ids as string[]);
    lists.set(digest, [...(ids as string[])].sort());
    evidence.experimentIdsDigest = digest;
    delete evidence.experimentIds;
  }
  return lists;
}

function writeAtomically(file: string, text: string): void {
  ensureDataDir();
  const temporary = `${file}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function preserveLegacyEvidence(lists: Map<string, string[]>): void {
  if (!lists.size) return;
  const archive: { schemaVersion: 1; lists: Record<string, string[]> } = fs.existsSync(PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE)
    ? JSON.parse(fs.readFileSync(PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, 'utf8')) : { schemaVersion: 1, lists: {} };
  if (archive?.schemaVersion !== 1 || !archive.lists || typeof archive.lists !== 'object') {
    throw new Error('PAPER_STRATEGY_EVIDENCE_ARCHIVE_INVALID: legacy evidence lists were kept in the ledger');
  }
  const missing = [...lists].filter(([digest]) => !Array.isArray(archive.lists[digest]));
  if (!missing.length) return;
  for (const [digest, ids] of missing) archive.lists[digest] = ids;
  writeAtomically(PAPER_STRATEGY_EVIDENCE_ARCHIVE_FILE, JSON.stringify(archive));
}

export function loadPaperStrategyLedger(): PaperStrategyLedger {
  if (!fs.existsSync(PAPER_STRATEGY_FILE)) return { schemaVersion: 1, trades: [], latestDecisions: [], lastRun: null };
  try {
    const value: unknown = JSON.parse(fs.readFileSync(PAPER_STRATEGY_FILE, 'utf8'));
    compactLegacyEvidence(value);
    assertPaperStrategyLedger(value);
    return value;
  } catch (error) {
    throw new Error(`PAPER_STRATEGY_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function savePaperStrategyLedger(ledger: PaperStrategyLedger): void {
  assertPaperStrategyLedger(ledger);
  if (fs.existsSync(PAPER_STRATEGY_FILE)) {
    // Never replace a damaged ledger, and keep any pre-ADR-0680 ID lists once before dropping them.
    let current: unknown;
    let legacy: Map<string, string[]>;
    try {
      current = JSON.parse(fs.readFileSync(PAPER_STRATEGY_FILE, 'utf8'));
      legacy = compactLegacyEvidence(current);
      assertPaperStrategyLedger(current);
    } catch (error) {
      throw new Error(`PAPER_STRATEGY_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`);
    }
    preserveLegacyEvidence(legacy);
  }
  // Compact JSON: indentation roughly doubled the size of a file rewritten every minute.
  writeAtomically(PAPER_STRATEGY_FILE, JSON.stringify(ledger));
}
