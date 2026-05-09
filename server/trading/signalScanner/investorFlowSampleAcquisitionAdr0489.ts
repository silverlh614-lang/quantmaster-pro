// @responsibility ADR-0489 investor-flow sample acquisition probe; OBSERVE/SHADOW_ONLY diagnostic-only, no live execution.
import type { Gate1DryRunObservationRow } from './gate1DryRunObservationLedgerAdr0476.js';
import type { InvestorFlowProviderRouteResult, InvestorFlowProviderStatus, SemanticSupplySignal } from './investorFlowProviderRouterAdr0477.js';
import type { NaverInvestorTrendCollectorResult } from './naverInvestorTrendCollectorAdr0481.js';
import { buildSemanticNetBuyNormalizationReportAdr0482, type SemanticNetBuyInputPoint, type SemanticNetBuySampleAdr0482 } from './semanticNetBuyNormalizerAdr0482.js';

export type InvestorFlowProbeProvider = 'NAVER' | 'CACHE' | 'KIS' | 'KRX' | 'INTERNAL_REPLAY' | 'UNKNOWN';
export type InvestorFlowProbeStatus = 'NOT_STARTED' | 'PROBE_SKIPPED' | 'PROBE_ATTEMPTED' | 'SAMPLE_ACQUIRED' | 'SAMPLE_PARTIAL' | 'SAMPLE_EMPTY' | 'SAMPLE_STALE' | 'DATA_UNAVAILABLE' | 'PROVIDER_MISMATCH' | 'PROVIDER_ERROR' | 'PARSE_ERROR' | 'NON_TRADING_DAY' | 'RATE_LIMITED' | 'UNKNOWN';
export type InvestorFlowProbeSignal = 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'UNKNOWN';
export type InvestorFlowProbeStage = 'OBSERVE' | 'SHADOW_ONLY';

export interface InvestorFlowProbeCoverageAdr0489 { fieldsAvailable: number; fieldsTotal: number; hasForeignNetBuy: boolean; hasInstitutionNetBuy: boolean; hasProgramNetBuy: boolean; hasIndividualNetBuy: boolean; }
export interface InvestorFlowSampleProbeAttemptAdr0489 {
  provider: InvestorFlowProbeProvider; attempted: boolean; status: InvestorFlowProbeStatus; sourceDate: string | null; collectedAt: string; sampleAgeTradingDays: number | null; cacheHit: boolean; coverage: InvestorFlowProbeCoverageAdr0489; normalized: boolean; semanticNormalizerUsed: boolean; signal: InvestorFlowProbeSignal; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; providerIssue: boolean; marketSignal: false; diagnostics: string[];
}
export interface InvestorFlowAcquiredSampleAdr0489 {
  provider: InvestorFlowProbeProvider; sourceDate: string | null; collectedAt: string; foreignNetBuy: number | null; institutionNetBuy: number | null; programNetBuy: number | null; individualNetBuy: number | null; unit: 'KRW' | 'SHARES' | 'UNKNOWN'; status: InvestorFlowProbeStatus; signal: InvestorFlowProbeSignal; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; freshness: { sourceState: 'FRESH' | 'STALE' | 'MISSING' | 'UNKNOWN'; sampleAgeTradingDays: number | null; }; executionImpact: 'NONE'; liveExecutionAllowed: false; policyPromotionMode: InvestorFlowProbeStage; operatorApprovalRequired: true; diagnostics: string[];
}
export interface InvestorFlowSampleAcquisitionReportAdr0489 {
  generatedAt: string; code: string | null; stage: InvestorFlowProbeStage; attempts: InvestorFlowSampleProbeAttemptAdr0489[]; selectedSample: InvestorFlowAcquiredSampleAdr0489 | null; selectedProvider: InvestorFlowProbeProvider | 'NONE'; overallStatus: InvestorFlowProbeStatus; coverageRatio: number; sampleAcquired: boolean; usableForShadow: boolean; topGaps: string[]; recommendedNextActions: string[]; executionImpact: 'NONE'; liveExecutionAllowed: false; policyPromotionMode: InvestorFlowProbeStage; operatorApprovalRequired: true; diagnostics: string[];
}
export interface InvestorFlowProbeRawSampleAdr0489 {
  provider: InvestorFlowProbeProvider; sourceDate?: string | null; collectedAt?: string | null; foreignNetBuy?: number | string | null; institutionNetBuy?: number | string | null; programNetBuy?: number | string | null; individualNetBuy?: number | string | null; unit?: 'KRW' | 'THOUSAND_KRW' | 'MILLION_KRW' | 'SHARES' | 'UNKNOWN'; status?: string | InvestorFlowProbeStatus; sourceAgeTradingDays?: number | null; cacheHit?: boolean; providerSemanticCapable?: boolean; diagnostics?: string[];
}
export interface BuildInvestorFlowSampleAcquisitionInputAdr0489 {
  code?: string | null; generatedAt?: string; stage?: InvestorFlowProbeStage; naverCollectorAdr0481?: NaverInvestorTrendCollectorResult | null; cacheSample?: InvestorFlowProbeRawSampleAdr0489 | null; kisSample?: InvestorFlowProbeRawSampleAdr0489 | null; krxSample?: InvestorFlowProbeRawSampleAdr0489 | null; internalReplaySample?: InvestorFlowProbeRawSampleAdr0489 | null; nonTradingDay?: boolean; rateLimitedProviders?: readonly InvestorFlowProbeProvider[]; semanticallyCompatibleProviders?: Partial<Record<InvestorFlowProbeProvider, boolean>>; diagnostics?: string[];
}

