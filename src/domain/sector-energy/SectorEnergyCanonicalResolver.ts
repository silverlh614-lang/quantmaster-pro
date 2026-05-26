// @responsibility SectorEnergy 최종 판단 단일 SSOT — 공식 11개 섹터 coverage 만으로 promotion/sectorBoost/strongBuy 결정. 나머지 입력은 진단 전용.

/**
 * SectorEnergy Canonical Baseline Lock (ADR-0534)
 *
 * SectorEnergy 의 최종 기준은 오직 SectorEnergyCanonicalResolver 다.
 * KIS basket, internal grouped snapshot, Gate2 Leadership, ADR-0488,
 * grouped sector coverage, old 12/15-sector coverage 는 모두 진단(diagnosticOnly) 으로 강등된다.
 *
 * 모든 모듈은 sourceSnapshot.sectorEnergyCanonicalState 하나만 읽고 그대로 렌더링한다.
 * executionImpact 는 항상 NONE — 본 모듈은 실거래 본체를 바꾸지 않는다.
 */

// ─── 공식 SectorEnergy universe (불변, 정확히 11개) ─────────────────────────────

export const OFFICIAL_SECTOR_ENERGY_11 = [
  'SEMICONDUCTOR_ELECTRONICS',
  'AUTOMOTIVE_TRANSPORT_EQUIPMENT',
  'MACHINERY_EQUIPMENT',
  'CHEMICALS',
  'BIO_HEALTHCARE_PHARMA',
  'STEEL_METALS',
  'CONSTRUCTION',
  'FINANCIALS',
  'CONSUMER_RETAIL',
  'FOOD_BEVERAGE_TOBACCO',
  'SERVICE_TELECOM',
] as const;

export type OfficialSectorEnergyKey = (typeof OFFICIAL_SECTOR_ENERGY_11)[number];

/** 공식 섹터 개수는 언제나 11 — final denominator 는 절대 12/15/basket/grouped 가 아니다. */
export const OFFICIAL_SECTOR_COUNT = 11 as const;

/** Coverage pass 기본 임계값 (verifiedOfficialSectorCount >= 9 → pass). */
export const DEFAULT_REQUIRED_PROMOTION_COVERAGE = 0.8;

const OFFICIAL_SECTOR_SET: ReadonlySet<string> = new Set(OFFICIAL_SECTOR_ENERGY_11);

// ─── Theme Tag 제외 정책 (공식 섹터 아님 — themeTag/shadowEvidence 전용) ──────────

export const EXCLUDED_THEME_TAGS = ['조선', '방산', '원자력', '이차전지'] as const;

export type ExcludedThemeTag = (typeof EXCLUDED_THEME_TAGS)[number];

export interface ThemeTagPolicyEntry {
  themeTagOnly: true;
  includeInSectorEnergyUniverse: false;
  includeInPromotionDenominator: false;
  includeInPromotionNumerator: false;
  useForLivePromotion: false;
  useForSectorBoost: false;
  useForStrongBuy: false;
  useForShadowEvidence: true;
  executionImpact: 'NONE';
}

const THEME_TAG_POLICY_ENTRY: ThemeTagPolicyEntry = {
  themeTagOnly: true,
  includeInSectorEnergyUniverse: false,
  includeInPromotionDenominator: false,
  includeInPromotionNumerator: false,
  useForLivePromotion: false,
  useForSectorBoost: false,
  useForStrongBuy: false,
  useForShadowEvidence: true,
  executionImpact: 'NONE',
};

export const SECTOR_THEME_TAG_POLICY: Readonly<Record<ExcludedThemeTag, ThemeTagPolicyEntry>> = {
  [EXCLUDED_THEME_TAGS[0]]: THEME_TAG_POLICY_ENTRY,
  [EXCLUDED_THEME_TAGS[1]]: THEME_TAG_POLICY_ENTRY,
  [EXCLUDED_THEME_TAGS[2]]: THEME_TAG_POLICY_ENTRY,
  [EXCLUDED_THEME_TAGS[3]]: THEME_TAG_POLICY_ENTRY,
};

// ─── Canonical State 타입 ──────────────────────────────────────────────────────

export type SectorEnergySelectedSourceTier =
  | 'OFFICIAL_KIS_SECTOR_INDEX'
  | 'OFFICIAL_KRX_SECTOR_INDEX'
  | 'NONE';

export type SectorEnergyDataQuality = 'VERIFIED' | 'PARTIAL' | 'MISSING';

export type SectorEnergyCanonicalReason =
  | 'OFFICIAL_SECTOR_COVERAGE_PASS'
  | 'OFFICIAL_SECTOR_COVERAGE_BELOW_THRESHOLD'
  | 'OFFICIAL_SECTOR_SOURCE_MISSING'
  | 'SECTOR_ENERGY_CANONICAL_STATE_MISSING';

export interface SectorEnergyCanonicalState {
  sourceOfTruth: 'SectorEnergyCanonicalResolver';
  universeType: 'OFFICIAL_SECTOR_ONLY';

  officialSectorCount: 11;
  verifiedOfficialSectorCount: number;
  verifiedOfficialSectorKeys: OfficialSectorEnergyKey[];
  missingOfficialSectorKeys: OfficialSectorEnergyKey[];
  duplicateAliasRowsIgnored: string[];

  promotionCoverage: number;
  requiredPromotionCoverage: number;
  promotionCoveragePass: boolean;

