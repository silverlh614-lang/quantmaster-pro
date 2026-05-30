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

export type SectorEnergyDataQuality = 'VERIFIED' | 'PARTIAL' | 'MISSING' | 'SESSION_NOT_VERIFIABLE';

export type SectorEnergyCanonicalReason =
  | 'OFFICIAL_SECTOR_COVERAGE_PASS'
  | 'OFFICIAL_SECTOR_COVERAGE_BELOW_THRESHOLD'
  | 'OFFICIAL_SECTOR_SOURCE_MISSING'
  | 'SECTOR_ENERGY_CANONICAL_STATE_MISSING'
  | 'SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED'
  | 'SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT';

/**
 * ADR-0544: 표시 전용 세션 분류 enum. 게이팅(promotion/sectorBoost/strongBuy)에는 사용하지 않는다.
 * 휴일/비장중 verify-skip 과 장중 verify 실제 0건을 표시상 구별한다.
 */
export type SectorEnergyStatus =
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'OBSERVE_ONLY_SESSION_CLOSED';

export type SectorEnergyConfidenceLabel =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'MISSING'
  | 'LAST_KNOWN_OR_OBSERVE_ONLY';

export type SectorEnergySectorIndexVerifyMode =
  | 'LIVE_VERIFY'
  | 'VERIFY_SKIPPED_SESSION_CLOSED'
  | 'LAST_KNOWN_VALID';

/**
 * ADR-0545: 휴일/세션닫힘 시 직전 verified sector snapshot 표시 블록 (표시 + shadowEvidence 전용).
 * ★ 게이팅 무관 — last-known 이 있어도 live promotion/sectorBoost/strongBuy 는 활성화하지 않는다.
 *   lastKnownUsableForLivePromotion 은 세션닫힘이면 무조건 false 다.
 * 서버 어댑터(deriveSectorEnergyCanonicalState)가 sectorEnergyVerifiedSnapshotRepo 로부터 채운다.
 */
export interface SectorEnergyLastKnownSnapshotDisplay {
  lastKnownSectorSnapshotId: string;
  lastKnownSectorSnapshotAsOf: string;
  lastKnownVerifiedOfficialSectorCount: number;
  lastKnownPromotionCoverage: number;
  lastKnownSourceTier: string;
  /** 직전 verified snapshot tradeDate 와 현재 tradeDate 사이의 거래일 격차 (>=0). */
  lastKnownAgeTradingDays: number;
  /** ★ 세션닫힘이면 무조건 false (live promotion 금지 SSOT). */
  lastKnownUsableForLivePromotion: false;
  /** 표시·shadow 근거로는 사용 가능. */
  lastKnownUsableForShadowEvidence: true;
}

/** 공식 key 별 verify 결과 — render 가 실제 index code/name/값을 보이도록 carry 한다 (N/A canonical-state 금지). */
export interface SectorEnergyVerifiedMappingEntry {
  key: OfficialSectorEnergyKey;
  verified: boolean;
  selectedIndexCode: string;
  selectedIndexName?: string;
  currentIndex?: number;
  reason?: string;
}

export interface SectorEnergyCanonicalState {
  sourceOfTruth: 'SectorEnergyCanonicalResolver';
  universeType: 'OFFICIAL_SECTOR_ONLY';

  officialSectorCount: 11;
  verifiedOfficialSectorCount: number;
  verifiedOfficialSectorKeys: OfficialSectorEnergyKey[];
  missingOfficialSectorKeys: OfficialSectorEnergyKey[];
  duplicateAliasRowsIgnored: string[];
  /** 공식 key 별 selectedIndexCode/Name/currentIndex (실제 verify 코드). 빈 배열이면 미상. */
  verifiedOfficialSectorMappings: SectorEnergyVerifiedMappingEntry[];

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

  /**
   * ADR-0544: 표시 전용 세션 분류 필드 (게이팅 무관).
   * 휴일/비장중 verify-skip 과 장중 실제 verify 0건을 표시상 구별한다.
   */
  status: SectorEnergyStatus;
  confidenceLabel: SectorEnergyConfidenceLabel;
  sectorIndexVerifyMode: SectorEnergySectorIndexVerifyMode;

