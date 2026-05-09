// @responsibility ADR-0491 sanitized supply snapshot store/replay; diagnostic-only, no live execution.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../../persistence/paths.js';
import type { OperatorActionSource } from './operatorActionRouterAdr0480.js';

export type SupplySnapshotDomainAdr0491 =
  | 'SUPPLY'
  | 'INVESTOR_FLOW'
  | 'SEMANTIC_NETBUY'
  | 'PROGRAM_TRADING'
  | 'SECTOR_ENERGY'
  | 'FRESHNESS'
  | 'OPERATOR_ACTION'
  | 'FRESH_DATA'
  | 'UNKNOWN';

export type SupplySnapshotStatusAdr0491 =
  | 'RECORDED'
  | 'REPLAY_AVAILABLE'
  | 'REPLAYED'
  | 'EMPTY'
  | 'STALE'
  | 'MISSING'
  | 'CORRUPT_RECOVERED'
  | 'WRITE_FAILED'
  | 'READ_FAILED'
  | 'DISABLED'
  | 'UNKNOWN';

export type SupplySnapshotReplayModeAdr0491 = 'LATEST' | 'PREVIOUS_TRADING_DAY' | 'BY_SCAN_ID' | 'BY_DATE' | 'WINDOW';
export type SupplySnapshotStageAdr0491 = 'OBSERVE' | 'SHADOW_ONLY';
export type SupplySnapshotConfidenceAdr0491 = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNKNOWN';
export type SupplySnapshotSummaryValueAdr0491 = string | number | boolean | null;

