// @responsibility ADR-0495 Sector Index master/mapping/fallback static seed repair; diagnostic-only, no live execution.

export type SectorIndexCategory =
  | 'KRX_SECTOR'
  | 'KRX_INDUSTRY'
  | 'KRX_THEME'
  | 'KOSPI_INDUSTRY'
  | 'KOSDAQ_INDUSTRY'
  | 'INTERNAL_PROXY'
  | 'UNKNOWN';

export interface SectorIndexMasterRecord {
  indexCode: string;
  indexNameKo: string;
  indexNameEn?: string;
  market: 'KOSPI' | 'KOSDAQ' | 'KRX' | 'MIXED' | 'UNKNOWN';
  category: SectorIndexCategory;
  isAggregate: boolean;
  isTradeableProxy: boolean;
  provider: 'KRX' | 'INTERNAL' | 'CACHE';
  source: 'STATIC_SEED' | 'SANITIZED_CACHE' | 'MANUAL_MAPPING';
  confidence: 'VERIFIED' | 'PARTIAL' | 'UNKNOWN';
  aliases: string[];
  notes?: string;
}

export type SectorMappingType = 'EXACT' | 'ALIAS' | 'MANUAL' | 'FALLBACK' | 'UNRESOLVED';

export interface SectorIndexCodeMapping {
  sectorName: string;
  canonicalName: string;
  indexCode: string | null;
  confidence: 'VERIFIED' | 'PARTIAL' | 'UNKNOWN';
  mappingType: SectorMappingType;
  aliases: string[];
  isSafeAutoAlias: boolean;
}

export interface SectorEnergyFallbackRecord {
  sectorName: string;
  representativeSymbols: string[];
  fallbackMode: 'STOCK_DAILY_PROXY' | 'ETF_PROXY' | 'INDEX_ONLY' | 'DISABLED';
  confidence: 'PARTIAL' | 'UNKNOWN';
  liveExecutionAllowed: false;
  executionImpact: 'NONE';
  notes?: string;
}

export interface SectorIndexMasterCoverageAdr0495 {
  masterRecordCount: number;
  mappingRecordCount: number;
  fallbackRecordCount: number;
  coverageBefore: number;
  coverageAfter: number;
  coverageVerified: number;
  coveragePartial: number;
  coverageUnknown: number;
  verifiedRecordCount: number;
  partialRecordCount: number;
  unknownRecordCount: number;
  missingIndexCodeCount: number;
  aggregateIgnored: string[];
  aliasMissing: string[];
  safeAliasCandidates: string[];
  unsafeAliasCandidates: string[];
  unresolvedSectorNames: string[];
  normalized: boolean;
  status: 'PARTIAL' | 'OBSERVING' | 'DATA_UNAVAILABLE';
  fallbackMode: SectorEnergyFallbackRecord['fallbackMode'] | 'NONE';
  guardrails: {
    executionImpact: 'NONE';
    liveExecutionAllowed: false;
    rawPayloadPersistenceAllowed: false;
    sectorBoostAllowed: false;
    strongBuyAllowed: false;
    providerIssueMarketSignal: false;
    automaticStagePromotionAllowed: false;
  };
}

const CANONICAL_SECTORS = [
  ['조선', ['조선주']],
  ['방산', ['방산주']],
  ['원자력', ['원전', '원전주', '원자력주']],
  ['반도체', ['반도체주']],
  ['자동차', ['자동차주']],
  ['2차전지', ['이차전지', '배터리', '2차전지주']],
  ['바이오', ['바이오주']],
  ['인터넷', ['인터넷/플랫폼', '플랫폼', '인터넷주']],
  ['게임', ['게임주']],
  ['금융', ['금융주']],
  ['증권', ['증권주']],
  ['보험', ['보험주']],
  ['은행', ['은행주']],
  ['화학', ['화학주']],
  ['정유', ['정유주']],
  ['철강', ['철강주']],
  ['기계', ['기계장비', '기계주']],
  ['건설', ['건설주']],
  ['전기전자', ['전기전자주']],
  ['운송장비', ['운송장비주']],
  ['산업재', ['산업재주']],
  ['필수소비재', ['필수소비재주']],
  ['음식료', ['음식료주']],
  ['유통', ['유통주']],
  ['엔터/미디어', ['엔터', '미디어', '엔터주', '미디어주']],
] as const;

const UNSAFE_ALIAS_MAPPINGS: readonly SectorIndexCodeMapping[] = [
  {
    sectorName: '조방원',
    canonicalName: '조선/방산/원자력',
    indexCode: null,
    confidence: 'UNKNOWN',
    mappingType: 'UNRESOLVED',
    aliases: ['조선+방산+원자력 aggregate basket candidate'],
    isSafeAutoAlias: false,
  },
  {
    sectorName: '플랫폼',
    canonicalName: '인터넷',
    indexCode: null,
    confidence: 'UNKNOWN',
    mappingType: 'UNRESOLVED',
    aliases: ['인터넷/게임/미디어 overlap candidate'],
    isSafeAutoAlias: false,
  },
];

function internalProxyCode(canonicalName: string): string {
  return `INTERNAL_PROXY:${canonicalName}`;
}

export function buildSectorIndexMasterSeedAdr0495(): SectorIndexMasterRecord[] {
  return CANONICAL_SECTORS.map(([canonicalName, aliases]) => ({
    indexCode: internalProxyCode(canonicalName),
    indexNameKo: canonicalName,
    market: 'MIXED',
    category: 'INTERNAL_PROXY',
    isAggregate: false,
    isTradeableProxy: false,
    provider: 'INTERNAL',
    source: 'MANUAL_MAPPING',
    confidence: 'PARTIAL',
    aliases: [canonicalName, ...aliases],
    notes: 'ADR-0495 static diagnostic seed. KRX indexCode is intentionally not asserted until verified.',
  }));
}