  promotionAllowed: boolean;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;

  shadowLeadershipAllowed: boolean;
  counterfactualAllowed: boolean;

  selectedSourceTier: SectorEnergySelectedSourceTier;

  dataQuality: SectorEnergyDataQuality;
  confidence: SectorEnergyDataQuality;

  excludedThemeTags: readonly ['조선', '방산', '원자력', '이차전지'];

  executionImpact: 'NONE';
  reason: SectorEnergyCanonicalReason;
}

// ─── Resolver 입력 ─────────────────────────────────────────────────────────────

/**
 * 공식 sector index 입력 — 어느 공식 섹터가 VERIFIED 인지만 표현한다.
 * 다음 형태를 허용한다:
 *   - 공식 섹터 key 배열 (VERIFIED 인 것만)
 *   - { verifiedSectors: string[] }
 *   - { verifiedCount: number }  (통합 경계 어댑터용 — count → 앞에서부터 N개 공식 key)
 *   - { sectors: Record<key, { verified?: boolean; status?: string }> }
 */
export interface OfficialSectorIndexObject {
  verifiedSectors?: readonly string[];
  verifiedCount?: number;
  sectors?: Record<string, { verified?: boolean; status?: string } | undefined>;
}

export type OfficialSectorIndexInput = readonly string[] | OfficialSectorIndexObject | null | undefined;

export interface ResolveSectorEnergyCanonicalInput {
  officialKisSectorIndex?: OfficialSectorIndexInput;
  officialKrxSectorIndex?: OfficialSectorIndexInput;
  /** 진단 전용 — final 판단에 사용 금지. */
  kisBasketDerived?: unknown;
  /** 진단 전용 — final 판단에 사용 금지. */
  internalGroupedSnapshot?: unknown;
  /** 진단 전용 — old 12/15 sector target coverage. */
  oldOfficialTargetCoverage?: number;
  requiredPromotionCoverage?: number;
  /** TopBlock 일관성 강제는 enforceSectorEnergyTopBlockConsistency 가 별도로 처리한다. */
  topBlocks?: string[];
  officialIndexMasterRows?: IndexMasterRow[];
  indexVerifyResults?: IndexVerifyResult[];
  safePromotionEligibleSectorCount?: number;
  safeOfficialVerifiedCoverage?: number;
  sectorIndexVerifySuccessCount?: number;
}

export interface IndexMasterRow {
  indexCode?: string;
  indexName?: string;
  sectorName?: string;
}
export interface IndexVerifyResult {
  indexCode?: string;
  indexName?: string;
  success?: boolean;
  verified?: boolean;
  indexValueUsable?: boolean;
}
type VerifiedMapping = Record<OfficialSectorEnergyKey, {
  verified: boolean; selectedIndexCode?: string; selectedIndexName?: string; verifyReason?: string;
  sourceTier?: 'OFFICIAL_KIS_SECTOR_INDEX' | 'OFFICIAL_KRX_SECTOR_INDEX';
}>;

const OFFICIAL_SECTOR_ALIAS_MAP: Record<OfficialSectorEnergyKey, { aliases: string[]; preferredIndexCodes: string[] }> = {
  SEMICONDUCTOR_ELECTRONICS: { aliases: ['반도체', 'SEMICONDUCTOR', '전기전자', '전기·전자', 'KRX 반도체'], preferredIndexCodes: ['4003', '0013'] },
  AUTOMOTIVE_TRANSPORT_EQUIPMENT: { aliases: ['자동차', 'AUTOMOTIVE', '운수장비', '운송장비', 'KRX 자동차'], preferredIndexCodes: ['4002'] },
  MACHINERY_EQUIPMENT: { aliases: ['기계', '기계장비', '기계 장비', '기계·장비', 'KRX 기계장비', 'MACHINERY', 'MACHINERY_EQUIPMENT'], preferredIndexCodes: ['0012', '4014'] },
  CHEMICALS: { aliases: ['화학', 'CHEMICALS', '에너지화학', 'KRX 에너지화학'], preferredIndexCodes: ['0008', '4007'] },
  BIO_HEALTHCARE_PHARMA: { aliases: ['바이오/헬스케어', '헬스케어', '의약품', 'KRX 헬스케어'], preferredIndexCodes: ['4004'] },
  STEEL_METALS: { aliases: ['철강', '철강금속', '철강·금속', 'KRX 철강'], preferredIndexCodes: ['4008'] },
  CONSTRUCTION: { aliases: ['건설', '건설업', 'KRX 건설'], preferredIndexCodes: ['0018', '4011'] },
  FINANCIALS: { aliases: ['금융', '은행', '증권', '보험', 'FINANCIALS'], preferredIndexCodes: ['0021', '4005', '4013', '4015'] },
  CONSUMER_RETAIL: { aliases: ['유통/소비재', '유통 소비재', '유통소비재', '유통', '유통업', 'CONSUMER_RETAIL', '경기소비재', '필수소비재'], preferredIndexCodes: ['0016', '4061', '4062'] },
  FOOD_BEVERAGE_TOBACCO: { aliases: ['음식료', '음식료·담배', '음식료 담배', '음식료담배', 'FOOD_BEVERAGE_TOBACCO'], preferredIndexCodes: ['0005'] },
  SERVICE_TELECOM: { aliases: ['서비스', '서비스업', '통신', '방송통신', 'KRX 방송통신', '미디어&엔터테인먼트', 'KRX 미디어&엔터테인먼트', 'SERVICE', 'TELECOM', 'SERVICE_TELECOM'], preferredIndexCodes: ['4010', '4063'] },
};

