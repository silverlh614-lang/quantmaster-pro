// @responsibility Provisional shadow ledger persistence via shadow persistence gateway.

import * as fs from 'fs';
import { PROVISIONAL_SHADOW_LEDGER_FILE } from './paths.js';
import { readShadowJson, writeShadowJson } from './shadow/shadowPersistenceGateway.js';
import { deleteShadowPersistenceFallback } from './shadow/shadowPersistenceFallbackStore.js';
import type {
  ProvisionalShadowCandidate,
  ProvisionalShadowLabel,
  ProvisionalShadowReason,
} from '../trading/signalScanner/provisionalShadowLane.js';

export const PROVISIONAL_SHADOW_LEDGER_MAX = 2000;

export interface ProvisionalShadowLedgerEntry {
  eventType: 'PROVISIONAL_SHADOW_ENTRY';
  provisional: true;
  source: 'ADR-0426';
  symbol: string;
  name?: string;
  scanId?: string;
  scannedAtKst?: string;
  createdAtKst: string;
  /**
   * ADR-0617 — measurement entry reference price at provisional-shadow record time.
   * Optional/additive: legacy entries without this field stay INSUFFICIENT_DATA (소급 0).
   * `liveAllowed: false` 유지 — 측정 기준가일 뿐 LIVE 진입가 아님.
   */
  entryPrice?: number;
  /** ADR-0617 — entryPrice 출처. KIS_CURRENT = buyListLoop currentPrice (실진입 게이트 동일 소스, ADR-0561 정합). */
  entryPriceSource?: 'KIS_CURRENT' | 'SCAN_SNAPSHOT';
  label: ProvisionalShadowLabel;
  reasons: ProvisionalShadowReason[];
  regime: 'R3_EARLY';
  gate1Passed: boolean;
  gate2Passed: boolean;
  liveAllowed: false;
  shadowAllowed: true;
  routerSeverity?: string;
  lastSeenAt?: string;
  lastReason?: ProvisionalShadowReason;
  latestGateSnapshot?: { gate1Passed: boolean; gate2Passed: boolean; routerSeverity?: string };
  latestLaneLabel?: ProvisionalShadowLabel;
  duplicateSeenCount?: number;
  providerDegradedReason?: string;
  gate2NotConfirmedReason?: string;
  metadata?: {
    sectorEnergyDataQuality?: string;
    sectorEnergyConfidence?: number;
    sectorEnergyIndexCodeCoverage?: number;
    sectorEnergyRepairStatus?: string;
    unavailableConditions?: string[];
    failedTechnicalConditions?: string[];
    routerReasons?: string[];
  };
}

interface LedgerFile {
  version: 1;
  entries: ProvisionalShadowLedgerEntry[];
}

function isLedgerFile(data: unknown): data is LedgerFile {
  const parsed = data as Partial<LedgerFile> | null;
  return Boolean(parsed && typeof parsed === 'object' && Array.isArray(parsed.entries));
}

function readLedgerFile(): LedgerFile {
  const result = readShadowJson<LedgerFile>({
    source: 'ProvisionalShadowLedger',
    filePath: PROVISIONAL_SHADOW_LEDGER_FILE,
    emptyValue: { version: 1, entries: [] },
    validate: isLedgerFile,
  });
  if (result.kind === 'SUCCESS' || result.kind === 'DEGRADED_FALLBACK') return result.data;
  return { version: 1, entries: [] };
}

function atomicWrite(file: LedgerFile): boolean {
  const result = writeShadowJson({
    source: 'ProvisionalShadowLedger',
    filePath: PROVISIONAL_SHADOW_LEDGER_FILE,
    data: file,
  });
  return result.kind === 'SUCCESS';
}

export function buildDedupKey(scanId: string | undefined, symbol: string, nowKst?: string): string {
  if (scanId) return `${scanId}:${symbol}:ADR-0426`;
  const ts = nowKst ?? new Date().toISOString();
  const yyyymmddhhmm = ts.replace(/[^0-9]/g, '').slice(0, 12);
  return `${yyyymmddhhmm}:${symbol}:ADR-0426`;
}

export function hasExistingEntry(scanId: string | undefined, symbol: string): boolean {
  const file = readLedgerFile();
  const key = buildDedupKey(scanId, symbol);
  for (const entry of file.entries) {
    if (buildDedupKey(entry.scanId, entry.symbol) === key) return true;
  }
  return false;
}

export function loadProvisionalShadowLedger(): ProvisionalShadowLedgerEntry[] {
  return readLedgerFile().entries;
}

export function __resetProvisionalShadowLedgerForTests(): void {
  deleteShadowPersistenceFallback('ProvisionalShadowLedger');
  if (fs.existsSync(PROVISIONAL_SHADOW_LEDGER_FILE)) {
    fs.unlinkSync(PROVISIONAL_SHADOW_LEDGER_FILE);
  }
}

export function isProvisionalShadowLedgerDisabled(): boolean {
  return process.env.PROVISIONAL_SHADOW_LEDGER_DISABLED === 'true';
}

