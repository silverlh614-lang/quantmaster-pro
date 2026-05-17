// @responsibility market regime 표시 전용 view model helper
import type { BearRegimeResult, InverseGate1Result, VkospiTriggerResult } from '../types/quant';
import type { MarketContext } from '../services/stock/types';

export type MarketRegimeState = 'NORMAL' | 'RANGE_BOUND' | 'UNCERTAIN' | 'CRISIS' | 'UNKNOWN';

export type RegimeConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';

export type RegimeExecutionHint =
  | 'NORMAL_OPERATION'
  | 'TIGHTEN_GATE_DISPLAY_ONLY'
  | 'REDUCE_CONFIDENCE_DISPLAY_ONLY'
  | 'BUY_STOP_RECOMMENDED_DISPLAY_ONLY'
  | 'OBSERVE_ONLY_DISPLAY';

export type RegimeEvidenceDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' | 'UNKNOWN';

export type RegimeEvidenceConfidence = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'AI_ESTIMATED' | 'UNKNOWN';

export interface RegimeEvidenceItem {
  key: string;
  label: string;
  value?: string | number;
  direction?: RegimeEvidenceDirection;
  confidence?: RegimeEvidenceConfidence;
  source?: string;
  updatedAt?: string;
  issueType?: 'PROVIDER_ISSUE' | 'MARKET_SIGNAL' | 'MISSING_DATA' | 'MIXED_SIGNAL';
}

export interface MarketRegimeView {
  state: MarketRegimeState;
  confidence: RegimeConfidence;
  title: string;
  summary: string;
  evidence: RegimeEvidenceItem[];
  executionHint: RegimeExecutionHint;
  providerIssue?: boolean;
  marketSignal?: boolean;
  updatedAt?: string;
}

export interface BuildMarketRegimeViewInput {
  bearRegimeResult?: BearRegimeResult | null;
  vkospiTriggerResult?: VkospiTriggerResult | null;
  inverseGate1Result?: InverseGate1Result | null;
  marketContext?: MarketContext | null;
  staleFields?: readonly string[];
}

export function getMarketRegimeLabel(state: MarketRegimeState): string {
  switch (state) {
    case 'NORMAL': return '정상 판단 가능 구간';
    case 'RANGE_BOUND': return '박스권 / 추세 부재';
    case 'UNCERTAIN': return '불확실성 레짐';
    case 'CRISIS': return '위기성 시장 상태';
    case 'UNKNOWN': return '레짐 미확인';
  }
}

export function getMarketRegimeDescription(state: MarketRegimeState): string {
  switch (state) {
    case 'NORMAL': return '시장 데이터가 비교적 정렬되어 있으며 기존 Gate 판단을 해석할 수 있는 상태입니다.';
    case 'RANGE_BOUND': return '시장 추세가 명확하지 않은 박스권 상태입니다. 돌파 신호의 실패 가능성이 높아 해석에 주의가 필요합니다.';
    case 'UNCERTAIN': return '시장 신호가 혼조 상태입니다. 강한 매수/매도 판단보다 관찰과 리스크 축소가 우선되는 구간입니다.';
    case 'CRISIS': return '위기성 시장 상태가 감지되었습니다. 신규 매수 신호는 보수적으로 해석해야 하며, 리스크 관리가 우선입니다.';
    case 'UNKNOWN': return '시장 레짐을 확정할 수 있는 데이터가 부족합니다. 이는 시장 악화 신호가 아니라 데이터 가용성 문제일 수 있습니다.';
  }
}

export function getMarketRegimeTone(
  state: MarketRegimeState,
  confidence: RegimeConfidence = 'NOT_AVAILABLE',
): 'stable' | 'neutral' | 'warning' | 'danger' | 'unknown' {
  if (state === 'CRISIS') return 'danger';
  if (state === 'UNKNOWN' || confidence === 'NOT_AVAILABLE') return 'unknown';
  if (state === 'UNCERTAIN' || confidence === 'LOW') return 'warning';
  if (state === 'RANGE_BOUND') return 'neutral';
  return 'stable';
}