  /**
   * ADR-0545: 휴일/세션닫힘 시 직전 verified sector snapshot 표시 (표시 + shadowEvidence 전용).
   * ★ 게이팅 무관 — 존재하더라도 promotion/sectorBoost/strongBuy 는 절대 활성화하지 않는다.
   * 부재 시 undefined (reason=SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT).
   */
  lastKnown?: SectorEnergyLastKnownSnapshotDisplay;

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
  /**
   * ADR-0544: 세션 신호(표시 전용). 어댑터가 master.reasonCodes 로부터 채운다.
   * sessionClosed && verifySkipped && verified=0 일 때만 표시 재분류 (게이팅 불변).
   * 미설정(undefined)이면 기존 MISSING/SOURCE_MISSING 분류 그대로 (byte-equivalent rollback).
   */
  sessionVerifiability?: {
    /** HOLIDAY/CLOSED/PRE_MARKET/AFTER_HOURS 등 비장중. */
    sessionClosed: boolean;
    /** SECTOR_INDEX_MARKET_CLOSED 등 verify 의도적 스킵 신호 존재. */
    verifySkipped: boolean;
  };
  /**
   * ADR-0545: last-known snapshot 정책 활성화 여부 (어댑터의 ENV
   * SECTOR_ENERGY_LAST_KNOWN_SNAPSHOT_ENABLED 반영). false/undefined 면 ADR-0544 동작 그대로
   * (sectorIndexVerifyMode=VERIFY_SKIPPED_SESSION_CLOSED / reason=SECTOR_INDEX_VERIFY_SKIPPED_
   * SESSION_CLOSED) — byte-equivalent. true 이고 snapshot 부재 시에만 no-last-known reason.
   */
  lastKnownLookupEnabled?: boolean;
  /**
   * ADR-0545: 서버 어댑터가 sectorEnergyVerifiedSnapshotRepo 에서 읽은 직전 verified snapshot.
   * sessionNotVerifiable(휴일+스킵+verified=0) 일 때만 표시에 반영한다.
   * ★ 게이팅(promotion 3종)에는 사용하지 않는다 — 표시 + shadowEvidence 전용.
   */
  lastKnownSnapshot?: SectorEnergyLastKnownSnapshotDisplay;
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
  currentIndex?: number;
}
type VerifiedMapping = Record<OfficialSectorEnergyKey, {
  verified: boolean; selectedIndexCode?: string; selectedIndexName?: string; currentIndex?: number; verifyReason?: string;
  sourceTier?: 'OFFICIAL_KIS_SECTOR_INDEX' | 'OFFICIAL_KRX_SECTOR_INDEX';
}>;
const DUPLICATE_ALIAS_KEYS = ['AUTOMOTIVE', 'SEMICONDUCTOR', 'CONSUMER_RETAIL'] as const;

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

export interface OfficialSectorEnergyVerifyTarget {
  key: OfficialSectorEnergyKey;
  sectorName: string;
  indexCode: string;
}

/**
 * ADR-0534 follow-up: 공식 11개 섹터를 후보 풀과 무관하게 매 스캔 verify 하기 위한 기준 target.
 * indexCode 는 KIS idxcode.mst 업종코드(공식, U/FHPUP02100000 으로 조회). collectOfficialSectorIndexTargets
 * 가 이 11개를 항상 시드하여 numerator(verified) 가 denominator(11) 와 정합하도록 보장한다 —
 * 후보 섹터에 기계/음식료/통신 종목이 없어도 MACHINERY/FOOD/SERVICE_TELECOM 이 누락되지 않는다.
 */