export interface SupplySanitizedSnapshotAdr0491 {
  id: string;
  scanId: string | null;
  generatedAt: string;
  tradingDate: string | null;
  marketSession: string | null;
  domain: SupplySnapshotDomainAdr0491;
  code: string | null;
  provider: string | null;
  sourceDate: string | null;
  status: string;
  signal: string;
  confidence: SupplySnapshotConfidenceAdr0491;
  coverageRatio: number | null;
  sourceAgeTradingDays: number | null;
  cacheState: string | null;
  sourceState: string | null;
  summary: Record<string, SupplySnapshotSummaryValueAdr0491>;
  relatedAdrs: string[];
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: SupplySnapshotStageAdr0491;
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SupplySnapshotStoreReportAdr0491 {
  generatedAt: string;
  status: SupplySnapshotStatusAdr0491;
  snapshotsAttempted: number;
  snapshotsRecorded: number;
  snapshotsSkipped: number;
  retainedSnapshots: number;
  domainsRecorded: SupplySnapshotDomainAdr0491[];
  latestSnapshotAt: string | null;
  storePath: string | null;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: SupplySnapshotStageAdr0491;
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface SupplySnapshotReplayRequestAdr0491 {
  mode: SupplySnapshotReplayModeAdr0491;
  scanId?: string | null;
  tradingDate?: string | null;
  domain?: SupplySnapshotDomainAdr0491 | null;
  code?: string | null;
  limit?: number;
  storePath?: string | null;
}

export interface SupplySnapshotReplayReportAdr0491 {
  generatedAt: string;
  status: SupplySnapshotStatusAdr0491;
  request: SupplySnapshotReplayRequestAdr0491;
  snapshots: SupplySanitizedSnapshotAdr0491[];
  replayedCount: number;
  replayWindow: { from: string | null; to: string | null };
  comparison?: {
    baselineId: string | null;
    currentId: string | null;
    coverageDelta: number | null;
    statusChanged: boolean;
    signalChanged: boolean;
    freshnessDeltaTradingDays: number | null;
    providerChanged?: boolean;
    topGapChanged?: boolean;
  } | null;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: SupplySnapshotStageAdr0491;
  operatorApprovalRequired: true;
  diagnostics: string[];
}

export interface BuildSupplySanitizedSnapshotsInputAdr0491 {
  scanId?: string | null;
  generatedAt?: string;
  tradingDate?: string | null;
  marketSession?: string | null;
  freshDataSupplyAdr0487?: Record<string, unknown> | null;
  sectorEnergySupplyUnknownAdr0488?: Record<string, unknown> | null;
  investorFlowSampleAcquisitionAdr0489?: Record<string, unknown> | null;
  programTradingDataLineAdr0490?: Record<string, unknown> | null;
  supplySourceFreshnessAdr0483?: Record<string, unknown> | null;
  semanticNetBuyNormalizationAdr0482?: Record<string, unknown> | null;
  operatorActionQueueAdr0480?: Record<string, unknown> | null;
  investorFlowProviderRouterAdr0477?: Record<string, unknown> | null;
  diagnostics?: readonly string[];
}

export interface RecordSupplySnapshotsOptionsAdr0491 {
  storePath?: string | null;
  maxSnapshots?: number;
  now?: string;
  disabled?: boolean;
  forceWriteFailureForTest?: boolean;
}

const POLICY = {
  executionImpact: 'NONE' as const,
  liveExecutionAllowed: false as const,
  operatorApprovalRequired: true as const,
};
export const SUPPLY_SNAPSHOT_MAX_RETAINED_ADR0491 = 500;
export function getSupplySnapshotStorePathAdr0491(): string { return path.join(DATA_DIR, 'supply-snapshots', 'supply-snapshots.json'); }

function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function asArray(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(asRecord).filter((v): v is Record<string, unknown> => Boolean(v)) : []; }
function str(value: unknown, fallback = 'UNKNOWN'): string { return typeof value === 'string' && value.length > 0 ? value : fallback; }
function nullableStr(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function num(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function confidence(value: unknown): SupplySnapshotConfidenceAdr0491 { return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW' || value === 'NONE' || value === 'UNKNOWN' ? value : 'UNKNOWN'; }
function stage(value: unknown): SupplySnapshotStageAdr0491 { return value === 'SHADOW_ONLY' ? 'SHADOW_ONLY' : 'OBSERVE'; }
function stableId(parts: Array<string | null | undefined>): string { return parts.filter(Boolean).join('-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180) || `adr0491-${Date.now()}`; }
function unique<T>(items: T[]): T[] { return Array.from(new Set(items)); }
function sanitizeSummary(input: Record<string, unknown>, keys: string[]): Record<string, SupplySnapshotSummaryValueAdr0491> {
  const out: Record<string, SupplySnapshotSummaryValueAdr0491> = {};
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}
function stripRaw(summary: Record<string, SupplySnapshotSummaryValueAdr0491>): Record<string, SupplySnapshotSummaryValueAdr0491> {
  return Object.fromEntries(Object.entries(summary).filter(([key]) => !/(raw|payload|body|token|cookie|secret|account)/i.test(key)));
}

function snapshot(input: Omit<SupplySanitizedSnapshotAdr0491, 'executionImpact' | 'liveExecutionAllowed' | 'operatorApprovalRequired'>): SupplySanitizedSnapshotAdr0491 {
  return { ...input, summary: stripRaw(input.summary), ...POLICY };
}

function fromFreshData(input: BuildSupplySanitizedSnapshotsInputAdr0491, generatedAt: string): SupplySanitizedSnapshotAdr0491[] {
  const report = asRecord(input.freshDataSupplyAdr0487); if (!report) return [];
  const out: SupplySanitizedSnapshotAdr0491[] = [];
  for (const s of asArray(report.snapshots)) {
    out.push(snapshot({
      id: stableId(['adr0491', input.scanId ?? null, 'fresh', str(s.sourceId, str(s.domain)), generatedAt]), scanId: input.scanId ?? null, generatedAt,
      tradingDate: input.tradingDate ?? generatedAt.slice(0, 10), marketSession: input.marketSession ?? null, domain: mapDomain(s.domain), code: nullableStr(s.code), provider: nullableStr(s.provider), sourceDate: nullableStr(s.sourceDate),
      status: str(s.status), signal: str(s.signal, 'UNKNOWN'), confidence: confidence(s.confidence), coverageRatio: num(s.coverageRatio), sourceAgeTradingDays: num(s.sourceAgeTradingDays), cacheState: nullableStr(s.cacheState), sourceState: nullableStr(s.sourceState),
      summary: sanitizeSummary(s, ['sourceId', 'normalized', 'isProviderIssue', 'isMarketSignal', 'cacheAgeMinutes']), relatedAdrs: ['0487', '0491'], policyPromotionMode: stage(s.stage), diagnostics: ['ADR-0487 sanitized snapshot; raw provider payload excluded.'],
    }));
  }
  for (const d of asArray(report.domainSummaries)) {
    out.push(snapshot({
      id: stableId(['adr0491', input.scanId ?? null, 'fresh-domain', str(d.domain), generatedAt]), scanId: input.scanId ?? null, generatedAt,
      tradingDate: input.tradingDate ?? generatedAt.slice(0, 10), marketSession: input.marketSession ?? null, domain: mapDomain(d.domain), code: null, provider: null, sourceDate: null,
      status: str(d.status), signal: 'UNKNOWN', confidence: 'UNKNOWN', coverageRatio: num(d.averageCoverageRatio), sourceAgeTradingDays: null, cacheState: null, sourceState: null,
      summary: { sourcesTotal: num(d.sourcesTotal), sourcesFresh: num(d.sourcesFresh), sourcesStale: num(d.sourcesStale), sourcesMissing: num(d.sourcesMissing), topGapCount: Array.isArray(d.topGaps) ? d.topGaps.length : 0 }, relatedAdrs: ['0487', '0491'], policyPromotionMode: stage(report.policyPromotionMode), diagnostics: ['ADR-0487 domain summary snapshot.'],
    }));
  }
  return out;
}
function mapDomain(value: unknown): SupplySnapshotDomainAdr0491 {
  const v = str(value).toUpperCase();
  if (v.includes('INVESTOR')) return 'INVESTOR_FLOW';
  if (v.includes('SEMANTIC')) return 'SEMANTIC_NETBUY';
  if (v.includes('PROGRAM')) return 'PROGRAM_TRADING';
  if (v.includes('SECTOR')) return 'SECTOR_ENERGY';
  if (v.includes('FRESH')) return 'FRESH_DATA';
  if (v.includes('OPERATOR')) return 'OPERATOR_ACTION';
  if (v.includes('SUPPLY')) return 'SUPPLY';
  return 'UNKNOWN';
}
function genericReportSnapshot(input: BuildSupplySanitizedSnapshotsInputAdr0491, generatedAt: string, reportValue: unknown, domain: SupplySnapshotDomainAdr0491, relatedAdrs: string[], label: string): SupplySanitizedSnapshotAdr0491[] {
  const report = asRecord(reportValue); if (!report) return [];
  const samples = asArray(report.samples).concat(asArray(report.normalizedSamples), asArray(report.stockSamples), asArray(report.marketSamples), asArray(report.rows), asArray(report.attempts));
  const rows = samples.length > 0 ? samples : [report];
  return rows.slice(0, 25).map((row, index) => snapshot({
    id: stableId(['adr0491', input.scanId ?? null, label, nullableStr(row.code) ?? nullableStr(row.symbol) ?? String(index), generatedAt]), scanId: input.scanId ?? null, generatedAt,
    tradingDate: nullableStr(row.tradingDate) ?? input.tradingDate ?? generatedAt.slice(0, 10), marketSession: input.marketSession ?? null, domain,
    code: nullableStr(row.code) ?? nullableStr(row.symbol), provider: nullableStr(row.provider) ?? nullableStr(row.selectedProvider) ?? nullableStr(report.provider) ?? nullableStr(report.selectedProvider), sourceDate: nullableStr(row.sourceDate) ?? nullableStr(report.sourceDate),
    status: str(row.status, str(report.status, str(report.overallStatus))), signal: str(row.signal, str(report.signal, 'UNKNOWN')), confidence: confidence(row.confidence ?? report.confidence),
    coverageRatio: num(row.coverageRatio ?? row.coverage ?? report.coverageRatio ?? report.averageCoverageRatio), sourceAgeTradingDays: num(row.sourceAgeTradingDays ?? report.sourceAgeTradingDays ?? report.oldestSourceAgeTradingDays), cacheState: nullableStr(row.cacheState ?? report.cacheState), sourceState: nullableStr(row.sourceState ?? report.sourceState),
    summary: sanitizeSummary({ ...report, ...row }, ['attemptCount', 'attempts', 'successCount', 'missingCount', 'sampleCount', 'selectedProvider', 'topGapCount', 'recommendedActionCount', 'foreignNetBuy', 'institutionNetBuy', 'programNetBuy', 'marketProgramNetBuy', 'stockProgramNetBuy', 'oldestSourceAgeTradingDays']),
    relatedAdrs: [...relatedAdrs, '0491'], policyPromotionMode: stage(report.policyPromotionMode), diagnostics: [`${label} sanitized diagnostic snapshot; raw payload excluded.`],
  }));
}

export function buildSupplySanitizedSnapshotsAdr0491(input: BuildSupplySanitizedSnapshotsInputAdr0491 = {}): SupplySanitizedSnapshotAdr0491[] {
  try {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const snapshots = [
      ...fromFreshData(input, generatedAt),
      ...genericReportSnapshot(input, generatedAt, input.sectorEnergySupplyUnknownAdr0488, 'SECTOR_ENERGY', ['0488'], 'sector-energy'),
      ...genericReportSnapshot(input, generatedAt, input.investorFlowSampleAcquisitionAdr0489, 'INVESTOR_FLOW', ['0489'], 'investor-flow-sample'),
      ...genericReportSnapshot(input, generatedAt, input.programTradingDataLineAdr0490, 'PROGRAM_TRADING', ['0490'], 'program-trading'),
      ...genericReportSnapshot(input, generatedAt, input.supplySourceFreshnessAdr0483, 'FRESHNESS', ['0483'], 'freshness'),
      ...genericReportSnapshot(input, generatedAt, input.semanticNetBuyNormalizationAdr0482, 'SEMANTIC_NETBUY', ['0482'], 'semantic-netbuy'),
      ...genericReportSnapshot(input, generatedAt, input.operatorActionQueueAdr0480, 'OPERATOR_ACTION', ['0480'], 'operator-action'),
      ...genericReportSnapshot(input, generatedAt, input.investorFlowProviderRouterAdr0477, 'INVESTOR_FLOW', ['0477'], 'investor-flow-router'),
    ];
    return snapshots.map((s) => ({ ...s, diagnostics: [...s.diagnostics, ...(input.diagnostics ?? [])] }));
  } catch {
    return [];
  }
}

function validSnapshot(value: unknown): value is SupplySanitizedSnapshotAdr0491 {
  const r = asRecord(value);
  return Boolean(r && typeof r.id === 'string' && typeof r.generatedAt === 'string' && typeof r.domain === 'string' && r.executionImpact === 'NONE' && r.liveExecutionAllowed === false);
}
function readSnapshots(file: string): { snapshots: SupplySanitizedSnapshotAdr0491[]; corrupt: boolean; diagnostics: string[] } {
  try {
    if (!fs.existsSync(file)) return { snapshots: [], corrupt: false, diagnostics: [] };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    const rows = Array.isArray(parsed) ? parsed : asArray((parsed as Record<string, unknown>)?.snapshots);
    const snapshots = rows.filter(validSnapshot).map((row) => ({ ...row, summary: stripRaw(row.summary ?? {}) }));
    return { snapshots, corrupt: snapshots.length !== rows.length, diagnostics: snapshots.length !== rows.length ? ['CORRUPT_RECOVERED invalid snapshot rows ignored.'] : [] };
  } catch (error) {
    return { snapshots: [], corrupt: true, diagnostics: ['CORRUPT_RECOVERED invalid JSON ignored.', error instanceof Error ? error.message : String(error)] };
  }
}
function atomicWrite(file: string, snapshots: SupplySanitizedSnapshotAdr0491[]): void {
  ensureDataDir(); fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, snapshots }, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}
function byGeneratedAt(a: SupplySanitizedSnapshotAdr0491, b: SupplySanitizedSnapshotAdr0491): number { return a.generatedAt.localeCompare(b.generatedAt); }

export function recordSupplySnapshotsAdr0491(snapshots: readonly SupplySanitizedSnapshotAdr0491[], options: RecordSupplySnapshotsOptionsAdr0491 = {}): SupplySnapshotStoreReportAdr0491 {
  const generatedAt = options.now ?? new Date().toISOString();
  const storePath = options.storePath ?? getSupplySnapshotStorePathAdr0491();
  const attempted = snapshots.length;
  if (options.disabled || process.env.SUPPLY_SNAPSHOT_STORE_ADR0491_DISABLED === 'true') return report(generatedAt, 'DISABLED', attempted, 0, attempted, 0, [], null, storePath, ['ADR-0491 store disabled.']);
  try {
    if (options.forceWriteFailureForTest) throw new Error('forced ADR-0491 write failure');
    const current = readSnapshots(storePath);
    const sanitized = snapshots.filter(validSnapshot).map((s) => ({ ...s, summary: stripRaw(s.summary) }));
    const cap = Math.max(1, Math.min(options.maxSnapshots ?? SUPPLY_SNAPSHOT_MAX_RETAINED_ADR0491, SUPPLY_SNAPSHOT_MAX_RETAINED_ADR0491));
    const retained = [...current.snapshots, ...sanitized].sort(byGeneratedAt).slice(-cap);
    atomicWrite(storePath, retained);
    const domains = unique(sanitized.map((s) => s.domain));
    const status: SupplySnapshotStatusAdr0491 = current.corrupt ? 'CORRUPT_RECOVERED' : sanitized.length > 0 ? 'RECORDED' : 'EMPTY';
    return report(generatedAt, status, attempted, sanitized.length, attempted - sanitized.length, retained.length, domains, retained.at(-1)?.generatedAt ?? null, storePath, current.diagnostics);
  } catch (error) {
    return report(generatedAt, 'WRITE_FAILED', attempted, 0, attempted, 0, [], null, storePath, ['ADR-0491 write failure isolated; scan/runtime unaffected.', error instanceof Error ? error.message : String(error)]);
  }
}
function report(generatedAt: string, status: SupplySnapshotStatusAdr0491, snapshotsAttempted: number, snapshotsRecorded: number, snapshotsSkipped: number, retainedSnapshots: number, domainsRecorded: SupplySnapshotDomainAdr0491[], latestSnapshotAt: string | null, storePath: string | null, diagnostics: string[]): SupplySnapshotStoreReportAdr0491 {
  return { generatedAt, status, snapshotsAttempted, snapshotsRecorded, snapshotsSkipped, retainedSnapshots, domainsRecorded, latestSnapshotAt, storePath, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'OBSERVE', operatorApprovalRequired: true, diagnostics };
}
function applyFilters(rows: SupplySanitizedSnapshotAdr0491[], request: SupplySnapshotReplayRequestAdr0491): SupplySanitizedSnapshotAdr0491[] {
  return rows.filter((s) => (!request.domain || s.domain === request.domain) && (!request.code || s.code === request.code));
}
function latestDate(rows: SupplySanitizedSnapshotAdr0491[], exclude?: string | null): string | null {
  const dates = unique(rows.map((s) => s.tradingDate).filter((v): v is string => Boolean(v))).sort();
  const filtered = exclude ? dates.filter((d) => d < exclude) : dates;
  return filtered.at(-1) ?? null;
}
function limitRows(rows: SupplySanitizedSnapshotAdr0491[], limit?: number): SupplySanitizedSnapshotAdr0491[] { return rows.slice(0, Math.max(1, Math.min(limit ?? 50, 200))); }
export function replaySupplySnapshotsAdr0491(request: SupplySnapshotReplayRequestAdr0491): SupplySnapshotReplayReportAdr0491 {
  const generatedAt = new Date().toISOString();
  const file = request.storePath ?? getSupplySnapshotStorePathAdr0491();
  try {
    const read = readSnapshots(file);
    let rows = applyFilters(read.snapshots, request).sort(byGeneratedAt);
    if (request.mode === 'LATEST') {
      const latest = latestDate(rows); rows = latest ? rows.filter((s) => s.tradingDate === latest) : [];
    } else if (request.mode === 'PREVIOUS_TRADING_DAY') {
      const prev = latestDate(rows, latestDate(rows)); rows = prev ? rows.filter((s) => s.tradingDate === prev) : [];
    } else if (request.mode === 'BY_SCAN_ID') rows = rows.filter((s) => s.scanId === request.scanId);
    else if (request.mode === 'BY_DATE') rows = rows.filter((s) => s.tradingDate === request.tradingDate);
    rows = limitRows(rows, request.limit);
    const comparison = rows.length >= 2 ? compareSupplySnapshotsAdr0491(rows[0], rows.at(-1) ?? rows[0]) : null;
    return replayReport(generatedAt, rows.length > 0 ? 'REPLAYED' : 'EMPTY', request, rows, comparison, read.diagnostics);
  } catch (error) {
    return replayReport(generatedAt, 'READ_FAILED', request, [], null, ['ADR-0491 replay failure isolated.', error instanceof Error ? error.message : String(error)]);
  }
}
function replayReport(generatedAt: string, status: SupplySnapshotStatusAdr0491, request: SupplySnapshotReplayRequestAdr0491, snapshots: SupplySanitizedSnapshotAdr0491[], comparison: SupplySnapshotReplayReportAdr0491['comparison'], diagnostics: string[]): SupplySnapshotReplayReportAdr0491 {
  return { generatedAt, status, request, snapshots, replayedCount: snapshots.length, replayWindow: { from: snapshots[0]?.generatedAt ?? null, to: snapshots.at(-1)?.generatedAt ?? null }, comparison, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'OBSERVE', operatorApprovalRequired: true, diagnostics };
}
export function compareSupplySnapshotsAdr0491(baseline: SupplySanitizedSnapshotAdr0491 | null | undefined, current: SupplySanitizedSnapshotAdr0491 | null | undefined): SupplySnapshotReplayReportAdr0491['comparison'] {
  if (!baseline || !current) return null;
  const cov = baseline.coverageRatio !== null && current.coverageRatio !== null ? current.coverageRatio - baseline.coverageRatio : null;
  const fresh = baseline.sourceAgeTradingDays !== null && current.sourceAgeTradingDays !== null ? current.sourceAgeTradingDays - baseline.sourceAgeTradingDays : null;
  return { baselineId: baseline.id, currentId: current.id, coverageDelta: cov, statusChanged: baseline.status !== current.status, signalChanged: baseline.signal !== current.signal, freshnessDeltaTradingDays: fresh, providerChanged: baseline.provider !== current.provider, topGapChanged: baseline.summary.topGapCount !== current.summary.topGapCount };
}
export function buildSupplySnapshotObservationRowAdr0491(report: SupplySnapshotStoreReportAdr0491): Record<string, unknown> {
  return { id: `adr0491-${report.generatedAt}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180), createdAt: report.generatedAt, forDate: report.generatedAt.slice(0, 10), source: 'ADR_0491_SUPPLY_SNAPSHOT_STORE_REPLAY', symbol: 'SUPPLY_SNAPSHOT_STORE', actualGate1Passed: false, actualLiveEligible: false, dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY', dryRunScenario: 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491', requiredScore: 70, providerIssue: report.status !== 'RECORDED', marketSignal: false, sectorEnergyDiagnosticOnly: true, sellOnly: false, observationType: 'SUPPLY_SNAPSHOT_STORE_REPLAY_ADR0491', snapshotsRecorded: report.snapshotsRecorded, domainsRecorded: report.domainsRecorded, latestSnapshotAt: report.latestSnapshotAt, replayAvailable: report.retainedSnapshots > 0, retainedSnapshots: report.retainedSnapshots, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: report.policyPromotionMode, status: 'OBSERVING' };
}
export function formatSupplySnapshotStoreCompactAdr0491(report: SupplySnapshotStoreReportAdr0491 | null | undefined): string | null {
  if (!report) return '🗄 ADR-0491 SupplySnapshot: EMPTY | replay=unavailable | impact=NONE\n   action: collect sanitized snapshots for 3 scans';
  const domains = report.domainsRecorded.length > 0 ? report.domainsRecorded.join('/') : 'none';
  if (report.status === 'WRITE_FAILED') return `🗄 ADR-0491 SupplySnapshot: WRITE_FAILED | impact=${report.executionImpact}\n   action: inspect diagnostic persistence path`;
  if (report.status === 'EMPTY' || report.retainedSnapshots <= 0) return `🗄 ADR-0491 SupplySnapshot: EMPTY | replay=unavailable | impact=${report.executionImpact}\n   action: collect sanitized snapshots for 3 scans`;
  return `🗄 ADR-0491 SupplySnapshot: ${report.status} | retained=${report.retainedSnapshots} | domains=${domains} | impact=${report.executionImpact}`;
}
export function formatSupplySnapshotStoreDetailAdr0491(report: SupplySnapshotStoreReportAdr0491, replay?: SupplySnapshotReplayReportAdr0491 | null): string {
  return ['🗄 ADR-0491 Supply Snapshot Store & Replay', `status=${report.status} recorded=${report.snapshotsRecorded}/${report.snapshotsAttempted} retained=${report.retainedSnapshots} latest=${report.latestSnapshotAt ?? 'none'}`, `domains=${report.domainsRecorded.join(',') || 'none'} storePath=${report.storePath ?? 'none'}`, `replay=${replay?.status ?? 'not_requested'} replayed=${replay?.replayedCount ?? 0} window=${replay?.replayWindow.from ?? 'none'}..${replay?.replayWindow.to ?? 'none'}`, `guardrails: executionImpact=${report.executionImpact}; liveExecutionAllowed=${report.liveExecutionAllowed}; policyPromotionMode=${report.policyPromotionMode}; operatorApprovalRequired=${report.operatorApprovalRequired}; replay is diagnostic-only; excluded from Gate decisions; no raw provider payloads; UNKNOWN remains UNKNOWN; provider issue is not bearish.`].join('\n');
}
export function getSupplySnapshotDetailRegistryEntryAdr0491(report: SupplySnapshotStoreReportAdr0491) { return { adr: '0491' as const, sectionId: 'supply_snapshot_store_replay', commandHint: '/fresh_data_status', scanBlockersDetailHint: '/scan_blockers_detail supply_snapshot_store_replay', adrTraceHint: '/adr_trace 0491', executionImpact: 'NONE' as const, liveExecutionAllowed: false as const, render: () => formatSupplySnapshotStoreDetailAdr0491(report) }; }
export function collectOperatorActionSourcesFromSupplySnapshotAdr0491(report: SupplySnapshotStoreReportAdr0491 | null | undefined, replay?: SupplySnapshotReplayReportAdr0491 | null): OperatorActionSource[] {
  if (!report) return [];
  if (report.status === 'WRITE_FAILED') return [{ adr: '0491', sectionId: 'supply_snapshot_store_replay', code: 'SUPPLY_SNAPSHOT_STORE_WRITE_FAILED', diagnosticKey: 'SupplySnapshot', diagnosticValue: report.diagnostics[0] ?? 'write failed', severity: 'ERROR' }];
  if (report.retainedSnapshots <= 0 || replay?.status === 'EMPTY') return [{ adr: '0491', sectionId: 'supply_snapshot_store_replay', code: 'SUPPLY_SNAPSHOT_REPLAY_UNAVAILABLE', diagnosticKey: 'SupplySnapshot', diagnosticValue: 'replay unavailable', severity: 'DATA_UNAVAILABLE' }];
  if (report.status === 'STALE') return [{ adr: '0491', sectionId: 'supply_snapshot_store_replay', code: 'SUPPLY_SNAPSHOT_STALE', diagnosticKey: 'SupplySnapshot', diagnosticValue: 'snapshot stale', severity: 'DEGRADED' }];
  return [{ adr: '0491', sectionId: 'supply_snapshot_store_replay', code: 'SUPPLY_SNAPSHOT_STORE_HEALTHY', diagnosticKey: 'SupplySnapshot', diagnosticValue: `retained=${report.retainedSnapshots}`, severity: 'INFO' }];
}
export function formatRuntimePipelineSupplySnapshotEvidenceLineAdr0491(report: SupplySnapshotStoreReportAdr0491 | null | undefined): string {
  if (!report) return 'ADR-0491 status=missing retained=0 replayAvailable=false diagnosticOnly=true executionImpact=NONE';
  return `ADR-0491 status=${report.status} retained=${report.retainedSnapshots} replayAvailable=${report.retainedSnapshots > 0} diagnosticOnly=true executionImpact=${report.executionImpact}`;
}
export function buildSupplyCoverageReplayBaselineAdr0491(replay: SupplySnapshotReplayReportAdr0491 | null | undefined): { status: 'OBSERVING' | 'INSUFFICIENT_DATA'; staleBaseline: boolean; snapshots: number; executionImpact: 'NONE'; liveExecutionAllowed: false } { return { status: replay && replay.replayedCount > 0 ? 'OBSERVING' : 'INSUFFICIENT_DATA', staleBaseline: replay?.status === 'STALE', snapshots: replay?.replayedCount ?? 0, executionImpact: 'NONE', liveExecutionAllowed: false }; }
export function buildSupplyReadinessReplayEvidenceAdr0491(replay: SupplySnapshotReplayReportAdr0491 | null | undefined, minCount = 3): { evidenceOnly: true; observationCount: number; thresholdMet: boolean; proposedPromotionMode: 'NONE'; executionImpact: 'NONE'; liveExecutionAllowed: false } { const count = replay?.replayedCount ?? 0; return { evidenceOnly: true, observationCount: count, thresholdMet: count >= minCount, proposedPromotionMode: 'NONE', executionImpact: 'NONE', liveExecutionAllowed: false }; }
