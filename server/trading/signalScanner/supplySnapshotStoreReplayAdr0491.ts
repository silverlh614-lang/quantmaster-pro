// @responsibility ADR-0491 Supply Snapshot Store & Replay; diagnostic-only bounded sanitized JSON snapshots, no live Gate input.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type { FreshDataSupplyReportAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import type { SectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import type { InvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import type { ProgramTradingDataLineReportAdr0490 } from './programTradingDataLineAdr0490.js';
import type { InvestorFlowSanitizedSampleAdr0496, SupplyCoverageReportAdr0496 } from './investorFlowSemanticNetBuyAdr0496.js';

export type SupplySnapshotReplayModeAdr0491 = 'LATEST' | 'PREVIOUS_TRADING_DAY' | 'BY_SCAN_ID' | 'BY_DATE' | 'WINDOW';
export type SupplySnapshotStatusAdr0491 = 'RECORDED' | 'EMPTY' | 'REPLAY_READY' | 'REPLAY_UNAVAILABLE' | 'CORRUPT_RECOVERED';
export type SupplySnapshotCacheLookupStatusAdr0491 = 'CACHE_HIT' | 'STALE_HIT' | 'CACHE_EMPTY' | 'CORRUPT_RECOVERED';
export type SupplySnapshotDomainAdr0491 = 'SUPPLY' | 'SECTOR' | 'PROGRAM';

export interface SanitizedSupplySnapshotAdr0491 {
  scanId: string;
  recordedAt: string;
  tradingDate: string;
  domains: SupplySnapshotDomainAdr0491[];
  supplyStatus: string;
  sectorStatus: string;
  programStatus: string;
  providerIssue: boolean;
  marketSignal: boolean;
  sampleCounts: { supply: number; sector: number; program: number };
  latestInvestorFlowSample: Pick<InvestorFlowSanitizedSampleAdr0496, 'symbol' | 'provider' | 'dataDate' | 'foreignNetBuy' | 'institutionNetBuy' | 'retailNetBuy' | 'confidence' | 'status' | 'isProviderIssue' | 'isMarketSignal'> | null;
  adr0496SupplyCoverage: Pick<SupplyCoverageReportAdr0496, 'coverageBefore' | 'coverageAfter' | 'sampleCount' | 'normalizedSampleCount' | 'semanticNetBuyCount' | 'nullCount' | 'zeroCount' | 'missingCount' | 'providerIssueCount' | 'marketSignalCount'> | null;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'OBSERVE' | 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  rawProviderPayloadPersisted: false;
  diagnostics: string[];
}

export interface SupplySnapshotCacheLookupAdr0491 {
  status: SupplySnapshotCacheLookupStatusAdr0491;
  snapshot: SanitizedSupplySnapshotAdr0491 | null;
  cacheRaw: Record<string, unknown> | null;
  retained: number;
  reason: string;
  stale: boolean;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  rawPayloadPersistenceAllowed: false;
}

export interface SupplySnapshotStoreAdr0491 {
  version: 1;
  snapshots: SanitizedSupplySnapshotAdr0491[];
}

export interface BuildSupplySnapshotInputAdr0491 {
  scanId?: string;
  recordedAt?: string;
  tradingDate?: string;
  freshDataSupplyAdr0487?: FreshDataSupplyReportAdr0487 | null;
  sectorEnergySupplyUnknownAdr0488?: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null;
  investorFlowSampleAdr0489?: InvestorFlowSampleAcquisitionReportAdr0489 | null;
  programTradingAdr0490?: ProgramTradingDataLineReportAdr0490 | null;
  supplyCoverageReportAdr0496?: SupplyCoverageReportAdr0496 | null;
  diagnostics?: readonly string[];
}

export interface RecordSupplySnapshotInputAdr0491 extends BuildSupplySnapshotInputAdr0491 {
  filePath?: string;
  maxSnapshots?: number;
}

export interface ReplaySupplySnapshotRequestAdr0491 {
  mode: SupplySnapshotReplayModeAdr0491;
  scanId?: string;
  tradingDate?: string;
  fromDate?: string;
  toDate?: string;
  filePath?: string;
}