export const OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS: readonly OfficialSectorEnergyVerifyTarget[] = [
  { key: 'SEMICONDUCTOR_ELECTRONICS', sectorName: '반도체', indexCode: '4003' },
  { key: 'AUTOMOTIVE_TRANSPORT_EQUIPMENT', sectorName: '자동차', indexCode: '4002' },
  { key: 'MACHINERY_EQUIPMENT', sectorName: '기계장비', indexCode: '0012' },
  { key: 'CHEMICALS', sectorName: '화학', indexCode: '0008' },
  { key: 'BIO_HEALTHCARE_PHARMA', sectorName: '바이오/헬스케어', indexCode: '4004' },
  { key: 'STEEL_METALS', sectorName: '철강', indexCode: '4008' },
  { key: 'CONSTRUCTION', sectorName: '건설', indexCode: '0018' },
  { key: 'FINANCIALS', sectorName: '금융', indexCode: '0021' },
  { key: 'CONSUMER_RETAIL', sectorName: '유통/소비재', indexCode: '0016' },
  { key: 'FOOD_BEVERAGE_TOBACCO', sectorName: '음식료', indexCode: '0005' },
  { key: 'SERVICE_TELECOM', sectorName: '방송통신', indexCode: '4010' },
];

/** duplicate alias 키 → 'ALIAS -> OFFICIAL_KEY' 표기 (canonical count 에는 불포함, 진단 표시 전용). */
const DUPLICATE_ALIAS_OFFICIAL_KEY: Record<string, OfficialSectorEnergyKey | string> = {
  AUTOMOTIVE: 'AUTOMOTIVE_TRANSPORT_EQUIPMENT',
  SEMICONDUCTOR: 'SEMICONDUCTOR_ELECTRONICS',
  CONSUMER_RETAIL: 'CONSUMER_RETAIL',
};

function formatDuplicateAlias(alias: string): string {
  if (alias.includes('->')) return alias;
  const official = DUPLICATE_ALIAS_OFFICIAL_KEY[alias.trim()];
  return official ? `${alias} -> ${official}` : alias;
}

// ─── Stale blocker / status hygiene (ADR-0534 follow-up, 판단 로직 무변경) ──────────

/** canonical PASS 시 출력에서 제거되어야 하는 SectorEnergy 관련 stale blocker 토큰. */
export const STALE_SECTOR_ENERGY_BLOCKERS: readonly string[] = [
  'OFFICIAL_INDEX_UNAVAILABLE',
  'OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD',
  'OFFICIAL_SECTOR_COVERAGE_BELOW_THRESHOLD',
  'SECTOR_OFFICIAL_PROMOTION_DISABLED',
  'SECTOR_ENERGY_DEGRADED',
  'SECTOR_LEADERSHIP_MISSING',
];

/**
 * canonical 을 기준으로 blocker 배열을 정합화한다 (판단값 변경 없음 — 출력만).
 *   promotionAllowed=true  → STALE_SECTOR_ENERGY_BLOCKERS 전부 제거.
 *   promotionAllowed=false → SECTOR_OFFICIAL_PROMOTION_DISABLED 보장(1회).
 * 그 외 실제 blocker(FUNDAMENTAL/BREAKOUT/RS/VOLUME 등)는 그대로 보존한다.
 */
export function stripStaleSectorEnergyBlockers(
  canonical: Pick<SectorEnergyCanonicalState, 'promotionAllowed'>,
  blockers: readonly string[],
): string[] {
  if (canonical.promotionAllowed === true) {
    return blockers.filter((b) => !STALE_SECTOR_ENERGY_BLOCKERS.includes(b));
  }
  const next = blockers.filter((b) => b !== 'SECTOR_OFFICIAL_PROMOTION_DISABLED');
  next.push('SECTOR_OFFICIAL_PROMOTION_DISABLED');
  return next;
}