/**
 * ADR-0535 회귀 가드: official key 매핑 누락 invariant. alias map 내용과 독립적으로
 * 코드/이름 증거를 직접 본다 — verify 성공 증거가 입력에 존재하는데 해당 공식 key 가
 * missing 으로 빠지면 throw 한다 (CONSUMER_RETAIL/FOOD_BEVERAGE_TOBACCO/SERVICE_TELECOM).
 */

function normalizeSectorLabel(value: string): string {
  return value
    .toUpperCase()
    .replace(/^KRX\s*/u, '')
    .replace(/[·&/]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function findIndexRowsByAliasesOrPreferredCodes(
  rows: readonly IndexMasterRow[],
  mapping: { aliases: string[]; preferredIndexCodes: string[] },
): IndexMasterRow[] {
  const preferred = new Set(mapping.preferredIndexCodes.map((code) => String(code).trim()));
  const aliasRaw = new Set(mapping.aliases.map((a) => String(a).trim()));
  const aliasNormalized = new Set(mapping.aliases.map((a) => normalizeSectorLabel(String(a))));
  return rows.filter((row) => {
    const code = String(row.indexCode ?? '').trim();
    const rawName = String(row.sectorName ?? row.indexName ?? '').trim();
    const normalized = normalizeSectorLabel(rawName);
    if (preferred.has(code)) return true;
    if (aliasRaw.has(rawName)) return true;
    if (aliasNormalized.has(normalized)) return true;
    return false;
  });
}
const SECTOR_COVERAGE_CRITICAL_INVARIANTS: ReadonlyArray<{
  key: OfficialSectorEnergyKey;
  evidenceCodes: readonly string[];
  evidenceNames: readonly string[];
}> = [
  {
    key: 'MACHINERY_EQUIPMENT',
    evidenceCodes: ['0012', '4014'],
    evidenceNames: ['기계', '기계장비', '기계 장비', '기계·장비', 'KRX 기계장비'],
  },
  {
    key: 'CONSUMER_RETAIL',
    evidenceCodes: ['0016', '4061', '4062'],
    evidenceNames: ['유통/소비재', '유통', '유통업', '유통 소비재', '유통소비재', '경기소비재', '필수소비재'],
  },
  {
    key: 'FOOD_BEVERAGE_TOBACCO',
    evidenceCodes: ['0005'],
    evidenceNames: ['음식료', '음식료·담배', '음식료 담배', '음식료담배'],
  },
  {
    key: 'SERVICE_TELECOM',
    evidenceCodes: ['4010', '4063'],
    evidenceNames: ['서비스', '서비스업', '통신', '방송통신', '미디어&엔터테인먼트', 'KRX 방송통신', 'KRX 미디어&엔터테인먼트'],
  },
];

function verifiedIndexCodeSet(indexVerifyResults: readonly IndexVerifyResult[]): Set<string> {
  return new Set(
    indexVerifyResults
      .filter((r) => (r.success ?? r.verified) && r.indexValueUsable !== false)
      .map((r) => String(r.indexCode ?? '').trim())
      .filter(Boolean),
  );
}

export function assertSectorEnergyCoverageInvariants(
  coverage: { missingOfficialSectorKeys: readonly OfficialSectorEnergyKey[] },
  input: { officialIndexMasterRows: readonly IndexMasterRow[]; indexVerifyResults: readonly IndexVerifyResult[] },
): void {
  const missing = new Set<OfficialSectorEnergyKey>(coverage.missingOfficialSectorKeys);
  if (missing.size === 0) return;
  const verifiedCodes = verifiedIndexCodeSet(input.indexVerifyResults);
  for (const inv of SECTOR_COVERAGE_CRITICAL_INVARIANTS) {
    if (!missing.has(inv.key)) continue;
    const codeEvidence = inv.evidenceCodes.some((c) => verifiedCodes.has(c));
    const nameEvidence = input.officialIndexMasterRows.some((row) => {
      const name = String(row.sectorName ?? row.indexName ?? '').trim();
      const code = String(row.indexCode ?? '').trim();
      return inv.evidenceNames.includes(name) && verifiedCodes.has(code);
    });
    if (codeEvidence || nameEvidence) {
      throw new Error(`SECTOR_ENERGY_COVERAGE_INVARIANT_VIOLATION:${inv.key}`);
    }
  }
}

export function resolveOfficialSectorEnergyCoverage(input: {
  officialIndexMasterRows: IndexMasterRow[]; indexVerifyResults: IndexVerifyResult[]; officialSectorKeys?: OfficialSectorEnergyKey[];
}): { officialSectorCount: 11; verifiedOfficialSectorCount: number; verifiedOfficialSectorKeys: OfficialSectorEnergyKey[]; missingOfficialSectorKeys: OfficialSectorEnergyKey[]; verifiedMapping: VerifiedMapping; duplicateAliasRowsIgnored: string[] } {
  const keys = [...OFFICIAL_SECTOR_ENERGY_11];
  const verifiedCodes = new Set(input.indexVerifyResults.filter((r) => (r.success ?? r.verified) && r.indexValueUsable !== false).map((r) => String(r.indexCode ?? '').trim()).filter(Boolean));
  const duplicateAliasRowsIgnored: string[] = [];
  const verifiedMapping = {} as VerifiedMapping;
  const verifiedOfficialSectorKeys: OfficialSectorEnergyKey[] = [];
  for (const key of keys) {
    const cfg = OFFICIAL_SECTOR_ALIAS_MAP[key];
    const matches = findIndexRowsByAliasesOrPreferredCodes(input.officialIndexMasterRows, cfg);
    let selected = matches.find((m) => verifiedCodes.has(String(m.indexCode ?? '').trim()) && cfg.preferredIndexCodes.includes(String(m.indexCode ?? '').trim()));
    if (!selected) selected = matches.find((m) => verifiedCodes.has(String(m.indexCode ?? '').trim()));
    const dedup = new Set<string>();
    for (const m of matches) {
      const code = String(m.indexCode ?? '').trim();
      if (!code) continue;
      if (dedup.has(code)) duplicateAliasRowsIgnored.push(`${key}:${code}`);
      dedup.add(code);
    }
    const verified = Boolean(selected && verifiedCodes.has(String(selected.indexCode ?? '').trim()));
    verifiedMapping[key] = verified ? { verified, selectedIndexCode: String(selected?.indexCode ?? ''), selectedIndexName: selected?.indexName ?? selected?.sectorName, verifyReason: 'VERIFY_SUCCESS', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' } : { verified: false, selectedIndexCode: 'NONE', verifyReason: matches.length === 0 ? 'INDEX_MASTER_ROW_NOT_FOUND' : 'VERIFY_FAILED' };
    if (verified) verifiedOfficialSectorKeys.push(key);
  }
  const missingOfficialSectorKeys = keys.filter((k) => !verifiedOfficialSectorKeys.includes(k));
  assertSectorEnergyCoverageInvariants(
    { missingOfficialSectorKeys },
    { officialIndexMasterRows: input.officialIndexMasterRows, indexVerifyResults: input.indexVerifyResults },
  );
  return { officialSectorCount: 11, verifiedOfficialSectorCount: verifiedOfficialSectorKeys.length, verifiedOfficialSectorKeys, missingOfficialSectorKeys, verifiedMapping, duplicateAliasRowsIgnored };
}

// ─── 공식 verified 섹터 추출 (오직 공식 11개 중에서만 카운트) ──────────────────

function clampOfficialCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const floored = Math.floor(n);
  return floored > OFFICIAL_SECTOR_COUNT ? OFFICIAL_SECTOR_COUNT : floored;
}

/**
 * 입력에서 VERIFIED 상태인 공식 섹터 집합을 추출한다.
 * 조선/방산/원자력/이차전지 등 비공식 항목은 OFFICIAL_SECTOR_SET 필터로 자동 제외된다.
 */
function extractVerifiedOfficialSectors(raw: OfficialSectorIndexInput): Set<OfficialSectorEnergyKey> {
  const verified = new Set<OfficialSectorEnergyKey>();
  if (raw === null || raw === undefined) return verified;

  const keep = (name: unknown): void => {
    if (typeof name === 'string' && OFFICIAL_SECTOR_SET.has(name)) {
      verified.add(name as OfficialSectorEnergyKey);
    }
  };

  if (Array.isArray(raw)) {
    for (const name of raw) keep(name);
    return verified;
  }

  const obj = raw as OfficialSectorIndexObject;

  // verifiedSectors 우선
  if (Array.isArray(obj.verifiedSectors)) {
    for (const name of obj.verifiedSectors) keep(name);
  }

  // sectors map: verified===true 또는 status==='VERIFIED'
  if (obj.sectors && typeof obj.sectors === 'object') {
    for (const [name, meta] of Object.entries(obj.sectors)) {
      if (meta && (meta.verified === true || meta.status === 'VERIFIED')) keep(name);
    }
  }

  // verifiedCount: 통합 경계 어댑터 — count → 공식 key 앞에서부터 N개
  // (canonical state 는 specific key 가 아니라 count 만으로 판단하므로 동치)
  if (verified.size === 0 && typeof obj.verifiedCount === 'number') {
    const count = clampOfficialCount(obj.verifiedCount);
    for (let i = 0; i < count; i += 1) verified.add(OFFICIAL_SECTOR_ENERGY_11[i]);
  }

  return verified;
}

/** 공식 index 입력이 source tier 로 선택 가능한지 — 입력이 제공되고 VERIFIED 가 1개 이상. */
function isSourceUsable(verified: Set<OfficialSectorEnergyKey>): boolean {
  return verified.size > 0;
}

// ─── Resolver 본체 ─────────────────────────────────────────────────────────────

export function resolveSectorEnergyCanonicalState(
  input: ResolveSectorEnergyCanonicalInput,
): SectorEnergyCanonicalState {
  const officialSectorCount = OFFICIAL_SECTOR_COUNT;
  const requiredPromotionCoverage = input.requiredPromotionCoverage ?? DEFAULT_REQUIRED_PROMOTION_COVERAGE;

  const kisVerified = extractVerifiedOfficialSectors(input.officialKisSectorIndex);
  const krxVerified = extractVerifiedOfficialSectors(input.officialKrxSectorIndex);

  // selectedSourceTier: OFFICIAL_KIS_SECTOR_INDEX → OFFICIAL_KRX_SECTOR_INDEX → NONE
  let selectedSourceTier: SectorEnergySelectedSourceTier = 'NONE';
  let verified: Set<OfficialSectorEnergyKey> = new Set();
  if (isSourceUsable(kisVerified)) {
    selectedSourceTier = 'OFFICIAL_KIS_SECTOR_INDEX';
    verified = kisVerified;
  } else if (isSourceUsable(krxVerified)) {
    selectedSourceTier = 'OFFICIAL_KRX_SECTOR_INDEX';
    verified = krxVerified;
  }

  const verifiedOfficialSectorCount = verified.size;
  const verifiedOfficialSectorKeys = [...OFFICIAL_SECTOR_ENERGY_11].filter((k) => verified.has(k));
  const missingOfficialSectorKeys = [...OFFICIAL_SECTOR_ENERGY_11].filter((k) => !verified.has(k));
  const duplicateAliasRowsIgnored: string[] = [];
  if (Array.isArray(input.officialIndexMasterRows) && Array.isArray(input.indexVerifyResults)) {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: input.officialIndexMasterRows,
      indexVerifyResults: input.indexVerifyResults,
    });
    if (coverage.verifiedOfficialSectorCount !== verifiedOfficialSectorCount) throw new Error('CANONICAL_SECTOR_COUNT_MISMATCH');
  }
  const promotionCoverage = verifiedOfficialSectorCount / officialSectorCount;
  const promotionCoveragePass = promotionCoverage >= requiredPromotionCoverage;

  // sectorBoost/strongBuy 는 공식 11개에만 적용 — promotion gate 와 동일하게 잠금.
  const promotionAllowed = promotionCoveragePass;
  const sectorBoostAllowed = promotionCoveragePass;
  const strongBuyAllowed = promotionCoveragePass;

  let dataQuality: SectorEnergyDataQuality;
  if (verifiedOfficialSectorCount === officialSectorCount) {
    dataQuality = 'VERIFIED';
  } else if (verifiedOfficialSectorCount > 0) {
    dataQuality = 'PARTIAL';
  } else {
    dataQuality = 'MISSING';
  }

  let reason: SectorEnergyCanonicalReason;
  if (selectedSourceTier === 'NONE') {
    reason = 'OFFICIAL_SECTOR_SOURCE_MISSING';
  } else if (promotionCoveragePass) {
    reason = 'OFFICIAL_SECTOR_COVERAGE_PASS';
  } else {
    reason = 'OFFICIAL_SECTOR_COVERAGE_BELOW_THRESHOLD';
  }

  return {
    sourceOfTruth: 'SectorEnergyCanonicalResolver',
    universeType: 'OFFICIAL_SECTOR_ONLY',
    officialSectorCount,
    verifiedOfficialSectorCount,
    verifiedOfficialSectorKeys,
    missingOfficialSectorKeys,
    duplicateAliasRowsIgnored,
    promotionCoverage,
    requiredPromotionCoverage,
    promotionCoveragePass,
    promotionAllowed,
    sectorBoostAllowed,
    strongBuyAllowed,
    shadowLeadershipAllowed: true,
    counterfactualAllowed: true,
    selectedSourceTier,
    dataQuality,
    confidence: dataQuality,
    excludedThemeTags: EXCLUDED_THEME_TAGS,
    executionImpact: 'NONE',
    reason,
  };
}