export interface SupplySnapshotReplayResultAdr0491 {
  status: SupplySnapshotStatusAdr0491;
  mode: SupplySnapshotReplayModeAdr0491;
  snapshots: SanitizedSupplySnapshotAdr0491[];
  retained: number;
  replayAvailable: boolean;
  diagnosticOnly: true;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SupplySnapshotComparisonAdr0491 {
  baselineScanId: string | null;
  candidateScanId: string | null;
  changedDomains: SupplySnapshotDomainAdr0491[];
  statusChanged: boolean;
  providerIssueChanged: boolean;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  diagnosticOnly: true;
}

export const SUPPLY_SNAPSHOT_STORE_FILE_ADR0491 = path.join(DATA_DIR, 'supply-snapshot-store-adr0491.json');
const DEFAULT_MAX_SNAPSHOTS = 120;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function readStore(filePath = SUPPLY_SNAPSHOT_STORE_FILE_ADR0491): { store: SupplySnapshotStoreAdr0491; recovered: boolean } {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return { store: { version: 1, snapshots: [] }, recovered: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<SupplySnapshotStoreAdr0491> | SanitizedSupplySnapshotAdr0491[];
    if (Array.isArray(parsed)) return { store: { version: 1, snapshots: parsed }, recovered: false };
    if (parsed.version === 1 && Array.isArray(parsed.snapshots)) return { store: { version: 1, snapshots: parsed.snapshots }, recovered: false };
    return { store: { version: 1, snapshots: [] }, recovered: true };
  } catch {
    try { fs.renameSync(filePath, `${filePath}.corrupt.${Date.now()}`); } catch { /* best-effort recovery */ }
    return { store: { version: 1, snapshots: [] }, recovered: true };
  }
}

function writeStore(store: SupplySnapshotStoreAdr0491, filePath = SUPPLY_SNAPSHOT_STORE_FILE_ADR0491): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, filePath);
}

export function buildSanitizedSupplySnapshotAdr0491(
  input: BuildSupplySnapshotInputAdr0491 = {},
): SanitizedSupplySnapshotAdr0491 {
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const supplyStatus = input.investorFlowSampleAdr0489?.status ?? input.freshDataSupplyAdr0487?.overallStatus ?? 'UNKNOWN';
  const sectorStatus = input.sectorEnergySupplyUnknownAdr0488?.overallStatus ?? 'UNKNOWN';
  const programStatus = input.programTradingAdr0490?.status ?? 'UNKNOWN';
  const domains: SupplySnapshotDomainAdr0491[] = ['SUPPLY'];
  if (input.sectorEnergySupplyUnknownAdr0488) domains.push('SECTOR');
  if (input.programTradingAdr0490) domains.push('PROGRAM');
  const adr0496Coverage = input.supplyCoverageReportAdr0496 ?? input.investorFlowSampleAdr0489?.adr0496SupplyCoverage ?? null;
  const latestInvestorFlowSample = input.investorFlowSampleAdr0489?.adr0496SanitizedSamples
    .find((sample) => sample.symbol !== null) ?? null;
  const providerIssue = Boolean(
    input.sectorEnergySupplyUnknownAdr0488?.supplyUnknownPolicy.providerIssue === true ||
    input.investorFlowSampleAdr0489?.status === 'PROVIDER_ERROR' ||
    (adr0496Coverage?.providerIssueCount ?? 0) > 0 ||
    input.programTradingAdr0490?.status === 'PROVIDER_ERROR',
  );
  return {
    scanId: input.scanId ?? `scan-${recordedAt}`,
    recordedAt,
    tradingDate: input.tradingDate ?? recordedAt.slice(0, 10),
    domains,
    supplyStatus,
    sectorStatus,
    programStatus,
    providerIssue,
    marketSignal: false,
    sampleCounts: {
      supply: adr0496Coverage?.sampleCount ?? input.investorFlowSampleAdr0489?.samples.length ?? input.freshDataSupplyAdr0487?.snapshots.length ?? 0,
      sector: input.sectorEnergySupplyUnknownAdr0488 ? 1 : 0,
      program: input.programTradingAdr0490?.rows.length ?? 0,
    },
    latestInvestorFlowSample: latestInvestorFlowSample ? {
      symbol: latestInvestorFlowSample.symbol,
      provider: latestInvestorFlowSample.provider,
      dataDate: latestInvestorFlowSample.dataDate,
      foreignNetBuy: latestInvestorFlowSample.foreignNetBuy,
      institutionNetBuy: latestInvestorFlowSample.institutionNetBuy,
      retailNetBuy: latestInvestorFlowSample.retailNetBuy,
      confidence: latestInvestorFlowSample.confidence,
      status: latestInvestorFlowSample.status,
      isProviderIssue: latestInvestorFlowSample.isProviderIssue,
      isMarketSignal: latestInvestorFlowSample.isMarketSignal,
    } : null,
    adr0496SupplyCoverage: adr0496Coverage ? {
      coverageBefore: adr0496Coverage.coverageBefore,
      coverageAfter: adr0496Coverage.coverageAfter,
      sampleCount: adr0496Coverage.sampleCount,
      normalizedSampleCount: adr0496Coverage.normalizedSampleCount,
      semanticNetBuyCount: adr0496Coverage.semanticNetBuyCount,
      nullCount: adr0496Coverage.nullCount,
      zeroCount: adr0496Coverage.zeroCount,
      missingCount: adr0496Coverage.missingCount,
      providerIssueCount: adr0496Coverage.providerIssueCount,
      marketSignalCount: adr0496Coverage.marketSignalCount,
    } : null,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    rawProviderPayloadPersisted: false,
    diagnostics: [...(input.diagnostics ?? []), 'ADR-0491 sanitized snapshot excludes raw provider payloads.'],
  };
}

