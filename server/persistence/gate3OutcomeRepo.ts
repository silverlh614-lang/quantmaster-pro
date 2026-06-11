// @responsibility Gate3 outcome ledger persistence; learning-only, no order/provider calls.

import fs from 'fs';
import { GATE3_OUTCOME_LEDGER_FILE, ensureDataDir } from './paths.js';
import { evictOutcomeSeedsWithMaturityPriority } from './outcomeLedgerEviction.js';
import {
  gate3OutcomeDuplicateKey,
  summarizeGate3OutcomeSeeds,
  type Gate3ForwardReturns,
  type Gate3OutcomeLabel,
  type Gate3OutcomeSeed,
  type Gate3OutcomeStatus,
  type Gate3OutcomeTrackingSummary,
} from '../quant/gate3OutcomeSeed.js';

interface Gate3OutcomeLedgerFile {
  version: 1;
  seeds: Gate3OutcomeSeed[];
}

export interface Gate3OutcomeUpsertResult {
  created: boolean;
  duplicateSuppressed: boolean;
  seed: Gate3OutcomeSeed;
}

export interface Gate3OutcomeBulkUpsertResult {
  created: number;
  duplicateSuppressed: number;
  seeds: Gate3OutcomeSeed[];
  summary: Gate3OutcomeTrackingSummary;
}

// 일일 기록 ~800행 기준 D10(10거래일≈14달력일) 성숙 커버 — 2026-06-11 retention 결함 진단 처방.
const MAX_GATE3_OUTCOME_SEEDS = 12_000;

function isLedgerFile(value: unknown): value is Gate3OutcomeLedgerFile {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as Gate3OutcomeLedgerFile).seeds));
}

function readLedger(filePath = GATE3_OUTCOME_LEDGER_FILE): Gate3OutcomeLedgerFile {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return { version: 1, seeds: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isLedgerFile(parsed) ? parsed : { version: 1, seeds: [] };
  } catch {
    return { version: 1, seeds: [] };
  }
}

function writeLedger(file: Gate3OutcomeLedgerFile, filePath = GATE3_OUTCOME_LEDGER_FILE): void {
  ensureDataDir();
  const trimmed = {
    version: 1 as const,
    // 성숙 우선 eviction — 미성숙(PENDING/PARTIAL) forward 증거 보존. compact 직렬화(대용량 IO 절감).
    seeds: evictOutcomeSeedsWithMaturityPriority(file.seeds, MAX_GATE3_OUTCOME_SEEDS),
  };
  fs.writeFileSync(filePath, JSON.stringify(trimmed));
}

export function loadGate3OutcomeSeeds(filePath = GATE3_OUTCOME_LEDGER_FILE): Gate3OutcomeSeed[] {
  return readLedger(filePath).seeds;
}

export function upsertGate3OutcomeSeed(
  seed: Gate3OutcomeSeed,
  filePath = GATE3_OUTCOME_LEDGER_FILE,
): Gate3OutcomeUpsertResult {
  const file = readLedger(filePath);
  const key = gate3OutcomeDuplicateKey(seed);
  const existing = file.seeds.find((item) => gate3OutcomeDuplicateKey(item) === key);
  if (existing) {
    return { created: false, duplicateSuppressed: true, seed: existing };
  }
  file.seeds.push(seed);
  writeLedger(file, filePath);
  return { created: true, duplicateSuppressed: false, seed };
}

export function upsertGate3OutcomeSeeds(
  seeds: readonly Gate3OutcomeSeed[],
  input: { filePath?: string; tradeDate?: string } = {},
): Gate3OutcomeBulkUpsertResult {
  let created = 0;
  let duplicateSuppressed = 0;
  for (const seed of seeds) {
    const result = upsertGate3OutcomeSeed(seed, input.filePath);
    if (result.created) created += 1;
    if (result.duplicateSuppressed) duplicateSuppressed += 1;
  }
  const all = loadGate3OutcomeSeeds(input.filePath);
  return {
    created,
    duplicateSuppressed,
    seeds: all,
    summary: summarizeGate3OutcomeSeeds(all, {
      tradeDate: input.tradeDate,
      seedCreatedToday: created,
      duplicateSuppressed,
    }),
  };
}

export function listPendingGate3Outcomes(filePath = GATE3_OUTCOME_LEDGER_FILE): Gate3OutcomeSeed[] {
  return loadGate3OutcomeSeeds(filePath).filter((seed) => seed.outcomeStatus === 'PENDING' || seed.outcomeStatus === 'PARTIAL');
}

function updateSeed(
  id: string,
  updater: (seed: Gate3OutcomeSeed) => Gate3OutcomeSeed,
  filePath = GATE3_OUTCOME_LEDGER_FILE,
): Gate3OutcomeSeed | null {
  const file = readLedger(filePath);
  const index = file.seeds.findIndex((seed) => seed.id === id);
  if (index < 0) return null;
  file.seeds[index] = updater(file.seeds[index]);
  writeLedger(file, filePath);
  return file.seeds[index];
}

export function updateGate3ForwardReturns(
  id: string,
  returns: Partial<Gate3ForwardReturns>,
  filePath = GATE3_OUTCOME_LEDGER_FILE,
): Gate3OutcomeSeed | null {
  return updateSeed(id, (seed) => ({
    ...seed,
    forwardReturns: {
      ...seed.forwardReturns,
      ...returns,
    },
    outcomeStatus: 'PARTIAL',
    marketSignal: false,
    providerIssue: false,
  }), filePath);
}

/**
 * 전체 seed 교체 — forwardReturns 만이 아니라 labeler 가 계산한 maxForwardReturnPct /
 * outcomeStatus / outcomeLabel 등 모든 갱신 필드를 그대로 영속한다. id 미존재 시 null.
 * marketSignal/providerIssue 는 학습 불변식상 항상 false 로 고정 (9대 불변식 #6).
 */
export function persistGate3OutcomeSeed(
  seed: Gate3OutcomeSeed,
  filePath = GATE3_OUTCOME_LEDGER_FILE,
): Gate3OutcomeSeed | null {
  return updateSeed(seed.id, () => ({
    ...seed,
    marketSignal: false,
    providerIssue: false,
  }), filePath);
}

export function labelGate3Outcome(
  id: string,
  label: Gate3OutcomeLabel,
  status: Gate3OutcomeStatus = 'LABELED',
  filePath = GATE3_OUTCOME_LEDGER_FILE,
): Gate3OutcomeSeed | null {
  return updateSeed(id, (seed) => ({
    ...seed,
    outcomeLabel: label,
    outcomeStatus: status,
    marketSignal: false,
    providerIssue: false,
  }), filePath);
}

export function findBySymbolAndSnapshot(
  symbol: string,
  sourceSnapshotId: string,
  filePath = GATE3_OUTCOME_LEDGER_FILE,
): Gate3OutcomeSeed[] {
  return loadGate3OutcomeSeeds(filePath).filter((seed) =>
    seed.symbol === symbol && seed.sourceSnapshotId === sourceSnapshotId,
  );
}

export function summarizeGate3OutcomeLedger(
  input: { filePath?: string; tradeDate?: string; seedCreatedToday?: number; duplicateSuppressed?: number } = {},
): Gate3OutcomeTrackingSummary {
  return summarizeGate3OutcomeSeeds(loadGate3OutcomeSeeds(input.filePath), {
    tradeDate: input.tradeDate,
    seedCreatedToday: input.seedCreatedToday,
    duplicateSuppressed: input.duplicateSuppressed,
  });
}

export function __resetGate3OutcomeLedgerForTests(filePath = GATE3_OUTCOME_LEDGER_FILE): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