export function deriveRegimeExecutionHint(view: MarketRegimeView): RegimeExecutionHint {
  if (view.state === 'CRISIS') return 'BUY_STOP_RECOMMENDED_DISPLAY_ONLY';
  if (view.state === 'UNKNOWN') return 'OBSERVE_ONLY_DISPLAY';
  if (view.state === 'UNCERTAIN') return 'REDUCE_CONFIDENCE_DISPLAY_ONLY';
  if (view.state === 'RANGE_BOUND') return 'TIGHTEN_GATE_DISPLAY_ONLY';
  return 'NORMAL_OPERATION';
}

export function deriveRegimeSummary(view: MarketRegimeView): string {
  const issueLine = describeProviderSignalSplit(view.providerIssue, view.marketSignal);
  return `${view.summary || getMarketRegimeDescription(view.state)} ${issueLine}`.trim();
}

export function splitRegimeEvidence(items: RegimeEvidenceItem[]): {
  providerIssues: RegimeEvidenceItem[];
  marketSignals: RegimeEvidenceItem[];
  missingData: RegimeEvidenceItem[];
  mixedSignals: RegimeEvidenceItem[];
} {
  return {
    providerIssues: items.filter(item => item.issueType === 'PROVIDER_ISSUE'),
    marketSignals: items.filter(item => item.issueType === 'MARKET_SIGNAL'),
    missingData: items.filter(item => item.issueType === 'MISSING_DATA' || isUnavailableConfidence(item.confidence)),
    mixedSignals: items.filter(item => item.issueType === 'MIXED_SIGNAL' || item.direction === 'MIXED'),
  };
}

export function hasLowRegimeConfidence(view: MarketRegimeView): boolean {
  return view.confidence === 'LOW' || view.confidence === 'NOT_AVAILABLE' || view.state === 'UNKNOWN';
}

export function formatRegimeUpdatedAt(value?: string): string {
  if (!value) return 'updated: unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `updated: ${value}`;
  return `updated: ${date.toLocaleString('ko-KR', { hour12: false })}`;
}

export function getRegimeConfidenceLabel(confidence: RegimeConfidence): string {
  switch (confidence) {
    case 'HIGH': return '확신도 높음';
    case 'MEDIUM': return '확신도 보통';
    case 'LOW': return '확신도 낮음';
    case 'NOT_AVAILABLE': return '확신도 산정 불가';
  }
}

export function buildMarketRegimeView(input: BuildMarketRegimeViewInput): MarketRegimeView {
  const evidence = buildEvidence(input);
  const providerIssue = evidence.some(item => item.issueType === 'PROVIDER_ISSUE');
  const marketSignal = evidence.some(item => item.issueType === 'MARKET_SIGNAL');
  const missingData = evidence.some(item => item.issueType === 'MISSING_DATA' || isUnavailableConfidence(item.confidence));
  const state = deriveState(input, providerIssue, marketSignal, missingData);
  const confidence = deriveConfidence(state, evidence, providerIssue, missingData);
  const baseView: MarketRegimeView = {
    state,
    confidence,
    title: getMarketRegimeLabel(state),
    summary: getMarketRegimeDescription(state),
    evidence,
    executionHint: 'NORMAL_OPERATION',
    providerIssue,
    marketSignal,
    updatedAt: latestUpdatedAt(evidence),
  };
  return { ...baseView, executionHint: deriveRegimeExecutionHint(baseView) };
}

export function describeProviderSignalSplit(providerIssue?: boolean, marketSignal?: boolean): string {
  if (providerIssue && marketSignal) return 'Mixed: 일부 데이터 장애와 시장 신호가 동시에 존재합니다.';
  if (providerIssue) return 'Provider issue detected: market signal not confirmed.';
  if (marketSignal) return 'Market risk signal confirmed: provider health normal.';
  return 'Provider health and market signal separation: no confirmed provider issue or crisis signal.';
}

function buildEvidence(input: BuildMarketRegimeViewInput): RegimeEvidenceItem[] {
  const items: RegimeEvidenceItem[] = [];
  appendMarketContextEvidence(items, input.marketContext);
  appendBearRegimeEvidence(items, input.bearRegimeResult);
  appendVkospiEvidence(items, input.vkospiTriggerResult);
  appendInverseEvidence(items, input.inverseGate1Result);
  appendStaleFieldEvidence(items, input.staleFields);
  if (items.length === 0) {
    items.push({
      key: 'regime_telemetry',
      label: 'Market regime telemetry',
      value: 'No market regime telemetry available.',
      direction: 'UNKNOWN',
      confidence: 'MISSING',
      source: 'UI view model',
      issueType: 'MISSING_DATA',
    });
  }
  return items;
}