export function recordSupplySnapshotAdr0491(input: RecordSupplySnapshotInputAdr0491 = {}): SupplySnapshotReplayResultAdr0491 {
  const { store, recovered } = readStore(input.filePath);
  const snapshot = buildSanitizedSupplySnapshotAdr0491(input);
  const byScanId = new Map(store.snapshots.map((row) => [row.scanId, row]));
  byScanId.set(snapshot.scanId, snapshot);
  const maxSnapshots = input.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
  const snapshots = [...byScanId.values()]
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .slice(-maxSnapshots);
  writeStore({ version: 1, snapshots }, input.filePath);
  return {
    status: recovered ? 'CORRUPT_RECOVERED' : 'RECORDED',
    mode: 'LATEST',
    snapshots: [snapshot],
    retained: snapshots.length,
    replayAvailable: snapshots.length > 0,
    diagnosticOnly: true,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    diagnostics: recovered ? ['Corrupt JSON recovered before snapshot write.'] : [],
  };
}

export function replaySupplySnapshotsAdr0491(
  request: ReplaySupplySnapshotRequestAdr0491,
): SupplySnapshotReplayResultAdr0491 {
  const { store, recovered } = readStore(request.filePath);
  const snapshots = [...store.snapshots].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  let selected: SanitizedSupplySnapshotAdr0491[] = [];
  if (request.mode === 'LATEST') selected = snapshots.slice(-1);
  if (request.mode === 'PREVIOUS_TRADING_DAY') {
    const date = request.tradingDate ?? todayIso();
    selected = snapshots.filter((row) => row.tradingDate < date).slice(-1);
  }
  if (request.mode === 'BY_SCAN_ID') selected = snapshots.filter((row) => row.scanId === request.scanId);
  if (request.mode === 'BY_DATE') selected = snapshots.filter((row) => row.tradingDate === request.tradingDate);
  if (request.mode === 'WINDOW') {
    selected = snapshots.filter((row) =>
      (request.fromDate === undefined || row.tradingDate >= request.fromDate) &&
      (request.toDate === undefined || row.tradingDate <= request.toDate));
  }
  return {
    status: recovered ? 'CORRUPT_RECOVERED' : selected.length > 0 ? 'REPLAY_READY' : 'REPLAY_UNAVAILABLE',
    mode: request.mode,
    snapshots: selected,
    retained: snapshots.length,
    replayAvailable: selected.length > 0,
    diagnosticOnly: true,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    operatorApprovalRequired: true,
    diagnostics: recovered ? ['Corrupt JSON recovered; replay returned empty sanitized store.'] : [],
  };
}


function statusForCacheRaw(snapshot: SanitizedSupplySnapshotAdr0491, tradingDate?: string): SupplySnapshotCacheLookupStatusAdr0491 {
  if (tradingDate && snapshot.tradingDate !== tradingDate) return 'STALE_HIT';
  if (snapshot.latestInvestorFlowSample?.status === 'STALE') return 'STALE_HIT';
  return 'CACHE_HIT';
}

export function readLatestSupplySnapshotBySymbolSourceDomainAdr0491(input: {
  symbol: string;
  source?: string;
  domain?: SupplySnapshotDomainAdr0491;
  tradingDate?: string;
  filePath?: string;
}): SupplySnapshotCacheLookupAdr0491 {
  const { store, recovered } = readStore(input.filePath);
  if (recovered) {
    return {
      status: 'CORRUPT_RECOVERED',
      snapshot: null,
      cacheRaw: null,
      retained: 0,
      reason: 'CORRUPT_RECOVERED',
      stale: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      rawPayloadPersistenceAllowed: false,
    };
  }
  const domain = input.domain ?? 'SUPPLY';
  const source = input.source;
  const candidates = store.snapshots
    .filter((snapshot) => snapshot.domains.includes(domain))
    .filter((snapshot) => snapshot.latestInvestorFlowSample?.symbol === input.symbol)
    .filter((snapshot) => !source || snapshot.latestInvestorFlowSample?.provider === source)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const snapshot = candidates[0] ?? null;
  if (!snapshot?.latestInvestorFlowSample) {
    return {
      status: 'CACHE_EMPTY',
      snapshot: null,
      cacheRaw: null,
      retained: store.snapshots.length,
      reason: store.snapshots.length > 0 ? 'KEY_MISMATCH_OR_SYMBOL_SOURCE_NOT_FOUND' : 'SNAPSHOT_STORE_EMPTY',
      stale: false,
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      rawPayloadPersistenceAllowed: false,
    };
  }
  const latest = snapshot.latestInvestorFlowSample;
  const status = statusForCacheRaw(snapshot, input.tradingDate);
  return {
    status,
    snapshot,
    cacheRaw: {
      code: latest.symbol,
      sourceDate: latest.dataDate,
      foreignNetBuy: latest.foreignNetBuy,
      institutionNetBuy: latest.institutionNetBuy,
      retailNetBuy: latest.retailNetBuy,
      status: status === 'STALE_HIT' ? 'STALE' : latest.status === 'PARTIAL' || latest.status === 'FRESH' ? 'PARTIAL' : latest.status,
    },
    retained: store.snapshots.length,
    reason: status === 'STALE_HIT' ? 'STALE_SANITIZED_SNAPSHOT_HIT_OBSERVE_ONLY' : 'SANITIZED_SNAPSHOT_CACHE_HIT',
    stale: status === 'STALE_HIT',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    rawPayloadPersistenceAllowed: false,
  };
}

