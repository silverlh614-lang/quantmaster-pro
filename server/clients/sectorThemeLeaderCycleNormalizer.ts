// @responsibility Gate2 sector/theme/leader-cycle diagnostic normalization.

import {
  canonicalSectorReturn20d,
  canonicalSectorRank20d,
  canonicalIsLeadingSector,
} from './sectorCanonicalReturnLookup.js'; // ADR-0572 Stage 1: canonical(L1) 우선 데이터원 룩업 (의존성-0 leaf, KIS/fs 부작용 0, flag default OFF=null).

export type SectorCycleMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'UNKNOWN';

export type LeaderCyclePhase =
  | 'SILENT_ACCUMULATION'
  | 'EARLY_LEADER'
  | 'MID_LEADER'
  | 'LATE_CROWDED'
  | 'EX_LEADER'
  | 'LAGGARD'
  | 'UNKNOWN';

export type AttentionPhase =
  | 'SILENT'
  | 'EARLY'
  | 'GROWING'
  | 'CROWDED'
  | 'OVERHYPED'
  | 'UNKNOWN';

export type SectorThemeCycleSource =
  | 'QMP_SECTOR_MAP'
  | 'KRX_SECTOR_INDEX'
  | 'KIS_SECTOR'
  | 'NEWS_ANALYSIS'
  | 'CACHE'
  | 'UNKNOWN';

export type SectorThemeCycleProviderStatus =
  | 'OK_WITH_DATA'
  | 'PARTIAL_WITH_DATA'
  | 'OK_EMPTY'
  | 'HTTP_ERROR'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'FIELD_MISSING'
  | 'PARSE_ERROR'
  | 'STALE_CACHE'
  | 'UNKNOWN_ERROR';

export type SectorThemeCycleConfidence =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'EMPTY_VALID'
  | 'AI_ESTIMATED';

export interface SectorThemeCycleRawFieldCoverage {
  requiredFields: string[];
  presentFields: string[];
  missingFields: string[];
  allRequiredFieldsPresent: boolean;
}

export interface QmpSectorThemeCycle {
  symbol: string;
  sector: string | null;
  industry: string | null;
  themeTags: string[];

  market: SectorCycleMarket;

  sectorReturn20d: number | null;
  sectorReturn60d: number | null;
  benchmarkReturn20d: number | null;
  benchmarkReturn60d: number | null;
  sectorRelativeReturn20d: number | null;
  sectorRelativeReturn60d: number | null;

  stockReturn20d: number | null;
  stockReturn60d: number | null;
  stockVsSectorReturn20d: number | null;
  stockVsSectorReturn60d: number | null;

  sectorRank20d: number | null;
  sectorRank60d: number | null;
  sectorPercentile20d: number | null;
  sectorPercentile60d: number | null;

  leaderCyclePhase: LeaderCyclePhase;
  isCurrentLeadingSector: boolean | null;
  isSectorLeader: boolean | null;
  isPreviousCycleLeader: boolean | null;
  isNewLeaderCandidate: boolean | null;

  newsFrequency30d: number | null;
  newsCrowdingScore: number | null;
  attentionPhase: AttentionPhase;

  source: SectorThemeCycleSource;
  providerStatus: SectorThemeCycleProviderStatus;
  dataConfidence: SectorThemeCycleConfidence;
  providerIssue: boolean;
  marketSignal: false;
  executionImpact: 'NONE' | 'DIAGNOSTIC_ONLY';

  rawFieldCoverage?: SectorThemeCycleRawFieldCoverage;
  notes?: string[];
}

export interface NormalizeSectorThemeCycleForGate2Input {
  symbol: string;
  quote?: unknown;
  stockMaster?: unknown;
  sectorThemeCycle?: unknown;
  sectorEnergyResult?: unknown;
  benchmarkReturn20d?: number | null;
  benchmarkReturn60d?: number | null;
  market?: SectorCycleMarket | string | null;
}

const REQUIRED_FIELDS = ['sector', 'stockReturn20d', 'sectorReturn20d'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').replace(/%/g, '').replace(/\+/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toUpperCase() === 'N/A') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'UNKNOWN') return null;
  return trimmed;
}

function normalizeMarket(value: unknown): SectorCycleMarket {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw === 'KOSPI' || raw === 'KS' || raw === 'J' || raw.includes('KOSPI')) return 'KOSPI';
  if (raw === 'KOSDAQ' || raw === 'KQ' || raw === 'Q' || raw.includes('KOSDAQ')) return 'KOSDAQ';
  if (raw === 'KONEX' || raw.includes('KONEX')) return 'KONEX';
  return 'UNKNOWN';
}