export function missingSectorEnergyCanonicalState(): SectorEnergyCanonicalState {
  return {
    sourceOfTruth: 'SectorEnergyCanonicalResolver',
    universeType: 'OFFICIAL_SECTOR_ONLY',
    officialSectorCount: OFFICIAL_SECTOR_COUNT,
    verifiedOfficialSectorCount: 0,
    verifiedOfficialSectorKeys: [],
    missingOfficialSectorKeys: [...OFFICIAL_SECTOR_ENERGY_11],
    duplicateAliasRowsIgnored: [],
    promotionCoverage: 0,
    requiredPromotionCoverage: DEFAULT_REQUIRED_PROMOTION_COVERAGE,
    promotionCoveragePass: false,
    promotionAllowed: false,
    sectorBoostAllowed: false,
    strongBuyAllowed: false,
    shadowLeadershipAllowed: true,
    counterfactualAllowed: true,
    selectedSourceTier: 'NONE',
    dataQuality: 'MISSING',
    confidence: 'MISSING',
    excludedThemeTags: EXCLUDED_THEME_TAGS,
    executionImpact: 'NONE',
    reason: 'SECTOR_ENERGY_CANONICAL_STATE_MISSING',
  };
}

export function isSectorEnergyCanonicalState(value: unknown): value is SectorEnergyCanonicalState {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  return Boolean(
    record &&
    record.sourceOfTruth === 'SectorEnergyCanonicalResolver' &&
    record.universeType === 'OFFICIAL_SECTOR_ONLY' &&
    record.officialSectorCount === OFFICIAL_SECTOR_COUNT &&
    typeof record.verifiedOfficialSectorCount === 'number' &&
    typeof record.promotionCoverage === 'number' &&
    typeof record.requiredPromotionCoverage === 'number' &&
    typeof record.promotionCoveragePass === 'boolean' &&
    typeof record.promotionAllowed === 'boolean' &&
    typeof record.sectorBoostAllowed === 'boolean' &&
    typeof record.strongBuyAllowed === 'boolean',
  );
}