export function compareSupplySnapshotsAdr0491(
  baseline: SanitizedSupplySnapshotAdr0491 | null | undefined,
  candidate: SanitizedSupplySnapshotAdr0491 | null | undefined,
): SupplySnapshotComparisonAdr0491 {
  const changedDomains: SupplySnapshotDomainAdr0491[] = [];
  if (baseline && candidate) {
    if (baseline.supplyStatus !== candidate.supplyStatus) changedDomains.push('SUPPLY');
    if (baseline.sectorStatus !== candidate.sectorStatus) changedDomains.push('SECTOR');
    if (baseline.programStatus !== candidate.programStatus) changedDomains.push('PROGRAM');
  }
  return {
    baselineScanId: baseline?.scanId ?? null,
    candidateScanId: candidate?.scanId ?? null,
    changedDomains,
    statusChanged: changedDomains.length > 0,
    providerIssueChanged: Boolean(baseline && candidate && baseline.providerIssue !== candidate.providerIssue),
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    diagnosticOnly: true,
  };
}

export function summarizeSupplySnapshotStoreAdr0491(filePath = SUPPLY_SNAPSHOT_STORE_FILE_ADR0491): SupplySnapshotReplayResultAdr0491 {
  return replaySupplySnapshotsAdr0491({ mode: 'LATEST', filePath });
}

export function formatSupplySnapshotCompactAdr0491(result?: SupplySnapshotReplayResultAdr0491 | null): string {
  if (!result || result.retained === 0 || !result.replayAvailable) {
    return '🗄 ADR-0491 SupplySnapshot: EMPTY | replay=unavailable | impact=NONE\n   action: collect sanitized snapshots for 3 scans';
  }
  const domains = result.snapshots[0]?.domains.join('/') ?? 'SUPPLY/SECTOR/PROGRAM';
  return `🗄 ADR-0491 SupplySnapshot: ${result.status === 'RECORDED' ? 'RECORDED' : 'REPLAY_READY'} | retained=${result.retained} | domains=${domains} | impact=${result.executionImpact}`;
}

export function formatSupplySnapshotDetailAdr0491(result: SupplySnapshotReplayResultAdr0491): string {
  return [
    'supplySnapshotStore:',
    `ADR-0491 status=${result.status} retained=${result.retained} replayAvailable=${result.replayAvailable} diagnosticOnly=${result.diagnosticOnly} executionImpact=${result.executionImpact}`,
  ].join('\n');
}

export function buildSupplySnapshotObservationRowAdr0491(result: SupplySnapshotReplayResultAdr0491) {
  const latest = result.snapshots[0];
  return {
    createdAt: latest?.recordedAt ?? new Date().toISOString(),
    forDate: latest?.tradingDate ?? todayIso(),
    source: 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY' as const,
    symbol: latest?.scanId ?? 'ADR-0491',
    actualGate1Passed: false,
    actualLiveEligible: false as const,
    dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY' as const,
    dryRunScenario: 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491',
    requiredScore: 70,
    providerIssue: latest?.providerIssue ?? false,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: true,
    sellOnly: false,
    status: 'PENDING' as const,
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    policyPromotionMode: 'SHADOW_ONLY' as const,
  };
}


export function collectOperatorActionSourcesFromSupplySnapshotAdr0491(
  result?: SupplySnapshotReplayResultAdr0491 | null,
) {
  if (!result || result.retained >= 3) return [];
  return [{
    adr: '0491',
    sectionId: 'supply-snapshot-store-replay',
    code: 'SUPPLY_SNAPSHOT_COLLECTION_NEEDED',
    diagnosticKey: 'supplySnapshotStore.retained',
    diagnosticValue: String(result?.retained ?? 0),
    severity: 'INFO' as const,
  }];
}