function appendMarketContextEvidence(items: RegimeEvidenceItem[], marketContext?: MarketContext | null): void {
  if (!marketContext) return;
  items.push(toIndexEvidence('kospi_trend', 'KOSPI trend', marketContext.kospi.status, marketContext.kospi.changePercent, marketContext.dataSource));
  items.push(toIndexEvidence('kosdaq_trend', 'KOSDAQ trend', marketContext.kosdaq.status, marketContext.kosdaq.changePercent, marketContext.dataSource));
  if (marketContext.vkospi !== undefined) {
    items.push({ key: 'vkospi', label: 'VKOSPI', value: marketContext.vkospi, direction: marketContext.vkospi >= 30 ? 'BEARISH' : 'NEUTRAL', confidence: 'VERIFIED', source: marketContext.dataSource ?? 'marketContext', issueType: marketContext.vkospi >= 30 ? 'MARKET_SIGNAL' : undefined });
  }
  if (marketContext.exchangeRate) {
    items.push({ key: 'usd_krw', label: 'USD/KRW', value: marketContext.exchangeRate.value, direction: marketContext.exchangeRate.change > 0 ? 'BEARISH' : 'NEUTRAL', confidence: 'VERIFIED', source: marketContext.dataSource ?? 'marketContext', issueType: marketContext.exchangeRate.change > 0 ? 'MARKET_SIGNAL' : undefined });
  }
  if (marketContext.marketPhase) {
    items.push({ key: 'market_phase', label: 'Market phase', value: marketContext.marketPhase, direction: phaseDirection(marketContext.marketPhase), confidence: 'AI_ESTIMATED', source: marketContext.dataSource ?? 'marketContext', issueType: phaseDirection(marketContext.marketPhase) === 'MIXED' ? 'MIXED_SIGNAL' : undefined });
  }
  if (marketContext.sectorRotation?.topSectors?.length) {
    items.push({ key: 'sector_leadership', label: 'Sector leadership breadth', value: `${marketContext.sectorRotation.topSectors.length} sectors`, direction: marketContext.sectorRotation.topSectors.length >= 3 ? 'BULLISH' : 'MIXED', confidence: 'AI_ESTIMATED', source: 'sectorRotation', issueType: marketContext.sectorRotation.topSectors.length >= 3 ? undefined : 'MIXED_SIGNAL' });
  }
}

function appendBearRegimeEvidence(items: RegimeEvidenceItem[], result?: BearRegimeResult | null): void {
  if (!result) return;
  items.push({ key: 'bear_regime', label: 'Bear regime detector', value: `${result.regime} ${result.triggeredCount}/${result.threshold}`, direction: result.regime === 'BEAR' ? 'BEARISH' : result.regime === 'TRANSITION' ? 'MIXED' : 'BULLISH', confidence: 'VERIFIED', source: 'Gate -1 detector', updatedAt: result.lastUpdated, issueType: result.regime === 'BEAR' ? 'MARKET_SIGNAL' : result.regime === 'TRANSITION' ? 'MIXED_SIGNAL' : undefined });
}

function appendVkospiEvidence(items: RegimeEvidenceItem[], result?: VkospiTriggerResult | null): void {
  if (!result) return;
  const risk = result.level !== 'NORMAL';
  items.push({ key: 'vkospi_trigger', label: 'VKOSPI trigger', value: `${result.vkospi.toFixed(1)} / ${result.level}`, direction: risk ? 'BEARISH' : 'NEUTRAL', confidence: 'VERIFIED', source: 'VKOSPI trigger', updatedAt: result.lastUpdated, issueType: risk ? 'MARKET_SIGNAL' : undefined });
}

function appendInverseEvidence(items: RegimeEvidenceItem[], result?: InverseGate1Result | null): void {
  if (!result) return;
  const risk = result.signalType !== 'INACTIVE';
  items.push({ key: 'inverse_gate_1', label: 'Inverse Gate 1', value: `${result.signalType} ${result.triggeredCount}/${result.conditions.length}`, direction: result.signalType === 'STRONG_BEAR' ? 'BEARISH' : result.signalType === 'PARTIAL' ? 'MIXED' : 'NEUTRAL', confidence: 'VERIFIED', source: 'Inverse Gate 1', updatedAt: result.lastUpdated, issueType: risk ? (result.signalType === 'PARTIAL' ? 'MIXED_SIGNAL' : 'MARKET_SIGNAL') : undefined });
}