function normalizeSource(value: unknown): SectorThemeCycleSource {
  const raw = String(value ?? '').toUpperCase();
  if (raw.includes('KRX')) return 'KRX_SECTOR_INDEX';
  if (raw.includes('KIS')) return 'KIS_SECTOR';
  if (raw.includes('NEWS')) return 'NEWS_ANALYSIS';
  if (raw.includes('CACHE')) return 'CACHE';
  if (raw.includes('QMP') || raw.includes('SECTOR_MAP')) return 'QMP_SECTOR_MAP';
  return 'UNKNOWN';
}

function normalizeProviderStatus(value: unknown): SectorThemeCycleProviderStatus | null {
  if (value == null || value === '') return null;
  const raw = String(value).toUpperCase();
  const allowed: SectorThemeCycleProviderStatus[] = [
    'OK_WITH_DATA',
    'PARTIAL_WITH_DATA',
    'OK_EMPTY',
    'HTTP_ERROR',
    'PROVIDER_ERROR',
    'RATE_LIMITED',
    'FIELD_MISSING',
    'PARSE_ERROR',
    'STALE_CACHE',
    'UNKNOWN_ERROR',
  ];
  if ((allowed as string[]).includes(raw)) return raw as SectorThemeCycleProviderStatus;
  if (raw.includes('PARTIAL')) return 'PARTIAL_WITH_DATA';
  if (raw.includes('EMPTY')) return 'OK_EMPTY';
  if (raw.includes('STALE')) return 'STALE_CACHE';
  if (raw.includes('RATE') || raw.includes('LIMIT')) return 'RATE_LIMITED';
  if (raw.includes('FIELD')) return 'FIELD_MISSING';
  if (raw.includes('PARSE')) return 'PARSE_ERROR';
  if (raw.includes('HTTP')) return 'HTTP_ERROR';
  if (raw.includes('ERROR')) return 'PROVIDER_ERROR';
  return null;
}

export function confidenceForSectorThemeCycleStatus(
  status: SectorThemeCycleProviderStatus,
): SectorThemeCycleConfidence {
  if (status === 'OK_WITH_DATA') return 'VERIFIED';
  if (status === 'PARTIAL_WITH_DATA') return 'PARTIAL';
  if (status === 'OK_EMPTY') return 'EMPTY_VALID';
  if (status === 'STALE_CACHE') return 'STALE';
  if (status === 'FIELD_MISSING') return 'MISSING';
  return 'DEGRADED';
}

function normalizeConfidence(value: unknown): SectorThemeCycleConfidence | null {
  const raw = String(value ?? '').toUpperCase();
  const allowed: SectorThemeCycleConfidence[] = [
    'VERIFIED',
    'PARTIAL',
    'DEGRADED',
    'STALE',
    'MISSING',
    'EMPTY_VALID',
    'AI_ESTIMATED',
  ];
  return (allowed as string[]).includes(raw) ? raw as SectorThemeCycleConfidence : null;
}

function providerIssueForStatus(status: SectorThemeCycleProviderStatus): boolean {
  return !['OK_WITH_DATA', 'PARTIAL_WITH_DATA', 'OK_EMPTY'].includes(status);
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
}

function safeDiff(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : left - right;
}

function clampPercentile(value: number | null): number | null {
  if (value == null) return null;
  if (value > 1 && value <= 100) return value / 100;
  return Math.max(0, Math.min(1, value));
}

function getSectorEnergyScore(input: unknown, sector: string | null): Record<string, unknown> {
  if (!sector || !isRecord(input) || !Array.isArray(input.scores)) return {};
  const scores = input.scores.filter(isRecord);
  return scores.find(score => stringOrNull(score.name) === sector) ?? {};
}

function getSectorRank(input: unknown, sector: string | null): number | null {
  if (!sector || !isRecord(input) || !Array.isArray(input.scores)) return null;
  const scores = input.scores.filter(isRecord);
  const index = scores.findIndex(score => stringOrNull(score.name) === sector);
  return index >= 0 ? index + 1 : null;
}

function isLeadingSector(input: unknown, sector: string | null): boolean | null {
  if (!sector || !isRecord(input) || !Array.isArray(input.leadingSectors)) return null;
  return input.leadingSectors.filter(isRecord).some(item => stringOrNull(item.name) === sector);
}

function attentionPhase(newsFrequency30d: number | null, newsCrowdingScore: number | null): AttentionPhase {
  if (newsCrowdingScore != null) {
    if (newsCrowdingScore >= 0.9) return 'OVERHYPED';
    if (newsCrowdingScore >= 0.7) return 'CROWDED';
    if (newsCrowdingScore >= 0.4) return 'GROWING';
    if (newsCrowdingScore > 0) return 'EARLY';
    return 'SILENT';
  }
  if (newsFrequency30d == null) return 'UNKNOWN';
  if (newsFrequency30d <= 0) return 'SILENT';
  if (newsFrequency30d <= 3) return 'EARLY';
  if (newsFrequency30d <= 10) return 'GROWING';
  if (newsFrequency30d <= 25) return 'CROWDED';
  return 'OVERHYPED';
}

