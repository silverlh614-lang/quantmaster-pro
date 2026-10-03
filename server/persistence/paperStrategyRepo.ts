// @responsibility Persist independent empirical Shadow strategy records.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperStrategyLedger } from '../../src/types/paperStrategy.js';
import { DATA_DIR, ensureDataDir } from './paths.js';
import { assertPaperStrategyLedger } from '../trading/paper/paperStrategyValidation.js';
import { paperEvidenceDigest } from '../trading/paper/paperStrategyEvidence.js';

export const PAPER_STRATEGY_FILE = path.join(DATA_DIR, 'paper-strategy.json');
/** Write-once migration copy of full evidence ID lists found on disk; never read on the scan path. */
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
    if (!evidence || evidence.experimentIds === undefined) continue;
    if (!Array.isArray(evidence.experimentIds)) throw new Error('PAPER_STRATEGY_INVALID: invalid legacy evidence IDs');
    const ids = evidence.experimentIds as unknown[];
    // Reject malformed lists even when a digest exists, before any IDs can be lost on the next write.
    if (ids.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length
      || ids.length !== evidence.sampleCount) throw new Error('PAPER_STRATEGY_INVALID: invalid legacy evidence IDs');
    const digest = paperEvidenceDigest(ids as string[]);
    if (evidence.experimentIdsDigest !== undefined && evidence.experimentIdsDigest !== digest) {
      throw new Error('PAPER_STRATEGY_INVALID: inconsistent legacy evidence digest');
    }
    lists.set(digest, [...(ids as string[])].sort());
    evidence.experimentIdsDigest = digest;
    delete evidence.experimentIds;
  }
  return lists;
}

/** Only called after validation, while full training/validation lists can still be checked for overlap. */
function compactAdaptiveEvidence(ledger: PaperStrategyLedger, preserveLists = false): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  const decisions = [...ledger.latestDecisions, ...ledger.trades.flatMap(trade => [trade.entryDecision, trade.exit?.decision])];
  const candidates = [...(ledger.adaptive?.candidates ?? []),
    ...decisions.flatMap(decision => decision?.adaptiveEvidence ? [decision.adaptiveEvidence.candidate] : [])];
  for (const candidate of candidates) for (const stats of [candidate.training, candidate.validation]) {
    if (!stats.experimentIds) continue;
    const digest = paperEvidenceDigest(stats.experimentIds);
    if (preserveLists) lists.set(digest, [...stats.experimentIds].sort());
    stats.experimentIdsDigest = digest;
    delete stats.experimentIds;
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
  if (archive?.schemaVersion !== 1 || !archive.lists || typeof archive.lists !== 'object' || Array.isArray(archive.lists)) {
    throw new Error('PAPER_STRATEGY_EVIDENCE_ARCHIVE_INVALID: legacy evidence lists were kept in the ledger');
  }
  for (const [digest] of lists) {
    const existing = archive.lists[digest];
    if (existing !== undefined && (!Array.isArray(existing) || existing.some(id => typeof id !== 'string' || !id.trim())
      || new Set(existing).size !== existing.length || paperEvidenceDigest(existing) !== digest)) {
      throw new Error('PAPER_STRATEGY_EVIDENCE_ARCHIVE_INVALID: legacy evidence lists were kept in the ledger');
    }
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
    compactAdaptiveEvidence(value);
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
      for (const [digest, ids] of compactAdaptiveEvidence(current, true)) legacy.set(digest, ids);
    } catch (error) {
      throw new Error(`PAPER_STRATEGY_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`);
    }
    preserveLegacyEvidence(legacy);
  }
  // Fresh adaptive IDs are recoverable from the baseline ledger and cutoff; do not duplicate them in the archive.
  const compact = structuredClone(ledger);
  compactLegacyEvidence(compact);
  compactAdaptiveEvidence(compact);
  assertPaperStrategyLedger(compact);
  // Compact JSON: indentation roughly doubled the size of a file rewritten every minute.
  writeAtomically(PAPER_STRATEGY_FILE, JSON.stringify(compact));
}