/** canonical 기준 렌더 상태 — PASS=VERIFIED, partial=PARTIAL, missing=MISSING. legacy PARTIAL/unavailable 금지. */
export function sectorEnergyRenderedStatus(
  canonical: Pick<SectorEnergyCanonicalState, 'promotionCoveragePass' | 'dataQuality'>,
): SectorEnergyDataQuality {
  if (canonical.promotionCoveragePass === true) return 'VERIFIED';
  return canonical.dataQuality;
}

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
}): {
  officialSectorCount: 11;
  officialVerifyLoopSource: 'OFFICIAL_SECTOR_ENERGY_11';
  officialVerifyLoopKeyCount: 11;
  officialVerifyRequestedKeys: OfficialSectorEnergyKey[];
  verifiedOfficialSectorCount: number;
  verifiedOfficialSectorKeys: OfficialSectorEnergyKey[];
  missingOfficialSectorKeys: OfficialSectorEnergyKey[];
  verifiedMapping: VerifiedMapping;
  duplicateAliasRowsIgnored: string[];
} {
  const keys = [...OFFICIAL_SECTOR_ENERGY_11];
  if (keys.length !== OFFICIAL_SECTOR_COUNT) throw new Error('OFFICIAL_VERIFY_LOOP_KEY_COUNT_MISMATCH');
  const verifiedCodes = new Set(input.indexVerifyResults.filter((r) => (r.success ?? r.verified) && r.indexValueUsable !== false).map((r) => String(r.indexCode ?? '').trim()).filter(Boolean));
  const currentIndexByCode = new Map<string, number>();
  for (const r of input.indexVerifyResults) {
    const code = String(r.indexCode ?? '').trim();
    if (code && typeof r.currentIndex === 'number' && Number.isFinite(r.currentIndex) && !currentIndexByCode.has(code)) {
      currentIndexByCode.set(code, r.currentIndex);
    }
  }
  const duplicateAliasRowsIgnored: string[] = [...DUPLICATE_ALIAS_KEYS];
  const verifiedMapping = {} as VerifiedMapping;
  const verifiedOfficialSectorKeys: OfficialSectorEnergyKey[] = [];
  for (const key of keys) {
    const cfg = OFFICIAL_SECTOR_ALIAS_MAP[key];
    const matches = findIndexRowsByAliasesOrPreferredCodes(input.officialIndexMasterRows, cfg);
    let selected = matches.find((m) => verifiedCodes.has(String(m.indexCode ?? '').trim()) && cfg.preferredIndexCodes.includes(String(m.indexCode ?? '').trim()));
    if (!selected) selected = matches.find((m) => verifiedCodes.has(String(m.indexCode ?? '').trim()));
    const verified = Boolean(selected && verifiedCodes.has(String(selected.indexCode ?? '').trim()));
    const selectedCode = String(selected?.indexCode ?? '').trim();
    const currentIndex = verified ? currentIndexByCode.get(selectedCode) : undefined;
    verifiedMapping[key] = verified
      ? { verified, selectedIndexCode: selectedCode, selectedIndexName: selected?.indexName ?? selected?.sectorName, ...(typeof currentIndex === 'number' ? { currentIndex } : {}), verifyReason: 'VERIFY_SUCCESS', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' }
      : { verified: false, selectedIndexCode: 'NONE', verifyReason: matches.length === 0 ? 'INDEX_MASTER_ROW_NOT_FOUND' : 'VERIFY_FAILED' };
    if (verified) verifiedOfficialSectorKeys.push(key);
  }
  const missingOfficialSectorKeys = keys.filter((k) => !verifiedOfficialSectorKeys.includes(k));
  if (!keys.includes('MACHINERY_EQUIPMENT')) throw new Error('OFFICIAL_VERIFY_LOOP_MISSING_KEY_MACHINERY_EQUIPMENT');
  if (!keys.includes('FOOD_BEVERAGE_TOBACCO')) throw new Error('OFFICIAL_VERIFY_LOOP_MISSING_KEY_FOOD_BEVERAGE_TOBACCO');
  if (!keys.includes('SERVICE_TELECOM')) throw new Error('OFFICIAL_VERIFY_LOOP_MISSING_KEY_SERVICE_TELECOM');
  assertSectorEnergyCoverageInvariants(
    { missingOfficialSectorKeys },
    { officialIndexMasterRows: input.officialIndexMasterRows, indexVerifyResults: input.indexVerifyResults },
  );
  return {
    officialSectorCount: 11,
    officialVerifyLoopSource: 'OFFICIAL_SECTOR_ENERGY_11',
    officialVerifyLoopKeyCount: 11,
    officialVerifyRequestedKeys: keys,
    verifiedOfficialSectorCount: verifiedOfficialSectorKeys.length,
    verifiedOfficialSectorKeys,
    missingOfficialSectorKeys,
    verifiedMapping,
    duplicateAliasRowsIgnored,
  };
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
  let duplicateAliasRowsIgnored: string[] = [];
  let verifiedOfficialSectorMappings: SectorEnergyVerifiedMappingEntry[] = [];
  if (Array.isArray(input.officialIndexMasterRows) && Array.isArray(input.indexVerifyResults)) {
    const coverage = resolveOfficialSectorEnergyCoverage({
      officialIndexMasterRows: input.officialIndexMasterRows,
      indexVerifyResults: input.indexVerifyResults,
    });
    if (coverage.verifiedOfficialSectorCount !== verifiedOfficialSectorCount) throw new Error('CANONICAL_SECTOR_COUNT_MISMATCH');
    duplicateAliasRowsIgnored = coverage.duplicateAliasRowsIgnored.map((alias) => formatDuplicateAlias(alias));
    verifiedOfficialSectorMappings = [...OFFICIAL_SECTOR_ENERGY_11].map((key) => {
      const m = coverage.verifiedMapping[key];
      return {
        key,
        verified: Boolean(m?.verified),
        selectedIndexCode: m?.verified ? String(m.selectedIndexCode ?? '') : 'NONE',
        ...(m?.selectedIndexName ? { selectedIndexName: m.selectedIndexName } : {}),
        ...(typeof m?.currentIndex === 'number' ? { currentIndex: m.currentIndex } : {}),
        ...(m?.verifyReason ? { reason: m.verifyReason } : {}),
      };
    });
  } else {
    // fallback(per-sector 데이터 없음): 검증된 key 는 base target 의 KIS 업종코드로 보강.
    verifiedOfficialSectorMappings = [...OFFICIAL_SECTOR_ENERGY_11].map((key) => {
      const isVerified = verified.has(key);
      const base = OFFICIAL_SECTOR_ENERGY_BASE_VERIFY_TARGETS.find((t) => t.key === key);
      return {
        key,
        verified: isVerified,
        selectedIndexCode: isVerified && base ? base.indexCode : 'NONE',
        ...(isVerified && base ? { selectedIndexName: base.sectorName } : {}),
        reason: isVerified ? 'FALLBACK_BASE_TARGET' : 'NOT_VERIFIED',
      };
    });
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

  // ─── ADR-0544: 표시 전용 세션 분류 (게이팅 불변 — promotion 3종 미접촉) ───────────
  // 휴일/비장중에 KIS index verify 가 의도적으로 스킵되어 verified=0 인 경우,
  // 실제 소스 결함(MISSING/SOURCE_MISSING)과 표시상 구별한다.
  // status/confidenceLabel/sectorIndexVerifyMode 표시 필드 + dataQuality/reason 문자열만
  // 대입하며, promotionAllowed/sectorBoostAllowed/strongBuyAllowed/promotionCoveragePass 는
  // 위에서 이미 verified/11 ≥ 0.8 로 확정되어 휴일(verified=0)엔 전부 false 그대로다.
  let status: SectorEnergyStatus = promotionCoveragePass
    ? 'AVAILABLE'
    : verifiedOfficialSectorCount > 0
      ? 'AVAILABLE'
      : 'UNAVAILABLE';
  let confidenceLabel: SectorEnergyConfidenceLabel = dataQuality;
  let sectorIndexVerifyMode: SectorEnergySectorIndexVerifyMode = 'LIVE_VERIFY';
  let lastKnown: SectorEnergyLastKnownSnapshotDisplay | undefined;

  const sessionNotVerifiable =
    input.sessionVerifiability?.sessionClosed === true &&
    input.sessionVerifiability?.verifySkipped === true &&
    verifiedOfficialSectorCount === 0;
  if (sessionNotVerifiable) {
    dataQuality = 'SESSION_NOT_VERIFIABLE';
    reason = 'SECTOR_INDEX_VERIFY_SKIPPED_SESSION_CLOSED';
    status = 'OBSERVE_ONLY_SESSION_CLOSED';
    confidenceLabel = 'LAST_KNOWN_OR_OBSERVE_ONLY';
    sectorIndexVerifyMode = 'VERIFY_SKIPPED_SESSION_CLOSED';
    // ─── ADR-0545: last-known 정책이 활성화된 경우에만 표시 보강 (표시·shadow 전용) ───
    // ★ promotion 3종은 여기서 읽지도 쓰지도 않는다 — verified=0 이므로 위에서 이미 전부 false 확정.
    //   lastKnown.lastKnownUsableForLivePromotion 은 타입 레벨로 false 고정(세션닫힘이면 무조건 금지).
    // lastKnownLookupEnabled=false/undefined 면 ADR-0544 동작 그대로 (byte-equivalent).
    if (input.lastKnownLookupEnabled === true) {
      if (input.lastKnownSnapshot) {
        lastKnown = input.lastKnownSnapshot;
        sectorIndexVerifyMode = 'LAST_KNOWN_VALID';
      } else {
        reason = 'SESSION_CLOSED_NO_LAST_KNOWN_SECTOR_SNAPSHOT';
      }
    }
  }

  return {
    sourceOfTruth: 'SectorEnergyCanonicalResolver',
    universeType: 'OFFICIAL_SECTOR_ONLY',
    officialSectorCount,
    verifiedOfficialSectorCount,
    verifiedOfficialSectorKeys,
    missingOfficialSectorKeys,
    duplicateAliasRowsIgnored,
    verifiedOfficialSectorMappings,
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
    status,
    confidenceLabel,
    sectorIndexVerifyMode,
    ...(lastKnown ? { lastKnown } : {}),
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
    verifiedOfficialSectorMappings: [],
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
    status: 'UNAVAILABLE',
    confidenceLabel: 'MISSING',
    sectorIndexVerifyMode: 'LIVE_VERIFY',
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
  // 공식 source 없음(MISSING)/세션 닫힘(SESSION_NOT_VERIFIABLE)이라도 shadowLeadershipAllowed=true
  // 이므로 SHADOW_ONLY (BLOCKED 아님). 휴일 verify-skip 은 소스 결함이 아니다 (ADR-0544).
  if (canonical.dataQuality === 'MISSING' || canonical.dataQuality === 'SESSION_NOT_VERIFIABLE') return 'SHADOW_ONLY';
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
  const mappingByKey = new Map(canonical.verifiedOfficialSectorMappings.map((m) => [m.key, m]));
  const mappingLine = (key: OfficialSectorEnergyKey): string => {
    const verified = canonical.verifiedOfficialSectorKeys.includes(key);
    const m = mappingByKey.get(key);
    if (!verified) return `  ${key}=MISSING selectedIndexCode=NONE`;
    const code = m && m.selectedIndexCode && m.selectedIndexCode !== 'NONE' ? m.selectedIndexCode : 'UNKNOWN';
    const namePart = m?.selectedIndexName ? ` selectedIndexName=${m.selectedIndexName}` : '';
    const idxPart = typeof m?.currentIndex === 'number' ? ` currentIndex=${m.currentIndex}` : '';
    return `  ${key}=VERIFIED selectedIndexCode=${code}${namePart}${idxPart}`;
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
    `  status=${canonical.status}`,
    `  confidenceLabel=${canonical.confidenceLabel}`,
    `  sectorIndexVerifyMode=${canonical.sectorIndexVerifyMode}`,
    ...(canonical.lastKnown
      ? [
          `  lastKnownSectorSnapshotId=${canonical.lastKnown.lastKnownSectorSnapshotId}`,
          `  lastKnownSectorSnapshotAsOf=${canonical.lastKnown.lastKnownSectorSnapshotAsOf}`,
          `  lastKnownVerifiedOfficialSectorCount=${canonical.lastKnown.lastKnownVerifiedOfficialSectorCount}`,
          `  lastKnownPromotionCoverage=${pct1(canonical.lastKnown.lastKnownPromotionCoverage)}`,
          `  lastKnownSourceTier=${canonical.lastKnown.lastKnownSourceTier}`,
          `  lastKnownAgeTradingDays=${canonical.lastKnown.lastKnownAgeTradingDays}`,
          `  lastKnownUsableForLivePromotion=${canonical.lastKnown.lastKnownUsableForLivePromotion}`,
          `  lastKnownUsableForShadowEvidence=${canonical.lastKnown.lastKnownUsableForShadowEvidence}`,
        ]
      : []),
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