function leaderPhase(input: {
  explicit: unknown;
  isCurrentLeadingSector: boolean | null;
  isSectorLeader: boolean | null;
  isPreviousCycleLeader: boolean | null;
  stockVsSectorReturn20d: number | null;
  sectorRelativeReturn20d: number | null;
  attentionPhase: AttentionPhase;
}): LeaderCyclePhase {
  const raw = String(input.explicit ?? '').toUpperCase();
  const allowed: LeaderCyclePhase[] = [
    'SILENT_ACCUMULATION',
    'EARLY_LEADER',
    'MID_LEADER',
    'LATE_CROWDED',
    'EX_LEADER',
    'LAGGARD',
    'UNKNOWN',
  ];
  if ((allowed as string[]).includes(raw)) return raw as LeaderCyclePhase;
  if (input.attentionPhase === 'OVERHYPED' || input.attentionPhase === 'CROWDED') {
    return input.isCurrentLeadingSector ? 'LATE_CROWDED' : 'EX_LEADER';
  }
  if (input.isCurrentLeadingSector && input.isSectorLeader) return 'MID_LEADER';
  if ((input.sectorRelativeReturn20d ?? 0) > 0 && (input.stockVsSectorReturn20d ?? 0) > 0) return 'EARLY_LEADER';
  if (input.isPreviousCycleLeader) return 'EX_LEADER';
  if ((input.stockVsSectorReturn20d ?? 0) < 0 && input.isCurrentLeadingSector === false) return 'LAGGARD';
  if (input.attentionPhase === 'SILENT' && (input.sectorRelativeReturn20d ?? 0) >= 0) return 'SILENT_ACCUMULATION';
  return 'UNKNOWN';
}

function rawFieldCoverage(values: Record<string, unknown>): SectorThemeCycleRawFieldCoverage {
  const missingFields = REQUIRED_FIELDS.filter(field => values[field] == null);
  return {
    requiredFields: [...REQUIRED_FIELDS],
    presentFields: REQUIRED_FIELDS.filter(field => !missingFields.includes(field)),
    missingFields,
    allRequiredFieldsPresent: missingFields.length === 0,
  };
}