const POLICY = { executionImpact: 'NONE' as const, liveExecutionAllowed: false as const, operatorApprovalRequired: true as const };
const PROVIDERS: InvestorFlowProbeProvider[] = ['NAVER', 'CACHE', 'KIS', 'KRX', 'INTERNAL_REPLAY'];
const ZERO_COVERAGE: InvestorFlowProbeCoverageAdr0489 = { fieldsAvailable: 0, fieldsTotal: 4, hasForeignNetBuy: false, hasInstitutionNetBuy: false, hasProgramNetBuy: false, hasIndividualNetBuy: false };
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function round2(value: number): number { return Math.round(value * 100) / 100; }
function safeStage(stage?: InvestorFlowProbeStage): InvestorFlowProbeStage { return stage === 'OBSERVE' ? 'OBSERVE' : 'SHADOW_ONLY'; }
function normalizeProviderForAdr0482(provider: InvestorFlowProbeProvider): SemanticNetBuyInputPoint['provider'] { return provider === 'INTERNAL_REPLAY' ? 'MANUAL' : provider === 'UNKNOWN' ? 'UNKNOWN' : provider; }
function statusToProbe(status: string | undefined, normalized?: SemanticNetBuySampleAdr0482 | null): InvestorFlowProbeStatus {
  const upper = (status ?? '').toUpperCase();
  if (upper === 'HTTP_429' || upper === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (upper === 'NON_TRADING_DAY') return 'NON_TRADING_DAY';
  if (upper === 'PROVIDER_MISMATCH') return 'PROVIDER_MISMATCH';
  if (upper === 'PROVIDER_ERROR' || upper === 'ERROR') return 'PROVIDER_ERROR';
  if (upper === 'PARSE_ERROR') return 'PARSE_ERROR';
  if (upper === 'EMPTY' || upper === 'SAMPLE_EMPTY' || upper === 'CACHE_EMPTY') return 'SAMPLE_EMPTY';
  if (upper === 'DATA_UNAVAILABLE') return 'DATA_UNAVAILABLE';
  if (upper === 'STALE' || upper === 'SAMPLE_STALE') return 'SAMPLE_STALE';
  if (!normalized) return 'DATA_UNAVAILABLE';
  if (normalized.status === 'VERIFIED') return 'SAMPLE_ACQUIRED';
  if (normalized.status === 'PARTIAL') return 'SAMPLE_PARTIAL';
  if (normalized.status === 'STALE') return 'SAMPLE_STALE';
  if (normalized.status === 'EMPTY') return 'SAMPLE_EMPTY';
  if (normalized.status === 'PROVIDER_MISMATCH') return 'PROVIDER_MISMATCH';
  if (normalized.status === 'PROVIDER_ERROR') return 'PROVIDER_ERROR';
  if (normalized.status === 'PARSE_ERROR') return 'PARSE_ERROR';
  if (normalized.status === 'NON_TRADING_DAY') return 'NON_TRADING_DAY';
  return 'DATA_UNAVAILABLE';
}
function providerIssue(status: InvestorFlowProbeStatus): boolean { return ['SAMPLE_EMPTY', 'SAMPLE_STALE', 'DATA_UNAVAILABLE', 'PROVIDER_MISMATCH', 'PROVIDER_ERROR', 'PARSE_ERROR', 'RATE_LIMITED'].includes(status); }
function selectable(attempt: InvestorFlowSampleProbeAttemptAdr0489): boolean { return (attempt.status === 'SAMPLE_ACQUIRED' || attempt.status === 'SAMPLE_PARTIAL') && attempt.normalized && (attempt.confidence === 'HIGH' || attempt.confidence === 'MEDIUM'); }
function signalForAttempt(sample: SemanticNetBuySampleAdr0482 | null, status: InvestorFlowProbeStatus): InvestorFlowProbeSignal { return (status === 'SAMPLE_ACQUIRED' || status === 'SAMPLE_PARTIAL') && sample && (sample.confidence === 'HIGH' || sample.confidence === 'MEDIUM') ? sample.signal as InvestorFlowProbeSignal : 'UNKNOWN'; }
function attemptFromNormalized(input: { provider: InvestorFlowProbeProvider; raw: InvestorFlowProbeRawSampleAdr0489 | null | undefined; normalized: SemanticNetBuySampleAdr0482 | null; status: InvestorFlowProbeStatus; attempted: boolean; generatedAt: string; diagnostics: string[] }): InvestorFlowSampleProbeAttemptAdr0489 {
  const sample = input.normalized;
  const coverage = sample ? { fieldsAvailable: sample.coverage.availableFields, fieldsTotal: sample.coverage.totalFields, hasForeignNetBuy: sample.coverage.foreignAvailable, hasInstitutionNetBuy: sample.coverage.institutionAvailable, hasProgramNetBuy: sample.coverage.programAvailable, hasIndividualNetBuy: sample.coverage.individualAvailable } : ZERO_COVERAGE;
  return { provider: input.provider, attempted: input.attempted, status: input.status, sourceDate: sample?.sourceDate ?? input.raw?.sourceDate ?? null, collectedAt: sample?.collectedAt ?? input.raw?.collectedAt ?? input.generatedAt, sampleAgeTradingDays: sample?.freshness.sourceAgeTradingDays ?? input.raw?.sourceAgeTradingDays ?? null, cacheHit: input.raw?.cacheHit ?? input.provider === 'CACHE', coverage, normalized: Boolean(sample && (sample.status === 'VERIFIED' || sample.status === 'PARTIAL' || sample.status === 'STALE')), semanticNormalizerUsed: Boolean(sample), signal: signalForAttempt(sample, input.status), confidence: sample?.confidence ?? 'NONE', providerIssue: providerIssue(input.status), marketSignal: false, diagnostics: input.diagnostics };
}
function normalizeRaw(input: BuildInvestorFlowSampleAcquisitionInputAdr0489, provider: InvestorFlowProbeProvider, raw: InvestorFlowProbeRawSampleAdr0489 | null | undefined, generatedAt: string): { attempt: InvestorFlowSampleProbeAttemptAdr0489; sample: SemanticNetBuySampleAdr0482 | null } {
  if (input.nonTradingDay) return { attempt: attemptFromNormalized({ provider, raw, normalized: null, status: 'NON_TRADING_DAY', attempted: true, generatedAt, diagnostics: ['non-trading day; probe observation only, not failure.'] }), sample: null };
  if ((input.rateLimitedProviders ?? []).includes(provider)) return { attempt: attemptFromNormalized({ provider, raw, normalized: null, status: 'RATE_LIMITED', attempted: true, generatedAt, diagnostics: ['diagnostic non-live probe rate limited; not bearish.'] }), sample: null };
  if (input.semanticallyCompatibleProviders?.[provider] === false || raw?.providerSemanticCapable === false) return { attempt: attemptFromNormalized({ provider, raw, normalized: null, status: 'PROVIDER_MISMATCH', attempted: true, generatedAt, diagnostics: ['provider capability mismatch; not selected and not bearish.'] }), sample: null };
  if (!raw) return { attempt: attemptFromNormalized({ provider, raw, normalized: null, status: 'DATA_UNAVAILABLE', attempted: false, generatedAt, diagnostics: ['provider input missing for ADR-0489 non-live probe.'] }), sample: null };
  const report = buildSemanticNetBuyNormalizationReportAdr0482({ code: input.code ?? 'UNKNOWN', generatedAt, inputs: [{ code: input.code ?? 'UNKNOWN', provider: normalizeProviderForAdr0482(provider), sourceDate: raw.sourceDate ?? null, collectedAt: raw.collectedAt ?? generatedAt, rawForeignNetBuy: raw.foreignNetBuy ?? null, rawInstitutionNetBuy: raw.institutionNetBuy ?? null, rawProgramNetBuy: raw.programNetBuy ?? null, rawIndividualNetBuy: raw.individualNetBuy ?? null, unit: raw.unit ?? 'KRW', status: raw.status, sourceAgeTradingDays: raw.sourceAgeTradingDays ?? null, providerSemanticCapable: raw.providerSemanticCapable, diagnostics: raw.diagnostics }] });
  const sample = report.samples[0] ?? null;
  return { attempt: attemptFromNormalized({ provider, raw, normalized: sample, status: statusToProbe(raw.status, sample), attempted: true, generatedAt, diagnostics: ['ADR-0489 probe passed sanitized sample through ADR-0482 normalizer.', ...(raw.diagnostics ?? [])] }), sample };
}
function naverRawFromCollector(naver: NaverInvestorTrendCollectorResult | null | undefined, generatedAt: string): InvestorFlowProbeRawSampleAdr0489 | null {
  if (!naver) return null;
  const sample = naver.semanticNetBuyCandidate;
  return { provider: 'NAVER', sourceDate: sample?.sourceDate ?? naver.freshness.lastSourceDate, collectedAt: generatedAt, foreignNetBuy: sample?.foreignNetBuy ?? naver.latestPoint?.foreignNetBuy ?? null, institutionNetBuy: sample?.institutionNetBuy ?? naver.latestPoint?.institutionNetBuy ?? null, programNetBuy: sample?.programNetBuy ?? naver.latestPoint?.programNetBuy ?? null, individualNetBuy: naver.latestPoint?.individualNetBuy ?? null, unit: 'KRW', status: naver.status === 'DATA_AVAILABLE' ? 'VERIFIED' : naver.status === 'PARTIAL' ? 'PARTIAL' : naver.status, sourceAgeTradingDays: naver.freshness.sourceAgeTradingDays, providerSemanticCapable: true, diagnostics: naver.diagnostics };
}
function rawFor(input: BuildInvestorFlowSampleAcquisitionInputAdr0489, provider: InvestorFlowProbeProvider, generatedAt: string): InvestorFlowProbeRawSampleAdr0489 | null | undefined {
  if (provider === 'NAVER') return naverRawFromCollector(input.naverCollectorAdr0481, generatedAt);
  if (provider === 'CACHE') return input.cacheSample;
  if (provider === 'KIS') return input.kisSample;
  if (provider === 'KRX') return input.krxSample;
  if (provider === 'INTERNAL_REPLAY') return input.internalReplaySample;
  return null;
}
function selectedSampleFromAttempt(attempt: InvestorFlowSampleProbeAttemptAdr0489, stage: InvestorFlowProbeStage, sample: SemanticNetBuySampleAdr0482 | null | undefined): InvestorFlowAcquiredSampleAdr0489 {
  return { provider: attempt.provider, sourceDate: attempt.sourceDate, collectedAt: attempt.collectedAt, foreignNetBuy: sample?.foreignNetBuy ?? null, institutionNetBuy: sample?.institutionNetBuy ?? null, programNetBuy: sample?.programNetBuy ?? null, individualNetBuy: sample?.individualNetBuy ?? null, unit: sample?.unit ?? 'UNKNOWN', status: attempt.status, signal: attempt.signal, confidence: attempt.confidence, freshness: { sourceState: attempt.status === 'SAMPLE_STALE' ? 'STALE' : attempt.sourceDate ? 'FRESH' : 'UNKNOWN', sampleAgeTradingDays: attempt.sampleAgeTradingDays }, ...POLICY, policyPromotionMode: stage, diagnostics: ['ADR-0489 selected sanitized normalized sample for observation only.', ...attempt.diagnostics] };
}
function gapsAndActions(attempts: InvestorFlowSampleProbeAttemptAdr0489[], selected: InvestorFlowSampleProbeAttemptAdr0489 | null): { gaps: string[]; actions: string[] } {
  if (selected) return { gaps: [], actions: ['observe repeated investor-flow sample acquisition before any future ADR'] };
  const statuses = new Set(attempts.map((attempt) => attempt.status));
  const gaps: string[] = [];
  if (statuses.has('SAMPLE_EMPTY') || statuses.has('DATA_UNAVAILABLE')) gaps.push('VERIFY_NAVER_SAMPLE_PATH_OR_CACHE_KEY');
  if (statuses.has('PROVIDER_MISMATCH')) gaps.push('VERIFY_INVESTOR_FLOW_PROVIDER_CAPABILITY');
  if (statuses.has('RATE_LIMITED')) gaps.push('RESPECT_NON_LIVE_PROBE_RATE_LIMIT');
  if (statuses.has('PROVIDER_ERROR')) gaps.push('VERIFY_PROVIDER_HEALTH');
  if (gaps.length === 0) gaps.push('COLLECT_INVESTOR_FLOW_SAMPLE');
  return { gaps, actions: gaps.map((gap) => gap.toLowerCase().replace(/_/g, ' ')) };
}

export function buildInvestorFlowSampleAcquisitionReportAdr0489(input: BuildInvestorFlowSampleAcquisitionInputAdr0489 = {}): InvestorFlowSampleAcquisitionReportAdr0489 {
  try {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const stage = safeStage(input.stage);
    const normalizedSamples = new Map<InvestorFlowProbeProvider, SemanticNetBuySampleAdr0482 | null>();
    const attempts = PROVIDERS.map((provider) => { const normalized = normalizeRaw(input, provider, rawFor(input, provider, generatedAt), generatedAt); normalizedSamples.set(provider, normalized.sample); return normalized.attempt; });
    const selectedAttempt = attempts.find(selectable) ?? null;
    const selectedSample = selectedAttempt ? selectedSampleFromAttempt(selectedAttempt, stage, normalizedSamples.get(selectedAttempt.provider) ?? null) : null;
    const coverageRatio = round2(clamp((selectedAttempt?.coverage.fieldsAvailable ?? 0) / 4));
    const overallStatus = selectedAttempt?.status ?? attempts.find((attempt) => attempt.status === 'NON_TRADING_DAY')?.status ?? attempts.find((attempt) => attempt.status === 'RATE_LIMITED')?.status ?? (attempts.every((attempt) => !attempt.attempted || attempt.status === 'DATA_UNAVAILABLE') ? 'DATA_UNAVAILABLE' : attempts[0]?.status ?? 'UNKNOWN');
    const gaps = gapsAndActions(attempts, selectedAttempt);
    return { generatedAt, code: input.code ?? null, stage, attempts, selectedSample, selectedProvider: selectedSample?.provider ?? 'NONE', overallStatus, coverageRatio, sampleAcquired: Boolean(selectedSample), usableForShadow: Boolean(selectedSample && stage === 'SHADOW_ONLY'), topGaps: gaps.gaps, recommendedNextActions: gaps.actions, ...POLICY, policyPromotionMode: stage, diagnostics: ['ADR-0489 investor-flow probe is diagnostic-only; no live gate/order impact.', ...(input.diagnostics ?? [])] };
  } catch (error) {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const stage = safeStage(input.stage);
    return { generatedAt, code: input.code ?? null, stage, attempts: [], selectedSample: null, selectedProvider: 'NONE', overallStatus: 'PROVIDER_ERROR', coverageRatio: 0, sampleAcquired: false, usableForShadow: false, topGaps: ['PROBE_FAILURE_ISOLATED'], recommendedNextActions: ['inspect sanitized probe inputs; scan and Shadow Learning continue'], ...POLICY, policyPromotionMode: stage, diagnostics: ['ADR-0489 probe failure isolated by try/catch.', error instanceof Error ? error.message : String(error)] };
  }
}

export function formatInvestorFlowSampleProbeCompactAdr0489(report: InvestorFlowSampleAcquisitionReportAdr0489 | null | undefined): string | null {
  if (!report) return null;
  if (report.sampleAcquired && report.selectedSample) return `🧪 ADR-0489 InvestorFlowProbe: ${report.overallStatus} | provider=${report.selectedProvider} | signal=${report.selectedSample.signal} | confidence=${report.selectedSample.confidence} | impact=${report.executionImpact}`;
  const action = report.recommendedNextActions[0] ? `\n   action: ${report.recommendedNextActions[0]}` : '';
  return `🧪 ADR-0489 InvestorFlowProbe: ${report.overallStatus} | provider=${report.selectedProvider} | coverage=${Math.round(report.coverageRatio * 4)}/4 | impact=${report.executionImpact}${action}`;
}
export function formatInvestorFlowSampleProbeDetailAdr0489(report: InvestorFlowSampleAcquisitionReportAdr0489): string {
  return ['🧪 ADR-0489 Investor Flow Sample Acquisition Probe', `- code: ${report.code ?? 'none'}`, `- stage: ${report.stage}`, `- overallStatus: ${report.overallStatus}`, `- selectedProvider: ${report.selectedProvider}`, `- sampleAcquired: ${report.sampleAcquired}`, `- coverageRatio: ${report.coverageRatio}`, `- executionImpact: ${report.executionImpact}`, `- liveExecutionAllowed: ${report.liveExecutionAllowed}`, `- policyPromotionMode: ${report.policyPromotionMode}`, `- operatorApprovalRequired: ${report.operatorApprovalRequired}`, '- provider attempt chain:', ...report.attempts.map((attempt) => `  - ${attempt.provider}: status=${attempt.status}, attempted=${attempt.attempted}, normalized=${attempt.normalized}, signal=${attempt.signal}, confidence=${attempt.confidence}, providerIssue=${attempt.providerIssue}, marketSignal=${attempt.marketSignal}`), `- selectedSample: ${report.selectedSample ? `provider=${report.selectedSample.provider}, sourceDate=${report.selectedSample.sourceDate ?? 'none'}, signal=${report.selectedSample.signal}, confidence=${report.selectedSample.confidence}` : 'none'}`, `- topGaps: ${report.topGaps.join(', ') || 'none'}`, `- recommendedNextActions: ${report.recommendedNextActions.join(' | ') || 'none'}`, '- guardrails: diagnostic-only; UNKNOWN remains UNKNOWN; provider issue is never bearish; no ADVISORY/live promotion.', `- diagnostics: ${report.diagnostics.join(' | ')}`].join('\n');
}
export interface InvestorFlowSampleProbeDetailRegistryEntryAdr0489 { adr: '0489'; sectionId: 'investor_flow_sample_probe'; commandHint: '/supply_health_detail'; scanBlockersDetailHint: '/scan_blockers_detail investor_flow_sample_probe'; adrTraceHint: '/adr_trace 0489'; executionImpact: 'NONE'; liveExecutionAllowed: false; render: () => string; }
export function getInvestorFlowSampleProbeDetailRegistryEntryAdr0489(report: InvestorFlowSampleAcquisitionReportAdr0489): InvestorFlowSampleProbeDetailRegistryEntryAdr0489 { return { adr: '0489', sectionId: 'investor_flow_sample_probe', commandHint: '/supply_health_detail', scanBlockersDetailHint: '/scan_blockers_detail investor_flow_sample_probe', adrTraceHint: '/adr_trace 0489', executionImpact: 'NONE', liveExecutionAllowed: false, render: () => formatInvestorFlowSampleProbeDetailAdr0489(report) }; }

export function buildInvestorFlowProviderRouteFromProbeAdr0489(report: InvestorFlowSampleAcquisitionReportAdr0489): InvestorFlowProviderRouteResult {
  const selected = report.selectedSample;
  const status: InvestorFlowProviderStatus = selected ? selected.status === 'SAMPLE_ACQUIRED' ? 'VERIFIED' : selected.status === 'SAMPLE_PARTIAL' ? 'PARTIAL' : 'STALE' : report.overallStatus === 'NON_TRADING_DAY' ? 'NON_TRADING_DAY' : report.overallStatus === 'PROVIDER_MISMATCH' ? 'PROVIDER_MISMATCH' : report.overallStatus === 'PROVIDER_ERROR' ? 'PROVIDER_ERROR' : report.overallStatus === 'SAMPLE_EMPTY' ? 'EMPTY' : 'DATA_UNAVAILABLE';
  return { code: report.code ?? 'UNKNOWN', route: 'investor_flow', selectedProvider: selected?.provider === 'INTERNAL_REPLAY' ? 'MANUAL' : selected?.provider ?? 'NONE', providerTried: report.attempts.filter((attempt) => attempt.attempted).map((attempt) => attempt.provider === 'INTERNAL_REPLAY' ? 'MANUAL' : attempt.provider), providerStatuses: Object.fromEntries(report.attempts.map((attempt) => [attempt.provider, attempt.status === 'SAMPLE_ACQUIRED' ? 'VERIFIED' : attempt.status === 'SAMPLE_PARTIAL' ? 'PARTIAL' : attempt.status === 'SAMPLE_STALE' ? 'STALE' : attempt.status === 'SAMPLE_EMPTY' ? 'EMPTY' : attempt.status === 'RATE_LIMITED' ? 'ERROR' : attempt.status])) as Record<string, InvestorFlowProviderStatus>, semanticNetBuy: selected ? { code: report.code ?? 'UNKNOWN', source: selected.provider === 'INTERNAL_REPLAY' ? 'MANUAL' : selected.provider, sourceDate: selected.sourceDate, collectedAt: selected.collectedAt, foreignNetBuy: selected.foreignNetBuy, institutionNetBuy: selected.institutionNetBuy, programNetBuy: selected.programNetBuy, confidence: selected.confidence, status, signal: selected.signal as SemanticSupplySignal, diagnostics: selected.diagnostics } : null, status, signal: selected?.signal as SemanticSupplySignal ?? 'UNKNOWN', coverage: { available: Math.round(report.coverageRatio * 4), total: 4, missing: 4 - Math.round(report.coverageRatio * 4), stale: report.overallStatus === 'SAMPLE_STALE' ? 1 : 0, acceptedEmpty: report.overallStatus === 'SAMPLE_EMPTY' ? 1 : 0, providerMismatch: report.attempts.filter((attempt) => attempt.status === 'PROVIDER_MISMATCH').length, notWired: 0 }, freshness: { cacheState: report.attempts.some((attempt) => attempt.cacheHit) ? 'FRESH' : 'UNKNOWN', sourceState: selected ? selected.freshness.sourceState : 'MISSING', sourceAgeTradingDays: selected?.freshness.sampleAgeTradingDays ?? null, oldestSourceAgeTradingDays: selected?.freshness.sampleAgeTradingDays ?? null, lastSourceDate: selected?.sourceDate ?? null }, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: 'SHADOW_ONLY', operatorApprovalRequired: true, diagnostics: ['ADR-0477 router-compatible result derived from ADR-0489 probe; still SHADOW_ONLY.', ...report.diagnostics] };
}
export function buildInvestorFlowProbeObservationRowAdr0489(report: InvestorFlowSampleAcquisitionReportAdr0489): Partial<Gate1DryRunObservationRow> & Record<string, unknown> {
  return { id: `adr0489-${report.generatedAt}-${report.code ?? 'UNKNOWN'}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 180), createdAt: report.generatedAt, forDate: report.generatedAt.slice(0, 10), source: 'ADR_0489_INVESTOR_FLOW_SAMPLE_ACQUISITION', symbol: report.code ?? 'INVESTOR_FLOW_PROBE', actualGate1Passed: false, actualLiveEligible: false, dryRunDecision: 'UNKNOWN_DIAGNOSTIC_ONLY', dryRunScenario: 'INVESTOR_FLOW_SAMPLE_ACQUISITION_ADR0489', requiredScore: 70, providerIssue: !report.sampleAcquired, marketSignal: false, sectorEnergyDiagnosticOnly: false, sellOnly: false, status: 'OBSERVING', observationType: 'INVESTOR_FLOW_SAMPLE_ACQUISITION_ADR0489', code: report.code, selectedProvider: report.selectedProvider, overallStatus: report.overallStatus, sampleAcquired: report.sampleAcquired, coverageRatio: report.coverageRatio, signal: report.selectedSample?.signal ?? 'UNKNOWN', confidence: report.selectedSample?.confidence ?? 'NONE', sourceDate: report.selectedSample?.sourceDate ?? null, sampleAgeTradingDays: report.selectedSample?.freshness.sampleAgeTradingDays ?? null, providerAttempts: report.attempts.map((attempt) => ({ provider: attempt.provider, status: attempt.status, attempted: attempt.attempted })), topGaps: report.topGaps, recommendedNextActions: report.recommendedNextActions, executionImpact: 'NONE', liveExecutionAllowed: false, policyPromotionMode: report.policyPromotionMode };
}
export function formatRuntimePipelineInvestorFlowProbeEvidenceLineAdr0489(report: InvestorFlowSampleAcquisitionReportAdr0489 | null | undefined): string { return report ? `ADR-0489 status=${report.overallStatus} provider=${report.selectedProvider} sampleAcquired=${report.sampleAcquired} diagnosticOnly=true executionImpact=${report.executionImpact}` : 'ADR-0489 status=missing provider=NONE sampleAcquired=false diagnosticOnly=true executionImpact=NONE'; }