export interface RecordProvisionalShadowInput {
  candidate: ProvisionalShadowCandidate;
  scanId?: string;
  scannedAtKst?: string;
  metadata?: ProvisionalShadowLedgerEntry['metadata'];
}

export type RecordProvisionalShadowResult =
  | { recorded: true; entry: ProvisionalShadowLedgerEntry; queued?: boolean }
  | { recorded: false; updated: true; reason: 'DUPLICATE'; entry: ProvisionalShadowLedgerEntry; queued?: boolean }
  | { recorded: false; reason: 'ENV_DISABLED' | 'PERSIST_ERROR' };

function gate2NotConfirmedReason(candidate: ProvisionalShadowCandidate): string {
  if (candidate.reasons.includes('PRE_BREAKOUT_WAIT')) return 'PRE_BREAKOUT_WAIT';
  if (candidate.reasons.includes('DATA_UNAVAILABLE')) return 'DATA_UNAVAILABLE';
  return 'GATE2_NOT_CONFIRMED';
}

function buildEntry(input: RecordProvisionalShadowInput, nowIso: string): ProvisionalShadowLedgerEntry {
  return {
    eventType: 'PROVISIONAL_SHADOW_ENTRY',
    provisional: true,
    source: 'ADR-0426',
    symbol: input.candidate.symbol,
    ...(input.candidate.name !== undefined ? { name: input.candidate.name } : {}),
    ...(input.scanId !== undefined ? { scanId: input.scanId } : {}),
    ...(input.scannedAtKst !== undefined ? { scannedAtKst: input.scannedAtKst } : {}),
    createdAtKst: input.candidate.createdAtKst ?? nowIso,
    // ADR-0617 — measurement entryPrice/source additive stamp (candidate 에서만, 소급 backfill 0).
    ...(input.candidate.entryPrice !== undefined ? { entryPrice: input.candidate.entryPrice } : {}),
    ...(input.candidate.entryPriceSource !== undefined ? { entryPriceSource: input.candidate.entryPriceSource } : {}),
    label: input.candidate.label,
    reasons: input.candidate.reasons,
    regime: 'R3_EARLY',
    gate1Passed: input.candidate.gate1Passed,
    gate2Passed: input.candidate.gate2Passed,
    liveAllowed: false,
    shadowAllowed: true,
    ...(input.candidate.routerSeverity !== undefined ? { routerSeverity: input.candidate.routerSeverity } : {}),
    lastSeenAt: input.scannedAtKst ?? nowIso,
    lastReason: input.candidate.reasons[input.candidate.reasons.length - 1],
    latestGateSnapshot: {
      gate1Passed: input.candidate.gate1Passed,
      gate2Passed: input.candidate.gate2Passed,
      ...(input.candidate.routerSeverity !== undefined ? { routerSeverity: input.candidate.routerSeverity } : {}),
    },
    latestLaneLabel: input.candidate.label,
    duplicateSeenCount: 0,
    providerDegradedReason: input.metadata?.unavailableConditions?.join(','),
    gate2NotConfirmedReason: gate2NotConfirmedReason(input.candidate),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };
}

export function recordR3ProvisionalShadowCandidate(
  input: RecordProvisionalShadowInput,
): RecordProvisionalShadowResult {
  if (isProvisionalShadowLedgerDisabled()) {
    return { recorded: false, reason: 'ENV_DISABLED' };
  }

  const nowIso = new Date().toISOString();
  const file = readLedgerFile();
  const key = buildDedupKey(input.scanId, input.candidate.symbol);
  const existing = file.entries.find((entry) => buildDedupKey(entry.scanId, entry.symbol) === key);
  if (existing) {
    existing.lastSeenAt = input.scannedAtKst ?? nowIso;
    existing.lastReason = input.candidate.reasons[input.candidate.reasons.length - 1];
    existing.latestGateSnapshot = {
      gate1Passed: input.candidate.gate1Passed,
      gate2Passed: input.candidate.gate2Passed,
      ...(input.candidate.routerSeverity !== undefined ? { routerSeverity: input.candidate.routerSeverity } : {}),
    };
    existing.latestLaneLabel = input.candidate.label;
    existing.duplicateSeenCount = (existing.duplicateSeenCount ?? 0) + 1;
    existing.providerDegradedReason = input.metadata?.unavailableConditions?.join(',') ?? existing.providerDegradedReason;
    existing.gate2NotConfirmedReason = gate2NotConfirmedReason(input.candidate);
    existing.metadata = { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) };
    const persisted = atomicWrite(file);
    return { recorded: false, updated: true, reason: 'DUPLICATE', entry: existing, ...(!persisted ? { queued: true } : {}) };
  }

  const entry = buildEntry(input, nowIso);
  file.entries.push(entry);
  if (file.entries.length > PROVISIONAL_SHADOW_LEDGER_MAX) {
    file.entries.splice(0, file.entries.length - PROVISIONAL_SHADOW_LEDGER_MAX);
  }
  const persisted = atomicWrite(file);
  return { recorded: true, entry, ...(!persisted ? { queued: true } : {}) };
}
