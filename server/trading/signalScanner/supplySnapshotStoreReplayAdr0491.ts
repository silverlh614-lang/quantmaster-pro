// @responsibility ADR-0491 Supply Snapshot Store & Replay; diagnostic-only bounded sanitized JSON snapshots, no live Gate input.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type { FreshDataSupplyReportAdr0487 } from './freshDataSupplyLayerAdr0487.js';
import type { SectorEnergyAndSupplyUnknownPolicyReportAdr0488 } from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import type { InvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';
import type { ProgramTradingDataLineReportAdr0490 } from './programTradingDataLineAdr0490.js';
import type { InvestorFlowSanitizedSampleAdr0496, SupplyCoverageReportAdr0496 } from './investorFlowSemanticNetBuyAdr0496.js';
import { normalizeInvestorFlowCodeAdr0491, normalizeInvestorFlowSnapshotKeyAdr0491, normalizeInvestorFlowSourceKeyAdr0491, type InvestorFlowSnapshotSourceAdr0491 } from './investorFlowSnapshotKeyNormalizerAdr0491.js';
import { LEGACY_GATE1_REQUIRED_SCORE } from '../gateConfig.js';

export type SupplySnapshotReplayModeAdr0491 = 'LATEST' | 'PREVIOUS_TRADING_DAY' | 'BY_SCAN_ID' | 'BY_DATE' | 'WINDOW';
export type SupplySnapshotStatusAdr0491 = 'RECORDED' | 'EMPTY' | 'REPLAY_READY' | 'REPLAY_UNAVAILABLE' | 'CORRUPT_RECOVERED';
export type SupplySnapshotCacheLookupStatusAdr0491 = 'CACHE_HIT' | 'CACHE_STALE_HIT' | 'STALE_HIT' | 'CACHE_KEY_MISMATCH' | 'CACHE_EMPTY' | 'CORRUPT_RECOVERED';
export type SupplySnapshotDomainAdr0491 = 'SUPPLY' | 'SECTOR' | 'PROGRAM' | 'PROGRAM_TRADING';
export type SupplySnapshotMismatchHintAdr0491 =
  | 'NO_SUPPLY_ROWS'
  | 'SOURCE_ALIAS_MISMATCH'
  | 'PROVIDER_ALIAS_MISMATCH'
  | 'CODE_FORMAT_MISMATCH'
  | 'DATE_MISMATCH'
  | 'NORMALIZED_FLAG_MISMATCH'
  | 'DOMAIN_ROUTE_MISMATCH'
  | 'ONLY_SECTOR_ROWS_FOUND'
  | 'STALE_ONLY_AVAILABLE'
  | 'EMPTY_FOR_SYMBOL'
  | 'UNKNOWN_MISMATCH';

export interface SupplySnapshotRetainedKeySummaryAdr0491 {
  total: number;
  byDomain: Record<string, number>;
  bySource: Record<string, number>;
  byProvider: Record<string, number>;
  normalized: { true: number; false: number; missing: number };
  byTradingDate: Record<string, number>;
  sampleKeys: string[];
}

export interface SupplySnapshotRouterLookupDiagnosticAdr0491 {
  requestedCode: string;
  requestedSymbol?: string;
  normalizedCode: string;
  route: 'investor_flow';
  domainCandidates: SupplySnapshotDomainAdr0491[];
  sourceCandidates: InvestorFlowSnapshotSourceAdr0491[];
  providerCandidates: string[];
  tradingDateCandidates: string[];
  requireNormalized: boolean;
  allowStale: boolean;
  rawPayloadPersistenceAllowed: false;
  liveExecutionAllowed: false;
}

export interface SupplySnapshotClosestMatchAdr0491 {
  code: string;
  symbol: string | null;
  source: string;
  provider: string;
  tradingDate: string;
  sourceDate: string | null;
  normalized: boolean;
  reason: SupplySnapshotMismatchHintAdr0491;
}


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
  debug?: {
    lookupKey: string;
    triedKeys: string[];
    retainedSummary: SupplySnapshotRetainedKeySummaryAdr0491;
    routerLookup: SupplySnapshotRouterLookupDiagnosticAdr0491;
    mismatchHints: SupplySnapshotMismatchHintAdr0491[];
    closestMatches: SupplySnapshotClosestMatchAdr0491[];
  };
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

function kstDateFromIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function todayIso(): string {
  return kstDateFromIso(new Date().toISOString());
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
    tradingDate: input.tradingDate ?? kstDateFromIso(recordedAt),
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
  if (tradingDate && snapshot.tradingDate !== tradingDate) return 'CACHE_STALE_HIT';
  if (snapshot.latestInvestorFlowSample?.status === 'STALE') return 'CACHE_STALE_HIT';
  return 'CACHE_HIT';
}

function snapshotSource(snapshot: SanitizedSupplySnapshotAdr0491): InvestorFlowSnapshotSourceAdr0491 | 'UNKNOWN' {
  return normalizeInvestorFlowSourceKeyAdr0491(snapshot.latestInvestorFlowSample?.provider);
}

function snapshotCode(snapshot: SanitizedSupplySnapshotAdr0491): string {
  return normalizeInvestorFlowCodeAdr0491(snapshot.latestInvestorFlowSample?.symbol);
}

function snapshotProvider(snapshot: SanitizedSupplySnapshotAdr0491): string {
  return snapshot.latestInvestorFlowSample?.provider ?? 'UNKNOWN';
}

function snapshotNormalized(snapshot: SanitizedSupplySnapshotAdr0491): boolean | null {
  if (!snapshot.latestInvestorFlowSample) return null;
  return snapshot.latestInvestorFlowSample.status === 'MISSING' ? false : true;
}

function sampleKeyAdr0491(snapshot: SanitizedSupplySnapshotAdr0491): string {
  const normalized = snapshotNormalized(snapshot);
  return [
    `domain=${snapshot.domains.join('/')}`,
    `source=${snapshotSource(snapshot)}`,
    `provider=${snapshotProvider(snapshot)}`,
    `code=${snapshotCode(snapshot)}`,
    `symbol=${snapshot.latestInvestorFlowSample?.symbol ?? 'NONE'}`,
    `tradingDate=${snapshot.tradingDate}`,
    `sourceDate=${snapshot.latestInvestorFlowSample?.dataDate ?? 'NONE'}`,
    `normalized=${normalized === null ? 'missing' : String(normalized)}`,
  ].join(' ');
}

export function buildRetainedSummaryAdr0491(
  snapshots: SanitizedSupplySnapshotAdr0491[],
): SupplySnapshotRetainedKeySummaryAdr0491 {
  const byDomain = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byProvider = new Map<string, number>();
  const byDate = new Map<string, number>();
  const normalized = { true: 0, false: 0, missing: 0 };
  for (const snapshot of snapshots) {
    for (const domain of snapshot.domains) byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
    const source = snapshotSource(snapshot);
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
    const provider = snapshotProvider(snapshot);
    byProvider.set(provider, (byProvider.get(provider) ?? 0) + 1);
    byDate.set(snapshot.tradingDate, (byDate.get(snapshot.tradingDate) ?? 0) + 1);
    const normalizedValue = snapshotNormalized(snapshot);
    if (normalizedValue === true) normalized.true += 1;
    else if (normalizedValue === false) normalized.false += 1;
    else normalized.missing += 1;
  }
  return {
    total: snapshots.length,
    byDomain: Object.fromEntries([...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    bySource: Object.fromEntries([...bySource.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    byProvider: Object.fromEntries([...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    normalized,
    byTradingDate: Object.fromEntries([...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10)),
    sampleKeys: snapshots.slice(0, 5).map(sampleKeyAdr0491),
  };
}

function snapshotKeyAdr0491(snapshot: SanitizedSupplySnapshotAdr0491): string {
  return sampleKeyAdr0491(snapshot);
}

function normalizeProviderCandidateAdr0491(source: InvestorFlowSnapshotSourceAdr0491): string {
  if (source === 'NAVER_INVESTOR_TREND') return 'NAVER';
  if (source === 'KRX_INVESTOR_FLOW') return 'KRX';
  if (source === 'SEMANTIC_NETBUY') return 'INTERNAL';
  if (source === 'KIS_API') return 'KIS';
  return source;
}

function buildRouterLookupDiagnosticAdr0491(input: {
  requestedCode: string;
  requestedSymbol?: string;
  normalizedCode: string;
  sourceCandidates: InvestorFlowSnapshotSourceAdr0491[];
  tradingDateCandidates: string[];
  requireNormalized?: boolean;
  allowStale?: boolean;
}): SupplySnapshotRouterLookupDiagnosticAdr0491 {
  return {
    requestedCode: input.requestedCode,
    requestedSymbol: input.requestedSymbol,
    normalizedCode: input.normalizedCode,
    route: 'investor_flow',
    domainCandidates: ['SUPPLY'],
    sourceCandidates: input.sourceCandidates,
    providerCandidates: [...new Set(input.sourceCandidates.map(normalizeProviderCandidateAdr0491).concat('CACHE'))],
    tradingDateCandidates: input.tradingDateCandidates,
    requireNormalized: input.requireNormalized ?? true,
    allowStale: input.allowStale ?? false,
    rawPayloadPersistenceAllowed: false,
    liveExecutionAllowed: false,
  };
}

function classifySnapshotMismatchAdr0491(input: {
  snapshot: SanitizedSupplySnapshotAdr0491;
  normalizedCode: string;
  sourceCandidates: InvestorFlowSnapshotSourceAdr0491[];
  tradingDateCandidates: string[];
  requireNormalized?: boolean;
  allowStale?: boolean;
}): SupplySnapshotMismatchHintAdr0491 {
  const { snapshot, normalizedCode, sourceCandidates, tradingDateCandidates } = input;
  if (!snapshot.domains.includes('SUPPLY')) return snapshot.domains.includes('SECTOR') ? 'ONLY_SECTOR_ROWS_FOUND' : 'NO_SUPPLY_ROWS';
  const rawSymbol = snapshot.latestInvestorFlowSample?.symbol ?? '';
  const rowCode = snapshotCode(snapshot);
  if (rowCode !== normalizedCode) {
    const rowDigits = String(rawSymbol).replace(/[^0-9]/g, '');
    if (rowDigits.endsWith(normalizedCode) || rawSymbol.includes('.')) return 'CODE_FORMAT_MISMATCH';
    return 'EMPTY_FOR_SYMBOL';
  }
  const source = snapshotSource(snapshot);
  if (!sourceCandidates.includes(source as InvestorFlowSnapshotSourceAdr0491)) return 'SOURCE_ALIAS_MISMATCH';
  const provider = normalizeInvestorFlowSourceKeyAdr0491(snapshotProvider(snapshot));
  if (provider !== source && provider !== 'UNKNOWN') return 'PROVIDER_ALIAS_MISMATCH';
  if (!tradingDateCandidates.includes(snapshot.tradingDate)) {
    if (input.allowStale === true) return 'STALE_ONLY_AVAILABLE';
    return 'DATE_MISMATCH';
  }
  if (input.requireNormalized === true && snapshotNormalized(snapshot) !== true) return 'NORMALIZED_FLAG_MISMATCH';
  return 'UNKNOWN_MISMATCH';
}

function classifyLookupMismatchAdr0491(input: {
  snapshots: SanitizedSupplySnapshotAdr0491[];
  supplyRows: SanitizedSupplySnapshotAdr0491[];
  normalizedCode: string;
  sourceCandidates: InvestorFlowSnapshotSourceAdr0491[];
  tradingDateCandidates: string[];
  requireNormalized?: boolean;
  allowStale?: boolean;
}): SupplySnapshotMismatchHintAdr0491[] {
  if (input.snapshots.length === 0) return [];
  const supplyDomainRows = input.snapshots.filter((snapshot) => snapshot.domains.includes('SUPPLY'));
  if (supplyDomainRows.length === 0) {
    const sectorRows = input.snapshots.filter((snapshot) => snapshot.domains.includes('SECTOR'));
    return [sectorRows.length > 0 ? 'ONLY_SECTOR_ROWS_FOUND' : 'NO_SUPPLY_ROWS'];
  }
  const sameCode = supplyDomainRows.filter((snapshot) => snapshotCode(snapshot) === input.normalizedCode);
  if (sameCode.length === 0) return ['EMPTY_FOR_SYMBOL'];
  const sameSource = sameCode.filter((snapshot) => input.sourceCandidates.includes(snapshotSource(snapshot) as InvestorFlowSnapshotSourceAdr0491));
  if (sameSource.length === 0) return ['SOURCE_ALIAS_MISMATCH'];
  const staleCandidate = sameSource.some((snapshot) => !input.tradingDateCandidates.includes(snapshot.tradingDate));
  const sameDate = sameSource.filter((snapshot) => input.tradingDateCandidates.includes(snapshot.tradingDate));
  if (sameDate.length === 0) return [input.allowStale === true && staleCandidate ? 'STALE_ONLY_AVAILABLE' : 'DATE_MISMATCH'];
  if (input.requireNormalized === true && sameDate.every((snapshot) => snapshotNormalized(snapshot) !== true)) return ['NORMALIZED_FLAG_MISMATCH'];
  return ['UNKNOWN_MISMATCH'];
}

function buildClosestMatchesAdr0491(input: {
  snapshots: SanitizedSupplySnapshotAdr0491[];
  normalizedCode: string;
  sourceCandidates: InvestorFlowSnapshotSourceAdr0491[];
  tradingDateCandidates: string[];
  requireNormalized?: boolean;
  allowStale?: boolean;
}): SupplySnapshotClosestMatchAdr0491[] {
  const scored = input.snapshots.map((snapshot) => {
    const reason = classifySnapshotMismatchAdr0491({ snapshot, ...input });
    let score = 0;
    if (snapshot.domains.includes('SUPPLY')) score += 10;
    if (snapshotCode(snapshot) === input.normalizedCode) score += 8;
    if (input.sourceCandidates.includes(snapshotSource(snapshot) as InvestorFlowSnapshotSourceAdr0491)) score += 4;
    if (input.tradingDateCandidates.includes(snapshot.tradingDate)) score += 2;
    if (snapshot.latestInvestorFlowSample) score += 1;
    return { snapshot, reason, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || b.snapshot.recordedAt.localeCompare(a.snapshot.recordedAt))
    .slice(0, 3)
    .map(({ snapshot, reason }) => ({
      code: snapshotCode(snapshot),
      symbol: snapshot.latestInvestorFlowSample?.symbol ?? null,
      source: snapshotSource(snapshot),
      provider: snapshotProvider(snapshot),
      tradingDate: snapshot.tradingDate,
      sourceDate: snapshot.latestInvestorFlowSample?.dataDate ?? null,
      normalized: snapshotNormalized(snapshot) === true,
      reason,
    }));
}

function cacheRawFromSnapshotAdr0491(snapshot: SanitizedSupplySnapshotAdr0491, status: SupplySnapshotCacheLookupStatusAdr0491): Record<string, unknown> | null {
  const latest = snapshot.latestInvestorFlowSample;
  if (!latest) return null;
  return {
    code: snapshotCode(snapshot),
    sourceDate: latest.dataDate,
    foreignNetBuy: latest.foreignNetBuy,
    institutionNetBuy: latest.institutionNetBuy,
    retailNetBuy: latest.retailNetBuy,
    status: status === 'CACHE_STALE_HIT' || status === 'STALE_HIT' ? 'STALE' : latest.status === 'PARTIAL' || latest.status === 'FRESH' ? 'PARTIAL' : latest.status,
  };
}

export function findLatestInvestorFlowSnapshotAdr0491(input: {
  code: string;
  sourceCandidates?: InvestorFlowSnapshotSourceAdr0491[];
  tradingDateCandidates?: string[];
  allowStale?: boolean;
  requireNormalized?: boolean;
  filePath?: string;
  now?: Date;
}): SupplySnapshotCacheLookupAdr0491 {
  const { store, recovered } = readStore(input.filePath);
  const normalized = normalizeInvestorFlowSnapshotKeyAdr0491({
    code: input.code,
    source: input.sourceCandidates?.[0] ?? null,
    route: 'investor_flow',
    domain: 'SUPPLY',
    tradingDate: input.tradingDateCandidates?.[0] ?? null,
    now: input.now,
  });
  const sourceCandidates = input.sourceCandidates ?? normalized.sourceCandidates;
  const tradingDateCandidates = input.tradingDateCandidates ?? normalized.tradingDateCandidates;
  const retainedSummary = buildRetainedSummaryAdr0491(store.snapshots);
  const triedKeys = sourceCandidates.flatMap((source) => tradingDateCandidates.map((date) => `domain=SUPPLY|code=${normalized.normalizedCode}|source=${source}|tradingDate=${date}|normalized=${String(input.requireNormalized ?? true)}`));
  const routerLookup = buildRouterLookupDiagnosticAdr0491({
    requestedCode: input.code,
    normalizedCode: normalized.normalizedCode,
    sourceCandidates,
    tradingDateCandidates,
    requireNormalized: input.requireNormalized,
    allowStale: input.allowStale,
  });
  const debugBase = { lookupKey: normalized.lookupKey, triedKeys, retainedSummary, routerLookup, mismatchHints: [] as SupplySnapshotMismatchHintAdr0491[], closestMatches: [] as SupplySnapshotClosestMatchAdr0491[] };
  if (recovered) {
    return { status: 'CORRUPT_RECOVERED', snapshot: null, cacheRaw: null, retained: 0, reason: 'CORRUPT_RECOVERED', stale: false, debug: debugBase, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', rawPayloadPersistenceAllowed: false };
  }
  const supplyRows = store.snapshots
    .filter((snapshot) => snapshot.domains.includes('SUPPLY'))
    .filter((snapshot) => snapshot.latestInvestorFlowSample)
    .filter((snapshot) => input.requireNormalized !== true || snapshotNormalized(snapshot) === true)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const direct = supplyRows.find((snapshot) =>
    snapshotCode(snapshot) === normalized.normalizedCode &&
    sourceCandidates.includes(snapshotSource(snapshot) as InvestorFlowSnapshotSourceAdr0491) &&
    tradingDateCandidates.includes(snapshot.tradingDate));
  const stale = direct ? null : supplyRows.find((snapshot) =>
    input.allowStale === true &&
    snapshotCode(snapshot) === normalized.normalizedCode &&
    sourceCandidates.includes(snapshotSource(snapshot) as InvestorFlowSnapshotSourceAdr0491));
  const hit = direct ?? stale;
  if (hit) {
    const status = direct ? statusForCacheRaw(hit, tradingDateCandidates[0]) : 'CACHE_STALE_HIT';
    return {
      status,
      snapshot: hit,
      cacheRaw: cacheRawFromSnapshotAdr0491(hit, status),
      retained: store.snapshots.length,
      reason: status === 'CACHE_STALE_HIT' || status === 'STALE_HIT' ? 'STALE_SANITIZED_SNAPSHOT_HIT_OBSERVE_ONLY' : 'SANITIZED_SNAPSHOT_CACHE_HIT',
      stale: status === 'CACHE_STALE_HIT' || status === 'STALE_HIT',
      debug: { ...debugBase, mismatchHints: [], closestMatches: buildClosestMatchesAdr0491({ snapshots: [hit], normalizedCode: normalized.normalizedCode, sourceCandidates, tradingDateCandidates, requireNormalized: input.requireNormalized, allowStale: input.allowStale }) },
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      rawPayloadPersistenceAllowed: false,
    };
  }
  const hasRetainedRows = store.snapshots.length > 0;
  const mismatchHints = classifyLookupMismatchAdr0491({
    snapshots: store.snapshots,
    supplyRows,
    normalizedCode: normalized.normalizedCode,
    sourceCandidates,
    tradingDateCandidates,
    requireNormalized: input.requireNormalized,
    allowStale: input.allowStale,
  });
  const closestMatches = buildClosestMatchesAdr0491({
    snapshots: store.snapshots,
    normalizedCode: normalized.normalizedCode,
    sourceCandidates,
    tradingDateCandidates,
    requireNormalized: input.requireNormalized,
    allowStale: input.allowStale,
  });
  return {
    status: hasRetainedRows ? 'CACHE_KEY_MISMATCH' : 'CACHE_EMPTY',
    snapshot: null,
    cacheRaw: null,
    retained: store.snapshots.length,
    reason: hasRetainedRows ? mismatchHints.join('|') || 'KEY_MISMATCH_OR_SYMBOL_SOURCE_DATE_DOMAIN_NOT_FOUND' : 'SNAPSHOT_STORE_EMPTY',
    stale: false,
    debug: { ...debugBase, mismatchHints, closestMatches },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    rawPayloadPersistenceAllowed: false,
  };
}

export function readLatestSupplySnapshotBySymbolSourceDomainAdr0491(input: {
  symbol: string;
  source?: string;
  domain?: SupplySnapshotDomainAdr0491;
  tradingDate?: string;
  filePath?: string;
}): SupplySnapshotCacheLookupAdr0491 {
  const key = normalizeInvestorFlowSnapshotKeyAdr0491({ symbol: input.symbol, source: input.source, domain: input.domain, route: 'investor_flow', tradingDate: input.tradingDate });
  return findLatestInvestorFlowSnapshotAdr0491({
    code: key.normalizedCode,
    sourceCandidates: key.sourceCandidates,
    tradingDateCandidates: key.tradingDateCandidates,
    allowStale: true,
    requireNormalized: true,
    filePath: input.filePath,
  });
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
    requiredScore: LEGACY_GATE1_REQUIRED_SCORE,
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