export function sectorEnergyCanonicalOrMissing(
  canonical: SectorEnergyCanonicalState | null | undefined,
): SectorEnergyCanonicalState {
  return isSectorEnergyCanonicalState(canonical) ? canonical : missingSectorEnergyCanonicalState();
}

type SectorEnergyCanonicalLockedKey =
  | 'sourceOfTruth'
  | 'universeType'
  | 'officialSectorCount'
  | 'verifiedOfficialSectorCount'
  | 'promotionCoverage'
  | 'requiredPromotionCoverage'
  | 'promotionCoveragePass'
  | 'promotionAllowed'
  | 'sectorBoostAllowed'
  | 'strongBuyAllowed'
  | 'shadowLeadershipAllowed'
  | 'counterfactualAllowed'
  | 'selectedSourceTier'
  | 'dataQuality'
  | 'confidence'
  | 'executionImpact'
  | 'reason'
  | 'canonicalLocked';

export type SectorEnergyCanonicalLockedOutput<T extends Record<string, any>> = Omit<T, SectorEnergyCanonicalLockedKey> & {
  sourceOfTruth: SectorEnergyCanonicalState['sourceOfTruth'];
  universeType: SectorEnergyCanonicalState['universeType'];
  officialSectorCount: SectorEnergyCanonicalState['officialSectorCount'];
  verifiedOfficialSectorCount: SectorEnergyCanonicalState['verifiedOfficialSectorCount'];
  promotionCoverage: SectorEnergyCanonicalState['promotionCoverage'];
  requiredPromotionCoverage: SectorEnergyCanonicalState['requiredPromotionCoverage'];
  promotionCoveragePass: SectorEnergyCanonicalState['promotionCoveragePass'];
  promotionAllowed: SectorEnergyCanonicalState['promotionAllowed'];
  sectorBoostAllowed: SectorEnergyCanonicalState['sectorBoostAllowed'];
  strongBuyAllowed: SectorEnergyCanonicalState['strongBuyAllowed'];
  shadowLeadershipAllowed: SectorEnergyCanonicalState['shadowLeadershipAllowed'];
  counterfactualAllowed: SectorEnergyCanonicalState['counterfactualAllowed'];
  selectedSourceTier: SectorEnergyCanonicalState['selectedSourceTier'];
  dataQuality: SectorEnergyCanonicalState['dataQuality'];
  confidence: SectorEnergyCanonicalState['confidence'];
  executionImpact: SectorEnergyCanonicalState['executionImpact'];
  reason: SectorEnergyCanonicalState['reason'];
  canonicalLocked: true;
};