export function buildSectorIndexCodeMappingsAdr0495(
  masterRecords: readonly SectorIndexMasterRecord[] = buildSectorIndexMasterSeedAdr0495(),
): SectorIndexCodeMapping[] {
  const mappings: SectorIndexCodeMapping[] = [];
  for (const record of masterRecords) {
    mappings.push({
      sectorName: record.indexNameKo,
      canonicalName: record.indexNameKo,
      indexCode: record.indexCode,
      confidence: record.confidence,
      mappingType: 'EXACT',
      aliases: record.aliases,
      isSafeAutoAlias: true,
    });
    for (const alias of record.aliases.filter((item) => item !== record.indexNameKo)) {
      mappings.push({
        sectorName: alias,
        canonicalName: record.indexNameKo,
        indexCode: record.indexCode,
        confidence: record.confidence,
        mappingType: 'ALIAS',
        aliases: record.aliases,
        isSafeAutoAlias: true,
      });
    }
  }
  return [...mappings, ...UNSAFE_ALIAS_MAPPINGS];
}

export function buildSectorEnergyFallbackSeedAdr0495(
  masterRecords: readonly SectorIndexMasterRecord[] = buildSectorIndexMasterSeedAdr0495(),
): SectorEnergyFallbackRecord[] {
  return masterRecords.map((record) => ({
    sectorName: record.indexNameKo,
    representativeSymbols: [],
    fallbackMode: 'STOCK_DAILY_PROXY',
    confidence: 'PARTIAL',
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    notes: 'Diagnostic-only empty symbol proxy structure; representative symbols must come from verified project watchlists before use.',
  }));
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1_000) / 10;
}

export function evaluateSectorIndexMasterCoverageAdr0495(options: {
  masterRecords?: readonly SectorIndexMasterRecord[];
  mappings?: readonly SectorIndexCodeMapping[];
  fallbackRecords?: readonly SectorEnergyFallbackRecord[];
  coverageBefore?: number;
} = {}): SectorIndexMasterCoverageAdr0495 {
  const masterRecords = options.masterRecords ?? buildSectorIndexMasterSeedAdr0495();
  const mappings = options.mappings ?? buildSectorIndexCodeMappingsAdr0495(masterRecords);
  const fallbackRecords = options.fallbackRecords ?? buildSectorEnergyFallbackSeedAdr0495(masterRecords);
  const nonAggregate = masterRecords.filter((record) => !record.isAggregate);
  const verifiedRecordCount = nonAggregate.filter((record) => record.confidence === 'VERIFIED' && record.provider === 'KRX' && !record.indexCode.startsWith('INTERNAL_PROXY:')).length;
  const partialRecordCount = nonAggregate.filter((record) => record.confidence === 'PARTIAL' || record.indexCode.startsWith('INTERNAL_PROXY:')).length;
  const unknownRecordCount = Math.max(0, nonAggregate.length - verifiedRecordCount - partialRecordCount);
  const missingIndexCodeCount = nonAggregate.filter((record) => record.indexCode.startsWith('INTERNAL_PROXY:') || record.confidence !== 'VERIFIED').length;
  const safeAliasCandidates = mappings.filter((mapping) => mapping.mappingType === 'ALIAS' && mapping.isSafeAutoAlias).map((mapping) => mapping.sectorName);
  const unsafeAliasCandidates = mappings.filter((mapping) => !mapping.isSafeAutoAlias).map((mapping) => mapping.sectorName);
  const unresolvedSectorNames = mappings.filter((mapping) => mapping.mappingType === 'UNRESOLVED' || mapping.indexCode === null).map((mapping) => mapping.sectorName);
  const aliasMissing = mappings.filter((mapping) => mapping.mappingType === 'UNRESOLVED').map((mapping) => mapping.sectorName);
  const coverageVerified = pct(verifiedRecordCount, nonAggregate.length);
  const coveragePartial = pct(partialRecordCount, nonAggregate.length);
  const coverageUnknown = Math.max(0, Math.round((100 - coverageVerified - coveragePartial) * 10) / 10);
  const coverageAfter = Math.min(100, Math.round((coverageVerified + coveragePartial) * 10) / 10);
  const normalized = masterRecords.length > 0 && mappings.length > 0 && fallbackRecords.length > 0;
  return {
    masterRecordCount: masterRecords.length,
    mappingRecordCount: mappings.length,
    fallbackRecordCount: fallbackRecords.length,
    coverageBefore: options.coverageBefore ?? 0,
    coverageAfter,
    coverageVerified,
    coveragePartial,
    coverageUnknown,
    verifiedRecordCount,
    partialRecordCount,
    unknownRecordCount,
    missingIndexCodeCount,
    aggregateIgnored: masterRecords.filter((record) => record.isAggregate).map((record) => record.indexNameKo),
    aliasMissing,
    safeAliasCandidates,
    unsafeAliasCandidates,
    unresolvedSectorNames,
    normalized,
    status: coverageAfter > 0 ? 'PARTIAL' : normalized ? 'OBSERVING' : 'DATA_UNAVAILABLE',
    fallbackMode: fallbackRecords.find((record) => record.fallbackMode !== 'DISABLED')?.fallbackMode ?? 'NONE',
    guardrails: {
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      rawPayloadPersistenceAllowed: false,
      sectorBoostAllowed: false,
      strongBuyAllowed: false,
      providerIssueMarketSignal: false,
      automaticStagePromotionAllowed: false,
    },
  };
}
