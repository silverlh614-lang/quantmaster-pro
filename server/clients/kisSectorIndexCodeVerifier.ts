// @responsibility KIS sector idxcode dry-run compatibility verification.

import { fetchKisSectorIndexDaily } from './kisClient/query.js';
import type { KisSectorIndexDaily, KisSectorIndexDailyRow } from './kisClient/types.js';
import { SECTOR_INDEX_MASTER } from './sectorEnergyMaster.js';

export interface SectorIdxcodeMasterRow {
  iscd: string;
  koreanName: string;
  englishKey?: string;
  aliases?: string[];
}

export type SectorIndexCodeVerificationMatchedBy =
  | 'EXACT_ISCD'
  | 'KOREAN_NAME'
  | 'ENGLISH_KEY'
  | 'ALIAS'
  | 'MANUAL_REGISTRY'
  | 'NONE';

export interface SectorIndexCodeVerificationCandidate {
  iscd: string;
  name?: string;
  matchedBy: SectorIndexCodeVerificationMatchedBy;
  endpointRows?: number;
  latestDate?: string;
  return5dAvailable?: boolean;
  return20dAvailable?: boolean;
  compatible: boolean;
  reason?: string;
}

export interface SectorIndexCodeVerificationResult {
  sectorKey: string;
  sectorNameKo: string;
  originalIscd: string;
  verifiedIscd?: string;
  verifiedName?: string;
  verification:
    | 'VERIFIED'
    | 'SAFE_ALIAS_CANDIDATE_FOUND'
    | 'NO_ALIAS_FOUND'
    | 'UNSAFE_ALIAS_REJECTED'
    | 'UNRESOLVED';
  resolutionStatus:
    | 'IDXCODE_MST_VERIFIED'
    | 'PENDING_IDXCODE_MST_VERIFY'
    | 'IDXCODE_MST_NOT_FOUND'
    | 'ENDPOINT_COMPATIBILITY_FAILED'
    | 'UNRESOLVED_EMPTY';
  matchedBy: SectorIndexCodeVerificationMatchedBy;
  candidatesTried: SectorIndexCodeVerificationCandidate[];
  marketSignal: false;
  executionImpact: 'NONE';
}

export interface SectorIndexMappingRegistryRecord {
  sectorKey: string;
  sectorNameKo: string;
  previousIscd: string;
  verifiedIscd: string;
  verifiedName?: string;
  source: 'IDXCODE_MST';
  matchedBy: SectorIndexCodeVerificationMatchedBy;
  verification: 'VERIFIED';
  resolutionStatus: 'IDXCODE_MST_VERIFIED';
  useForDryRun: true;
  useForProduction: false;
  promotionStage: 'OBSERVE';
  sectorBoostAllowed: false;
  strongBuyAllowed: false;
  executionImpact: 'NONE';
  verifiedAt: string;
}

const STATIC_IDXCODE_MASTER_ROWS: ReadonlyArray<SectorIdxcodeMasterRow> = Object.freeze([
  { iscd: '2001', koreanName: '코스피200', englishKey: 'OTHER', aliases: ['기타', 'KOSPI200 proxy'] },
  { iscd: '2002', koreanName: '자동차', englishKey: 'AUTOMOTIVE', aliases: ['자동차'] },
  { iscd: '2003', koreanName: '유통/소비재', englishKey: 'CONSUMER_RETAIL', aliases: ['유통', '소비재'] },
  { iscd: '2004', koreanName: '반도체', englishKey: 'SEMICONDUCTOR', aliases: ['반도체'] },
  { iscd: '2005', koreanName: '인터넷/플랫폼', englishKey: 'IT_INTERNET', aliases: ['인터넷', '플랫폼', 'IT'] },
  { iscd: '2006', koreanName: '금융', englishKey: 'FINANCE', aliases: ['금융', '은행', '증권', '보험'] },
  { iscd: '2007', koreanName: '철강', englishKey: 'STEEL', aliases: ['철강'] },
  { iscd: '2008', koreanName: '에너지/화학', englishKey: 'CHEMICAL', aliases: ['화학', '에너지'] },
  { iscd: '2009', koreanName: '바이오/헬스케어', englishKey: 'BIO_HEALTHCARE', aliases: ['바이오', '헬스케어'] },
  { iscd: '2010', koreanName: '조선', englishKey: 'SHIPBUILDING', aliases: ['조선'] },
  { iscd: '2011', koreanName: '건설/부동산', englishKey: 'CONSTRUCTION', aliases: ['건설', '부동산'] },
  { iscd: '2012', koreanName: '이차전지', englishKey: 'BATTERY', aliases: ['2차전지', '이차전지', '배터리'] },
]);

const FINANCE_IDXCODE_LOOKUP_TERMS = [
  '금융',
  '금융업',
  '은행',
  '증권',
  '보험',
  '금융지주',
  '기타금융',
  'FINANCE',
  'FINANCIAL',
  'BANK',
  'BANKING',
  'SECURITIES',
  'INSURANCE',
  'FINANCIAL_HOLDING',
];