function appendStaleFieldEvidence(items: RegimeEvidenceItem[], staleFields?: readonly string[]): void {
  staleFields?.forEach(field => items.push({ key: `stale_${field}`, label: `Provider stale: ${field}`, value: 'stale', direction: 'UNKNOWN', confidence: 'STALE', source: 'X-Field-Stale', issueType: 'PROVIDER_ISSUE' }));
}

function deriveState(input: BuildMarketRegimeViewInput, providerIssue: boolean, marketSignal: boolean, missingData: boolean): MarketRegimeState {
  if (!hasTelemetry(input)) return 'UNKNOWN';
  if (input.bearRegimeResult?.regime === 'BEAR' || input.inverseGate1Result?.signalType === 'STRONG_BEAR' || isCrisisVkospi(input.vkospiTriggerResult)) return 'CRISIS';
  if (providerIssue || missingData) return 'UNKNOWN';
  if (input.bearRegimeResult?.regime === 'TRANSITION' || input.inverseGate1Result?.signalType === 'PARTIAL') return 'UNCERTAIN';
  if (isRangeBound(input.marketContext)) return 'RANGE_BOUND';
  if (marketSignal) return 'UNCERTAIN';
  return 'NORMAL';
}

function deriveConfidence(state: MarketRegimeState, evidence: RegimeEvidenceItem[], providerIssue: boolean, missingData: boolean): RegimeConfidence {
  if (state === 'UNKNOWN' || evidence.length === 0) return 'NOT_AVAILABLE';
  if (providerIssue || missingData || evidence.some(item => item.confidence === 'STALE' || item.confidence === 'DEGRADED')) return 'LOW';
  if (state === 'UNCERTAIN' || state === 'RANGE_BOUND' || evidence.some(item => item.confidence === 'AI_ESTIMATED')) return 'MEDIUM';
  return 'HIGH';
}

function toIndexEvidence(key: string, label: string, status: string, changePercent: number, source?: string): RegimeEvidenceItem {
  const direction = status === 'BEAR' || status === 'BEARISH' ? 'BEARISH' : status === 'BULL' || status === 'BULLISH' ? 'BULLISH' : 'NEUTRAL';
  return { key, label, value: `${changePercent.toFixed(2)}% / ${status}`, direction, confidence: 'VERIFIED', source: source ?? 'marketContext', issueType: direction === 'BEARISH' ? 'MARKET_SIGNAL' : undefined };
}

function phaseDirection(phase: string): RegimeEvidenceDirection {
  const upper = phase.toUpperCase();
  if (upper.includes('SIDEWAYS') || upper.includes('RANGE')) return 'MIXED';
  if (upper.includes('BEAR') || upper.includes('RISK_OFF')) return 'BEARISH';
  if (upper.includes('BULL') || upper.includes('RISK_ON')) return 'BULLISH';
  return 'UNKNOWN';
}

function isRangeBound(marketContext?: MarketContext | null): boolean {
  if (!marketContext) return false;
  const phase = marketContext.marketPhase?.toUpperCase() ?? '';
  const bothFlat = Math.abs(marketContext.kospi.changePercent) < 0.5 && Math.abs(marketContext.kosdaq.changePercent) < 0.5;
  return phase.includes('SIDEWAYS') || phase.includes('RANGE') || (bothFlat && marketContext.kospi.status === 'NEUTRAL' && marketContext.kosdaq.status === 'NEUTRAL');
}

function isCrisisVkospi(result?: VkospiTriggerResult | null): boolean {
  return result?.level === 'ENTRY_2' || result?.level === 'HISTORICAL_FEAR';
}

function hasTelemetry(input: BuildMarketRegimeViewInput): boolean {
  return Boolean(input.bearRegimeResult || input.vkospiTriggerResult || input.inverseGate1Result || input.marketContext || input.staleFields?.length);
}

function isUnavailableConfidence(confidence?: RegimeEvidenceConfidence): boolean {
  return confidence === 'MISSING' || confidence === 'STALE' || confidence === 'UNKNOWN';
}

function latestUpdatedAt(items: RegimeEvidenceItem[]): string | undefined {
  return items.map(item => item.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
}