export function normalizeSectorThemeCycleForGate2(
  input: NormalizeSectorThemeCycleForGate2Input,
): QmpSectorThemeCycle {
  const raw = isRecord(input.sectorThemeCycle) ? input.sectorThemeCycle : {};
  const quote = isRecord(input.quote) ? input.quote : {};
  const stockMaster = isRecord(input.stockMaster) ? input.stockMaster : {};
  const sector = stringOrNull(raw.sector ?? stockMaster.sector ?? quote.sector);
  const sectorEnergyScore = getSectorEnergyScore(input.sectorEnergyResult, sector);
  const industry = stringOrNull(raw.industry ?? stockMaster.industry ?? quote.industry);
  const themeTags = arrayOfStrings(raw.themeTags ?? raw.themes ?? quote.themeTags ?? stockMaster.themeTags);
  const market = normalizeMarket(raw.market ?? input.market ?? stockMaster.market ?? quote.market ?? quote.marketDivCode);

  const stockReturn20d = numberOrNull(raw.stockReturn20d ?? quote.return20d);
  const stockReturn60d = numberOrNull(raw.stockReturn60d ?? quote.return60d);
  // ADR-0572 D1: 우선순위 raw → canonical(L1) → basket(diagnostic) fallback.
  // raw 명시값(numberOrNull)이 있으면 최우선; 없을 때만 canonical 룩업, 그것도 null 이면 기존 basket 체인 그대로.
  // flag OFF → canonical null → basket 원본 표현식 = byte-identical (raw 의 nullish 체인 의미 보존).
  const sectorReturn20d = numberOrNull(raw.sectorReturn20d)
    ?? canonicalSectorReturn20d(sector)
    ?? numberOrNull(raw.sectorReturn20d ?? sectorEnergyScore.sectorReturn20d ?? sectorEnergyScore.return4w);
  const sectorReturn60d = numberOrNull(raw.sectorReturn60d ?? sectorEnergyScore.sectorReturn60d);
  const benchmarkReturn20d = numberOrNull(raw.benchmarkReturn20d ?? input.benchmarkReturn20d);
  const benchmarkReturn60d = numberOrNull(raw.benchmarkReturn60d ?? input.benchmarkReturn60d);
  const sectorRelativeReturn20d = numberOrNull(raw.sectorRelativeReturn20d) ?? safeDiff(sectorReturn20d, benchmarkReturn20d);
  const sectorRelativeReturn60d = numberOrNull(raw.sectorRelativeReturn60d) ?? safeDiff(sectorReturn60d, benchmarkReturn60d);
  const stockVsSectorReturn20d = numberOrNull(raw.stockVsSectorReturn20d) ?? safeDiff(stockReturn20d, sectorReturn20d);
  const stockVsSectorReturn60d = numberOrNull(raw.stockVsSectorReturn60d) ?? safeDiff(stockReturn60d, sectorReturn60d);
  // ADR-0572 D1: rank 도 raw → canonical(L1) → basket fallback. flag OFF → canonical null → basket(byte-identical).
  const sectorRank20d = numberOrNull(raw.sectorRank20d)
    ?? canonicalSectorRank20d(sector)
    ?? getSectorRank(input.sectorEnergyResult, sector);
  const sectorRank60d = numberOrNull(raw.sectorRank60d);
  const sectorPercentile20d = clampPercentile(numberOrNull(raw.sectorPercentile20d));
  const sectorPercentile60d = clampPercentile(numberOrNull(raw.sectorPercentile60d));
  // ADR-0572 D1: leading 도 raw → canonical(L1) → basket fallback. flag OFF → canonical null → basket(byte-identical).
  const currentLeadingSector = boolOrNull(raw.isCurrentLeadingSector)
    ?? canonicalIsLeadingSector(sector)
    ?? isLeadingSector(input.sectorEnergyResult, sector);
  const sectorLeader = boolOrNull(raw.isSectorLeader)
    ?? (stockVsSectorReturn20d == null ? null : stockVsSectorReturn20d > 0);
  const previousLeader = boolOrNull(raw.isPreviousCycleLeader);
  const newLeaderCandidate = boolOrNull(raw.isNewLeaderCandidate)
    ?? (currentLeadingSector === true && previousLeader === false ? true : null);
  const newsFrequency30d = numberOrNull(raw.newsFrequency30d ?? quote.newsFrequency30d);
  const newsCrowdingScore = numberOrNull(raw.newsCrowdingScore ?? quote.newsCrowdingScore);
  const attention = attentionPhase(newsFrequency30d, newsCrowdingScore);
  const leaderCyclePhase = leaderPhase({
    explicit: raw.leaderCyclePhase,
    isCurrentLeadingSector: currentLeadingSector,
    isSectorLeader: sectorLeader,
    isPreviousCycleLeader: previousLeader,
    stockVsSectorReturn20d,
    sectorRelativeReturn20d,
    attentionPhase: attention,
  });
  const coverage = rawFieldCoverage({ sector, stockReturn20d, sectorReturn20d });
  const explicitStatus = normalizeProviderStatus(raw.providerStatus ?? raw.status);
  const status = explicitStatus
    ?? (coverage.allRequiredFieldsPresent ? 'OK_WITH_DATA' : sector ? 'PARTIAL_WITH_DATA' : 'FIELD_MISSING');
  const confidence = normalizeConfidence(raw.dataConfidence ?? raw.confidence)
    ?? confidenceForSectorThemeCycleStatus(status);

  return {
    symbol: input.symbol.padStart(6, '0'),
    sector,
    industry,
    themeTags,
    market,
    sectorReturn20d,
    sectorReturn60d,
    benchmarkReturn20d,
    benchmarkReturn60d,
    sectorRelativeReturn20d,
    sectorRelativeReturn60d,
    stockReturn20d,
    stockReturn60d,
    stockVsSectorReturn20d,
    stockVsSectorReturn60d,
    sectorRank20d,
    sectorRank60d,
    sectorPercentile20d,
    sectorPercentile60d,
    leaderCyclePhase,
    isCurrentLeadingSector: currentLeadingSector,
    isSectorLeader: sectorLeader,
    isPreviousCycleLeader: previousLeader,
    isNewLeaderCandidate: newLeaderCandidate,
    newsFrequency30d,
    newsCrowdingScore,
    attentionPhase: attention,
    source: normalizeSource(raw.source ?? raw.provider ?? (sector ? 'QMP_SECTOR_MAP' : 'UNKNOWN')),
    providerStatus: status,
    dataConfidence: confidence,
    providerIssue: providerIssueForStatus(status),
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    rawFieldCoverage: coverage,
    notes: [
      ...(sector ? [] : ['SECTOR_CLASSIFICATION_MISSING']),
      ...(themeTags.length > 0 ? [] : ['THEME_TAGS_MISSING']),
      ...(currentLeadingSector == null ? ['LEADING_SECTOR_UNKNOWN'] : []),
      'DIAGNOSTIC_ONLY_NO_SCORE_IMPACT',
    ],
  };
}