const IT_INTERNET_IDXCODE_LOOKUP_TERMS = [
  '인터넷',
  '플랫폼',
  '인터넷/플랫폼',
  '소프트웨어',
  'IT서비스',
  '서비스업',
  '디지털',
  '커뮤니케이션서비스',
  '미디어/콘텐츠',
  'IT_INTERNET',
  'INTERNET',
  'PLATFORM',
  'SOFTWARE',
  'IT_SERVICE',
  'DIGITAL',
  'COMMUNICATION_SERVICE',
  'MEDIA_CONTENT',
];

const sectorIndexMappingRegistryRows = new Map<string, SectorIndexMappingRegistryRecord>();
let idxcodeMasterRowsForTests: readonly SectorIdxcodeMasterRow[] | null = null;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundMetric(value: number | undefined): number | undefined {
  if (!finite(value)) return undefined;
  return Math.round(value * 10000) / 10000;
}

function pctChange(from: number, to: number): number {
  if (!finite(from) || from <= 0 || !finite(to)) return 0;
  return ((to - from) / from) * 100;
}

function normalizeLookupText(value: string): string {
  return value.toLowerCase().replace(/[\s/_-]+/g, '').trim();
}

function sortedKisSectorIndexSeries(series: readonly KisSectorIndexDailyRow[]): KisSectorIndexDailyRow[] {
  return [...series]
    .filter((row) => /^\d{8}$/.test(row.baseDate) && finite(row.close) && row.close > 0)
    .sort((a, b) => a.baseDate.localeCompare(b.baseDate));
}

function deriveEndpointMetrics(result: KisSectorIndexDaily): {
  seriesCount: number;
  latestDate?: string;
  return5d?: number;
  return20d?: number;
} {
  const rows = sortedKisSectorIndexSeries(result.series);
  const latest = rows.at(-1);
  return {
    seriesCount: rows.length,
    latestDate: latest?.baseDate,
    return5d: rows.length >= 6 ? roundMetric(pctChange(rows.at(-6)!.close, latest!.close)) : undefined,
    return20d: rows.length >= 21 ? roundMetric(pctChange(rows.at(-21)!.close, latest!.close)) : undefined,
  };
}

function idxcodeLookupTermsForSector(sectorKey: string, sectorNameKo: string, aliasCandidates: readonly string[]): string[] {
  const base = sectorKey === 'FINANCE'
    ? FINANCE_IDXCODE_LOOKUP_TERMS
    : sectorKey === 'IT_INTERNET'
      ? IT_INTERNET_IDXCODE_LOOKUP_TERMS
      : [];
  return Array.from(new Set([sectorNameKo, sectorKey, ...base, ...aliasCandidates].filter(Boolean)));
}

function isFreshDryRunLatestDate(latestDate: string | undefined, nowMs: number, staleWindowDays = 7): boolean {
  if (!latestDate || !/^\d{8}$/.test(latestDate)) return false;
  const latestUtc = Date.UTC(Number(latestDate.slice(0, 4)), Number(latestDate.slice(4, 6)) - 1, Number(latestDate.slice(6, 8)));
  const now = new Date(nowMs + 9 * 60 * 60 * 1000);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayUtc - latestUtc) / (24 * 60 * 60 * 1000)) <= staleWindowDays;
}

function addVerificationCandidate(
  candidates: SectorIndexCodeVerificationCandidate[],
  seen: Set<string>,
  row: SectorIdxcodeMasterRow | undefined,
  iscd: string,
  matchedBy: SectorIndexCodeVerificationMatchedBy,
): void {
  if (!/^\d{4}$/.test(iscd) || seen.has(iscd)) return;
  seen.add(iscd);
  candidates.push({ iscd, name: row?.koreanName, matchedBy, compatible: false });
}

function endpointCompatibility(result: KisSectorIndexDaily | null, nowMs: number): {
  compatible: boolean;
  candidate: Pick<SectorIndexCodeVerificationCandidate, 'endpointRows' | 'latestDate' | 'return5dAvailable' | 'return20dAvailable' | 'reason'>;
} {
  if (!result) return { compatible: false, candidate: { reason: 'ENDPOINT_EMPTY' } };
  const metrics = deriveEndpointMetrics(result);
  const return5dAvailable = finite(metrics.return5d);
  const return20dAvailable = finite(metrics.return20d);
  const latestFresh = isFreshDryRunLatestDate(metrics.latestDate, nowMs);
  const compatible = metrics.seriesCount >= 20 && latestFresh && return5dAvailable && return20dAvailable;
  const reason = metrics.seriesCount < 20
    ? `ROWS_LT_20_${metrics.seriesCount}`
    : !latestFresh
      ? 'LATEST_DATE_STALE'
      : !return5dAvailable
        ? 'RETURN5D_UNAVAILABLE'
        : !return20dAvailable
          ? 'RETURN20D_UNAVAILABLE'
          : undefined;
  return {
    compatible,
    candidate: {
      endpointRows: metrics.seriesCount,
      latestDate: metrics.latestDate,
      return5dAvailable,
      return20dAvailable,
      reason,
    },
  };
}