export function lockSectorEnergyOutputToCanonical<T extends Record<string, any>>(
  legacyOrDiagnosticBlock: T,
  canonical: SectorEnergyCanonicalState,
): SectorEnergyCanonicalLockedOutput<T> {
  return {
    ...legacyOrDiagnosticBlock,

    sourceOfTruth: canonical.sourceOfTruth,
    universeType: canonical.universeType,

    officialSectorCount: canonical.officialSectorCount,
    verifiedOfficialSectorCount: canonical.verifiedOfficialSectorCount,

    promotionCoverage: canonical.promotionCoverage,
    requiredPromotionCoverage: canonical.requiredPromotionCoverage,
    promotionCoveragePass: canonical.promotionCoveragePass,

    promotionAllowed: canonical.promotionAllowed,
    sectorBoostAllowed: canonical.sectorBoostAllowed,
    strongBuyAllowed: canonical.strongBuyAllowed,

    shadowLeadershipAllowed: canonical.shadowLeadershipAllowed,
    counterfactualAllowed: canonical.counterfactualAllowed,

    selectedSourceTier: canonical.selectedSourceTier,
    dataQuality: canonical.dataQuality,
    confidence: canonical.confidence,

    executionImpact: canonical.executionImpact,
    reason: canonical.reason,

    canonicalLocked: true,
  };
}

// ─── TopBlock 일관성 강제 ───────────────────────────────────────────────────────

export const SECTOR_OFFICIAL_PROMOTION_DISABLED = 'SECTOR_OFFICIAL_PROMOTION_DISABLED';

/**
 * TopBlocks 를 canonical 과 강제로 일치시킨다.
 *   promotionAllowed=false → SECTOR_OFFICIAL_PROMOTION_DISABLED 반드시 포함
 *   promotionAllowed=true  → SECTOR_OFFICIAL_PROMOTION_DISABLED 반드시 제거
 */
export function enforceSectorEnergyTopBlockConsistency(
  canonical: SectorEnergyCanonicalState,
  topBlocks: string[],
): string[] {
  const next = topBlocks.filter((b) => b !== SECTOR_OFFICIAL_PROMOTION_DISABLED);
  if (canonical.promotionAllowed === false) {
    next.push(SECTOR_OFFICIAL_PROMOTION_DISABLED);
  }
  return next;
}

export const enforceSectorEnergyTopBlocks = enforceSectorEnergyTopBlockConsistency;

/**
 * canonical 과 TopBlocks 가 모순이면 throw 한다 (테스트·런타임 가드).
 * 금지 조합:
 *   - SECTOR_OFFICIAL_PROMOTION_DISABLED 존재 + strongBuyAllowed=true
 *   - SECTOR_OFFICIAL_PROMOTION_DISABLED 존재 + promotionAllowed=true
 */
export function assertSectorEnergyTopBlockConsistency(
  canonical: SectorEnergyCanonicalState,
  topBlocks: readonly string[],
): void {
  const hasDisabled = topBlocks.includes(SECTOR_OFFICIAL_PROMOTION_DISABLED);
  if (hasDisabled && (canonical.strongBuyAllowed === true || canonical.promotionAllowed === true)) {
    throw new Error('SECTOR_ENERGY_CANONICAL_TOPBLOCK_CONFLICT');
  }
}

