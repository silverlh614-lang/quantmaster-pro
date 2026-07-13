// @responsibility Attribution Evidence Ledger monthly persistence with evidenceId upsert.

import fs from 'fs';
import { createHash } from 'crypto';
import {
  attributionEvidenceLedgerFile,
  ensureAttributionEvidenceLedgerDir,
} from './paths.js';
import {
  resolveAttributionEligibility,
  type ResolveAttributionEligibilityInput,
} from '../learning/attributionEligibilityResolver.js';
import type {
  AttributionEvidenceRecord,
  AttributionSampleSource,
} from '../learning/attributionEvidenceTypes.js';

export type AttributionEvidenceUpsertInput =
  Omit<AttributionEvidenceRecord, 'evidenceId' | 'eligibility' | 'createdAt' | 'updatedAt' | 'auditTags'>
  & Partial<Pick<AttributionEvidenceRecord, 'evidenceId' | 'eligibility' | 'createdAt' | 'updatedAt' | 'auditTags'>>;

function safeSegment(value: unknown, fallback: string): string {
  const text = String(value ?? fallback).trim();
  return (text.length > 0 ? text : fallback).replace(/[^A-Za-z0-9_.:-]/g, '_');
}

function evidenceHash(parts: unknown[]): string {
  return createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 16);
}

function generateAttributionEvidenceId(input: {
  tradeDate?: string;
  symbol?: string;
  source: AttributionSampleSource;
  signalId?: string;
  positionId?: string;
  shadowPositionId?: string;
  counterfactualId?: string;
  blockedReason?: string;
  engineMode?: string;
}): string {
  const tradeDate = safeSegment(input.tradeDate, 'NO_DATE');
  const symbol = safeSegment(input.symbol, 'NO_SYMBOL');
  let parts: unknown[];

  if (input.source === 'LIVE') {
    parts = [input.tradeDate, input.symbol, input.positionId, input.signalId, input.source];
  } else if (input.source === 'SHADOW') {
    parts = [input.tradeDate, input.symbol, input.shadowPositionId, input.signalId, input.source];
  } else if (input.source === 'COUNTERFACTUAL') {
    parts = [input.tradeDate, input.symbol, input.counterfactualId, input.signalId, input.source];
  } else if (input.source === 'BLOCKED') {
    parts = [input.tradeDate, input.symbol, input.signalId, input.blockedReason, input.engineMode, input.source];
  } else {
    parts = [input.tradeDate, input.symbol, input.signalId, input.positionId, input.blockedReason, input.engineMode, input.source];
  }

  return `${input.source}:${tradeDate}:${symbol}:${evidenceHash(parts)}`;
}

function monthFromTradeDate(tradeDate: string | undefined): string {
  return /^\d{4}-\d{2}/.test(tradeDate ?? '') ? tradeDate!.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

function legacyWinLossFromCanonical(
  input: Pick<AttributionEvidenceRecord, 'canonicalOutcome' | 'winRateBucket'>,
): AttributionEvidenceRecord['winLoss'] | undefined {
  if (input.winRateBucket === 'WIN_FULL') return 'WIN';
  if (input.winRateBucket === 'WIN_PARTIAL') return 'PARTIAL_WIN';
  if (input.winRateBucket === 'BREAKEVEN') return 'BREAKEVEN';
  if (input.winRateBucket === 'LOSS') return 'LOSS';
  if (input.winRateBucket === 'EXCLUDED') return 'INVALID';
  if (
    input.canonicalOutcome === 'FULL_WIN'
    || input.canonicalOutcome === 'FORCED_EXIT_WIN'
  ) return 'WIN';
  if (
    input.canonicalOutcome === 'PARTIAL_WIN'
    || input.canonicalOutcome === 'PARTIAL_WIN_BREAKEVEN'
  ) return 'PARTIAL_WIN';
  if (
    input.canonicalOutcome === 'BREAKEVEN'
    || input.canonicalOutcome === 'FORCED_EXIT_BREAKEVEN'
  ) return 'BREAKEVEN';
  if (
    input.canonicalOutcome === 'FULL_LOSS'
    || input.canonicalOutcome === 'PARTIAL_LOSS'
    || input.canonicalOutcome === 'FORCED_EXIT_LOSS'
  ) return 'LOSS';
  if (input.canonicalOutcome === 'PENDING') return 'PENDING';
  if (input.canonicalOutcome === 'INVALID') return 'INVALID';
  return undefined;
}

export function loadAttributionEvidenceForMonth(month: string): AttributionEvidenceRecord[] {
  ensureAttributionEvidenceLedgerDir();
  const file = attributionEvidenceLedgerFile(month);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed as AttributionEvidenceRecord[] : [];
  } catch {
    return [];
  }
}

export function saveAttributionEvidenceForMonth(month: string, records: AttributionEvidenceRecord[]): void {
  ensureAttributionEvidenceLedgerDir();
  fs.writeFileSync(attributionEvidenceLedgerFile(month), JSON.stringify(records, null, 2));
}

export function upsertAttributionEvidenceRecord(
  input: AttributionEvidenceUpsertInput,
  resolverInput: Partial<ResolveAttributionEligibilityInput> = {},
): AttributionEvidenceRecord {
  const month = monthFromTradeDate(input.tradeDate);
  const now = new Date().toISOString();
  const records = loadAttributionEvidenceForMonth(month);
  const evidenceId = input.evidenceId ?? generateAttributionEvidenceId(input);
  const previous = records.find((record) => record.evidenceId === evidenceId);
  const candidate: AttributionEvidenceRecord = {
    ...input,
    evidenceId,
    winLoss: input.winLoss ?? legacyWinLossFromCanonical(input),
    eligibility: input.eligibility ?? 'EXCLUDED',
    createdAt: previous?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
    auditTags: input.auditTags ?? [],
  };
  const eligibility = resolveAttributionEligibility({ ...candidate, ...resolverInput });
  const next: AttributionEvidenceRecord = { ...candidate, eligibility };
  const nextRecords = previous
    ? records.map((record) => record.evidenceId === evidenceId ? next : record)
    : [...records, next];

  saveAttributionEvidenceForMonth(month, nextRecords);
  console.log(
    `[ATTRIBUTION_EVIDENCE_RECORDED] evidenceId=${next.evidenceId} symbol=${next.symbol} source=${next.source} `
    + `eligibility=${next.eligibility} outcomeStatus=${next.outcomeStatus} executionStatus=${next.executionStatus} `
    + `engineMode=${next.engineMode} dataConfidence=${next.dataConfidence} conditionKeys=${next.conditionKeys.join(',')} `
    + `blockedReason=${next.blockedReason ?? ''} executionImpact=${next.executionImpact ?? ''} auditTags=${next.auditTags.join(',')}`,
  );
  return next;
}