export const sectorIndexMappingRegistry = {
  update(record: SectorIndexMappingRegistryRecord): void {
    sectorIndexMappingRegistryRows.set(record.sectorKey, record);
  },
  get(sectorKey: string): SectorIndexMappingRegistryRecord | undefined {
    return sectorIndexMappingRegistryRows.get(sectorKey);
  },
  list(): SectorIndexMappingRegistryRecord[] {
    return [...sectorIndexMappingRegistryRows.values()];
  },
  clearForTests(): void {
    sectorIndexMappingRegistryRows.clear();
  },
};

export function setSectorIndexIdxcodeMasterRowsForTests(rows: readonly SectorIdxcodeMasterRow[] | null): void {
  idxcodeMasterRowsForTests = rows;
}

export async function verifySectorIndexCodeWithIdxMaster(input: {
  sectorKey: string;
  sectorNameKo: string;
  currentCandidateIscd: string;
  aliasCandidates: string[];
}, options: {
  masterRows?: readonly SectorIdxcodeMasterRow[];
  endpointFetcher?: (iscd: string) => Promise<KisSectorIndexDaily | null>;
  nowMs?: number;
} = {}): Promise<SectorIndexCodeVerificationResult> {
  const masterRows = options.masterRows ?? idxcodeMasterRowsForTests ?? STATIC_IDXCODE_MASTER_ROWS;
  const endpointFetcher = options.endpointFetcher ?? fetchKisSectorIndexDaily;
  const nowMs = options.nowMs ?? Date.now();
  const originalIscd = input.currentCandidateIscd.trim();
  const terms = idxcodeLookupTermsForSector(input.sectorKey, input.sectorNameKo, input.aliasCandidates).map(normalizeLookupText);
  const candidates: SectorIndexCodeVerificationCandidate[] = [];
  const seen = new Set<string>();
  const exact = masterRows.find((row) => row.iscd === originalIscd);
  if (exact) addVerificationCandidate(candidates, seen, exact, originalIscd, 'EXACT_ISCD');
  for (const row of masterRows) {
    if (terms.includes(normalizeLookupText(row.koreanName))) addVerificationCandidate(candidates, seen, row, row.iscd, 'KOREAN_NAME');
    if (terms.includes(normalizeLookupText(row.englishKey ?? ''))) addVerificationCandidate(candidates, seen, row, row.iscd, 'ENGLISH_KEY');
    if ((row.aliases ?? []).some((alias) => terms.includes(normalizeLookupText(alias)))) addVerificationCandidate(candidates, seen, row, row.iscd, 'ALIAS');
  }
  const manual = SECTOR_INDEX_MASTER.find((entry) => entry.sectorKey === input.sectorKey);
  if (manual?.krxIndexCode && /^\d{4}$/.test(manual.krxIndexCode)) addVerificationCandidate(candidates, seen, undefined, manual.krxIndexCode, 'MANUAL_REGISTRY');
  if (candidates.length === 0) {
    return { sectorKey: input.sectorKey, sectorNameKo: input.sectorNameKo, originalIscd, verification: 'NO_ALIAS_FOUND', resolutionStatus: 'IDXCODE_MST_NOT_FOUND', matchedBy: 'NONE', candidatesTried: [], marketSignal: false, executionImpact: 'NONE' };
  }
  const tried: SectorIndexCodeVerificationCandidate[] = [];
  for (const candidate of candidates) {
    const result = await endpointFetcher(candidate.iscd);
    const compatibility = endpointCompatibility(result, nowMs);
    const triedCandidate = { ...candidate, ...compatibility.candidate, compatible: compatibility.compatible };
    tried.push(triedCandidate);
    if (compatibility.compatible) {
      return { sectorKey: input.sectorKey, sectorNameKo: input.sectorNameKo, originalIscd, verifiedIscd: candidate.iscd, verifiedName: candidate.name ?? result?.sectorName, verification: 'VERIFIED', resolutionStatus: 'IDXCODE_MST_VERIFIED', matchedBy: candidate.matchedBy, candidatesTried: tried, marketSignal: false, executionImpact: 'NONE' };
    }
  }
  return { sectorKey: input.sectorKey, sectorNameKo: input.sectorNameKo, originalIscd, verification: 'SAFE_ALIAS_CANDIDATE_FOUND', resolutionStatus: tried.some((candidate) => candidate.reason !== 'ENDPOINT_EMPTY') ? 'ENDPOINT_COMPATIBILITY_FAILED' : 'PENDING_IDXCODE_MST_VERIFY', matchedBy: 'NONE', candidatesTried: tried, marketSignal: false, executionImpact: 'NONE' };
}