/**
 * legacy 모듈이 canonical 과 다른 promotionAllowed 를 emit 할 때 canonical 값으로 override 한다.
 * renderer 는 항상 canonical 값을 쓴다. mismatch 는 코드로 표시만 한다.
 */
export function overrideWithCanonicalPromotion(
  canonical: SectorEnergyCanonicalState,
  legacy: { promotionAllowed?: boolean } | null | undefined,
): { promotionAllowed: boolean; mismatch: boolean; mismatchCode?: 'CANONICAL_STATE_MISMATCH' } {
  const legacyValue = legacy?.promotionAllowed;
  const mismatch = typeof legacyValue === 'boolean' && legacyValue !== canonical.promotionAllowed;
  return {
    promotionAllowed: canonical.promotionAllowed,
    mismatch,
    ...(mismatch ? { mismatchCode: 'CANONICAL_STATE_MISMATCH' as const } : {}),
  };
}

// ─── Renderer Override (ADR-0534): legacy 결정 필드를 canonical 으로 덮어쓴다 ─────

/** canonical.dataQuality → legacy leadershipConfidence enum 매핑. */
type LegacyLeadershipConfidence = 'VERIFIED' | 'PARTIAL' | 'SHADOW_ONLY' | 'BLOCKED';
function leadershipConfidenceFromCanonical(canonical: SectorEnergyCanonicalState): LegacyLeadershipConfidence {
  if (canonical.promotionCoveragePass) return 'VERIFIED';
  // 공식 source 없음(MISSING)이라도 shadowLeadershipAllowed=true 이므로 SHADOW_ONLY (BLOCKED 아님).
  if (canonical.dataQuality === 'MISSING') return 'SHADOW_ONLY';
  return 'PARTIAL';
}

/** 모든 SectorEnergy 출력 객체에 추가되는 canonical 결정/진단 overlay 필드. */
export interface SectorEnergyCanonicalOverlay {
  promotionAllowed: boolean;
  sectorBoostAllowed: boolean;
  strongBuyAllowed: boolean;
  shadowLeadershipAllowed: boolean;
  promotionCoveragePass: boolean;
  leadershipConfidence: LegacyLeadershipConfidence;
  selectedSourceTier: SectorEnergySelectedSourceTier;
  dataQuality: SectorEnergyDataQuality;
  confidence: SectorEnergyDataQuality;
  // legacy 진단 보존 (final 판단에 사용 금지)
  legacyPromotionAllowedDiagnosticOnly?: unknown;
  legacySectorBoostAllowedDiagnosticOnly?: unknown;
  legacyStrongBuyAllowedDiagnosticOnly?: unknown;
  legacyLeadershipConfidenceDiagnosticOnly?: unknown;
  legacySelectedSourceTierDiagnosticOnly?: unknown;
  legacyDataQualityDiagnosticOnly?: unknown;
}

/**
 * ADR-0534: SectorEnergy 출력 객체의 결정 필드를 canonical 값으로 강제 덮어쓴다.
 * promotion/sectorBoost/strongBuy/shadow/leadershipConfidence/sourceTier/dataQuality 를 canonical 으로 통일하고,
 * 기존 값은 legacy*DiagnosticOnly 로 보존한다. coverage 수치(단위 상이)는 건드리지 않는다.
 * renderer 는 이 함수 결과를 pass-through 한다 — legacy 계산값이 promotion 을 되살릴 수 없다.
 */
export function applySectorEnergyCanonicalOverride<T extends object>(
  target: T,
  canonical: SectorEnergyCanonicalState,
): T & SectorEnergyCanonicalOverlay {
  const t = target as Record<string, unknown>;
  return {
    ...target,
    legacyPromotionAllowedDiagnosticOnly: t.promotionAllowed,
    legacySectorBoostAllowedDiagnosticOnly: t.sectorBoostAllowed,
    legacyStrongBuyAllowedDiagnosticOnly: t.strongBuyAllowed,
    legacyLeadershipConfidenceDiagnosticOnly: t.leadershipConfidence,
    legacySelectedSourceTierDiagnosticOnly: t.selectedSectorEnergySourceTier ?? t.selectedSourceTier,
    legacyDataQualityDiagnosticOnly: t.dataQuality,
    promotionAllowed: canonical.promotionAllowed,
    sectorBoostAllowed: canonical.sectorBoostAllowed,
    strongBuyAllowed: canonical.strongBuyAllowed,
    shadowLeadershipAllowed: canonical.shadowLeadershipAllowed,
    promotionCoveragePass: canonical.promotionCoveragePass,
    leadershipConfidence: leadershipConfidenceFromCanonical(canonical),
    selectedSourceTier: canonical.selectedSourceTier,
    ...('selectedSectorEnergySourceTier' in t ? { selectedSectorEnergySourceTier: canonical.selectedSourceTier } : {}),
    dataQuality: canonical.dataQuality,
    confidence: canonical.confidence,
  };
}

// ─── 출력 렌더 (3개 final 블록) ─────────────────────────────────────────────────

function pct1(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Block 1 — SectorEnergy Canonical. */
export function renderSectorEnergyCanonicalBlock(canonical: SectorEnergyCanonicalState): string {
  const mappingLine = (key: OfficialSectorEnergyKey): string => {
    const verified = canonical.verifiedOfficialSectorKeys.includes(key);
    return `  ${key}=${verified ? 'VERIFIED' : 'MISSING'} selectedIndexCode=${verified ? 'N/A(canonical-state)' : 'NONE'}`;
  };
  const missingReasonLine = (key: OfficialSectorEnergyKey): string => (
    `  ${key}=${canonical.missingOfficialSectorKeys.includes(key) ? 'missing verified candidate in official verify loop' : 'verified'}`
  );
  return [
    'SectorEnergy Canonical:',
    `  sourceOfTruth=${canonical.sourceOfTruth}`,
    `  universeType=${canonical.universeType}`,
    `  officialSectorCount=${canonical.officialSectorCount}`,
    `  verifiedOfficialSectorCount=${canonical.verifiedOfficialSectorCount}`,
    `  verifiedOfficialSectorKeys=${canonical.verifiedOfficialSectorKeys.join(',')}`,
    `  missingOfficialSectorKeys=${canonical.missingOfficialSectorKeys.join(',')}`,
    `  duplicateAliasRowsIgnored=${canonical.duplicateAliasRowsIgnored.join(',')}`,
    `  promotionCoverage=${pct1(canonical.promotionCoverage)}`,
    `  requiredPromotionCoverage=${pct1(canonical.requiredPromotionCoverage)}`,
    `  promotionCoveragePass=${canonical.promotionCoveragePass}`,
    `  promotionAllowed=${canonical.promotionAllowed}`,
    `  sectorBoostAllowed=${canonical.sectorBoostAllowed}`,
    `  strongBuyAllowed=${canonical.strongBuyAllowed}`,
    `  shadowLeadershipAllowed=${canonical.shadowLeadershipAllowed}`,
    `  counterfactualAllowed=${canonical.counterfactualAllowed}`,
    `  selectedSourceTier=${canonical.selectedSourceTier}`,
    `  dataQuality=${canonical.dataQuality}`,
    `  confidence=${canonical.confidence}`,
    `  executionImpact=${canonical.executionImpact}`,
    `  reason=${canonical.reason}`,
    '  verifiedMapping:',
    mappingLine('MACHINERY_EQUIPMENT'),
    mappingLine('FOOD_BEVERAGE_TOBACCO'),
    mappingLine('SERVICE_TELECOM'),
    '  missingOfficialSectorReasons:',
    missingReasonLine('MACHINERY_EQUIPMENT'),
    missingReasonLine('FOOD_BEVERAGE_TOBACCO'),
    missingReasonLine('SERVICE_TELECOM'),
  ].join('\n');
}

/** Block 2 — Theme Tags. */
export function renderSectorEnergyThemeTagsBlock(): string {
  const lines = ['Theme Tags:'];
  for (const tag of EXCLUDED_THEME_TAGS) {
    lines.push(
      `  ${tag}=THEME_TAG_ONLY livePromotion=false sectorBoost=false strongBuy=false shadowEvidenceOnly=true`,
    );
  }
  return lines.join('\n');
}

export interface SectorEnergyDiagnosticSources {
  oldOfficialTargetCoverage?: number;
  internalGroupedSnapshotCoverage?: number;
  groupedValidSectorCount?: number;
  groupedExpectedSectorCount?: number;
  kisBasketDerivedStatus?: 'DIAGNOSTIC_ONLY';
  kisBasketOfficialEquivalent?: false;
  kisBasketUseForPromotion?: false;
}

/** Block 3 — Diagnostic Sources (모두 diagnosticOnly, promotion 판단에 영향 없음). */
export function renderSectorEnergyDiagnosticSourcesBlock(diag: SectorEnergyDiagnosticSources): string {
  const lines = ['Diagnostic Sources:'];
  if (typeof diag.oldOfficialTargetCoverage === 'number') {
    lines.push(`  oldOfficialTargetCoverage=${pct1(diag.oldOfficialTargetCoverage)} diagnosticOnly=true`);
  }
  if (typeof diag.internalGroupedSnapshotCoverage === 'number') {
    lines.push(
      `  internalGroupedSnapshotCoverage=${pct1(diag.internalGroupedSnapshotCoverage)} diagnosticOnly=true`,
    );
  }
  if (typeof diag.groupedValidSectorCount === 'number' || typeof diag.groupedExpectedSectorCount === 'number') {
    lines.push(
      `  groupedValidSectorCount=${diag.groupedValidSectorCount ?? 0}/${diag.groupedExpectedSectorCount ?? 0} diagnosticOnly=true`,
    );
  }
  lines.push('  kisBasketDerivedStatus=DIAGNOSTIC_ONLY');
  lines.push(`  kisBasketOfficialEquivalent=${diag.kisBasketOfficialEquivalent ?? false}`);
  lines.push(`  kisBasketUseForPromotion=${diag.kisBasketUseForPromotion ?? false}`);
  lines.push('  note=diagnostic values do not drive promotion decision');
  return lines.join('\n');
}

/** 3개 final 블록 전체 렌더. */
export function renderSectorEnergyCanonicalOutput(
  canonical: SectorEnergyCanonicalState,
  diag: SectorEnergyDiagnosticSources = {},
): string {
  return [
    renderSectorEnergyCanonicalBlock(canonical),
    '',
    renderSectorEnergyThemeTagsBlock(),
    '',
    renderSectorEnergyDiagnosticSourcesBlock(diag),
  ].join('\n');
}
