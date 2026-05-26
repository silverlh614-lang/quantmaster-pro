// @responsibility Official KIS/KRX sector index master name/code mapping for SectorEnergy diagnostics.

export type OfficialSectorEnergySourceTier =
  | 'OFFICIAL_KRX_SECTOR_INDEX'
  | 'OFFICIAL_KIS_SECTOR_INDEX'
  | 'INTERNAL_GROUPED_SNAPSHOT'
  | 'KIS_STOCK_BASKET_DERIVED'
  | 'NONE';

export type SectorIndexSourceTier = OfficialSectorEnergySourceTier;

export interface OfficialSectorIndexMasterRow {
  market: 'KOSPI' | 'KOSDAQ' | 'KOSPI200' | 'UNKNOWN';
  idxDiv?: string;
  idxCode?: string;
  officialIndexCode: string;
  officialIndexName: string;
  normalizedSectorName: string;
  canonicalOfficialName?: string;
  codePrefixRemoved?: boolean;
  rawIdxName?: string;
  normalizedIdxName?: string;
  rawSectorName: string;
  sourceTier: SectorIndexSourceTier;
  marketClass?: string;
  aliasResolved: boolean;
  aliasSource?: string;
  unsafeAlias: boolean;
  verified?: boolean;
  verifyReason?: string;
  selectedOfficialIndexCode?: string;
  verifyInputCandidates?: string[];
}

export type SectorIndexMasterRow = OfficialSectorIndexMasterRow;

export interface OfficialSectorIndexTarget {
  sectorName: string;
  sectorKey?: string;
  candidateIndexCode?: string | null;
  aliasCandidates?: readonly string[] | null;
}

export interface OfficialSectorIndexCodeMappingRow {
  sectorName: string;
  sectorKey?: string;
  normalizedInternalName: string;
  aliasLookupKey: string | null;
  candidateOfficialNames: string[];
  exactMatch: boolean;
  safeAliasMatch: string | null;
  safeAliasTarget: string | null;
  unsafeAliasMatch: string | null;
  unsafeAliasTargets: string[];
  rawOfficialCandidates: string[];
  normalizedOfficialCandidates: string[];
  canonicalOfficialCandidates: string[];
  officialIndexCode: string | null;
  officialIndexName: string | null;
  idxDiv: string | null;
  idxCode: string | null;
  rawIdxName: string | null;
  canonicalOfficialName: string | null;
  verifyInputCandidates: string[];
  selectedOfficialRawName: string | null;
  selectedOfficialCanonicalName: string | null;
  codePrefixRemoved: boolean;
  selectedOfficialIndexCode: string | null;
  selectedOfficialIndexName: string | null;
  market: OfficialSectorIndexMasterRow['market'];
  sourceTier: OfficialSectorEnergySourceTier;
  aliasResolved: boolean;
  aliasSource?: string;
  safeAlias: boolean;
  unsafeAlias: boolean;
  officialCoverageEligible: boolean;
  includedInOfficialCoverage: boolean;
  shadowEvidenceOnly: boolean;
  reasonCode: string;
}

export interface OfficialSectorIndexMappingAttempt {
  internalSectorName: string;
  normalizedInternalName: string;
  aliasLookupKey: string | null;
  candidateOfficialNames: string[];
  exactMatch: boolean;
  safeAliasMatch: string | null;
  safeAliasTarget: string | null;
  unsafeAliasMatch: string | null;
  unsafeAliasTargets: string[];
  rawOfficialCandidates: string[];
  normalizedOfficialCandidates: string[];
  canonicalOfficialCandidates: string[];
  selectedOfficialIndexName: string | null;
  selectedOfficialIndexCode: string | null;
  idxDiv: string | null;
  idxCode: string | null;
  rawIdxName: string | null;
  canonicalOfficialName: string | null;
  verifyInputCandidates: string[];
  selectedOfficialRawName: string | null;
  selectedOfficialCanonicalName: string | null;
  codePrefixRemoved: boolean;
  includedInOfficialCoverage: boolean;
  shadowEvidenceOnly: boolean;
  verifyAttempted?: boolean;
  verified?: boolean;
  reasonCode: string;
}

export interface OfficialSectorIndexUnresolvedSectorReason {
  sector: string;
  normalizedInternalName: string;
  reason: string;
  aliasTarget?: string;
  candidateOfficialNames: string[];
}

export interface OfficialSectorIndexAliasDictionaryStatus {
  loaded: boolean;
  aliasCount: number;
  safeAliasCount: number;
  unsafeAliasCount: number;
  sampleAliases: string[];
}

export interface OfficialSectorIndexCodeMapResult {
  targetSectorCount: number;
  mappedSectorCount: number;
  officialIndexCoverage: number;
  exactMatchCount: number;
  safeAliasMatchCount: number;
  safeSynonymMatchCount: number;
  aliasResolvedCount: number;
  safeAliasCount: number;
  unsafeAliasCount: number;
  unsafeAliasSectorNames: string[];
  mappedSectorPairs: string[];
  unresolvedSectorNames: string[];
  unresolvedSectorDetails: OfficialSectorIndexUnresolvedSectorReason[];
  topMissingSectorNames: string[];
  internalSectorNames: string[];
  normalizedInternalSectorNames: string[];
  mappingAttempts: OfficialSectorIndexMappingAttempt[];
  rows: OfficialSectorIndexCodeMappingRow[];
  reasonCodes: string[];
}

const KR_ELECTRIC_ELECTRONICS = '\uC804\uAE30\uC804\uC790';
const KR_FINANCE = '\uAE08\uC735\uC5C5';
const KR_FINANCE_SHORT = '\uAE08\uC735';
const KR_BANK = '\uC740\uD589';
const KR_INSURANCE = '\uBCF4\uD5D8';
const KR_SECURITIES = '\uC99D\uAD8C';
const KR_CHEMICAL = '\uD654\uD559';
const KR_PHARMA = '\uC81C\uC57D';
const KR_MEDICINE = '\uC758\uC57D\uD488';
const KR_TRANSPORT_EQUIPMENT = '\uC6B4\uC218\uC7A5\uBE44';
const KR_TRANSPORT_EQUIPMENT_ALT = '\uC6B4\uC1A1\uC7A5\uBE44';
const KR_AUTOMOTIVE = '\uC790\uB3D9\uCC28';
const KR_MACHINERY = '\uAE30\uACC4';
const KR_MACHINERY_EQUIPMENT = '\uAE30\uACC4\uC7A5\uBE44';
const KR_STEEL = '\uCCA0\uAC15\uAE08\uC18D';
const KR_STEEL_SHORT = '\uCCA0\uAC15';
const KR_SERVICE = '\uC11C\uBE44\uC2A4\uC5C5';
const KR_SERVICE_SHORT = '\uC11C\uBE44\uC2A4';
const KR_HEALTHCARE = '\uD5EC\uC2A4\uCF00\uC5B4';
const KR_CONSTRUCTION = '\uAC74\uC124\uC5C5';
const KR_CONSTRUCTION_SHORT = '\uAC74\uC124';
const KR_TRANSPORT_WAREHOUSE = '\uC6B4\uC218\uCC3D\uACE0';
const KR_DISTRIBUTION = '\uC720\uD1B5\uC5C5';
const KR_DISTRIBUTION_SHORT = '\uC720\uD1B5';
const KR_CONSUMER_RETAIL = '\uC720\uD1B5 \uC18C\uBE44\uC7AC';
const KR_FOOD = '\uC74C\uC2DD\uB8CC\uD488';
const KR_FOOD_TOBACCO = '\uC74C\uC2DD\uB8CC \uB2F4\uBC30';
const KR_TEXTILE = '\uC12C\uC720\uC758\uBCF5';
const KR_TEXTILE_CLOTHING = '\uC12C\uC720 \uC758\uB958';
const KR_OTHER_FINANCE = '\uAE30\uD0C0\uAE08\uC735';

const SAFE_ALIAS_BY_NORMALIZED_NAME = new Map<string, readonly string[]>([
  ['finance', ['finance', 'financial', 'financials']],
  ['bank', ['bank', 'banks']],
  ['insurance', ['insurance']],
  ['securities', ['securities', 'brokerage']],
  ['chemical', ['chemical', 'chemicals', 'chemistry']],
  ['pharma', ['pharma', 'pharmaceutical', 'healthcare']],
  ['electric electronics', ['electric electronics', 'electronics']],
  ['machinery', ['machinery', 'machine', 'machine equipment']],
  ['construction', ['construction']],
  ['steel', ['steel', 'metal']],
  [KR_ELECTRIC_ELECTRONICS, [KR_ELECTRIC_ELECTRONICS, 'electric electronics', 'electronics', 'semiconductor', 'chip']],
  [KR_FINANCE, ['\uAE08\uC735', KR_FINANCE, 'finance', 'financial', 'financials', 'financial']],
  [KR_FINANCE_SHORT, [KR_FINANCE_SHORT, KR_FINANCE, 'finance', 'financial', 'financials', 'financial']],
  [KR_INSURANCE, [KR_INSURANCE, 'insurance']],
  [KR_SECURITIES, [KR_SECURITIES, 'securities', 'brokerage']],
  [KR_BANK, [KR_BANK, 'bank', 'banks']],
  [KR_CHEMICAL, [KR_CHEMICAL, 'chemical', 'chemicals', 'chemistry']],
  [KR_PHARMA, [KR_PHARMA, 'pharma', 'pharmaceutical']],
  [KR_MEDICINE, [KR_MEDICINE, 'pharma', 'pharmaceutical', 'healthcare']],
  [KR_TRANSPORT_EQUIPMENT, [KR_TRANSPORT_EQUIPMENT, KR_TRANSPORT_EQUIPMENT_ALT, 'transport equipment', 'automotive', 'auto', 'car']],
  [KR_TRANSPORT_EQUIPMENT_ALT, [KR_TRANSPORT_EQUIPMENT, KR_TRANSPORT_EQUIPMENT_ALT, 'transport equipment', 'automotive', 'auto', 'car']],
  [KR_AUTOMOTIVE, [KR_AUTOMOTIVE, 'automotive', 'auto', 'car']],
  [KR_MACHINERY, [KR_MACHINERY, 'machinery', 'machine', 'machine equipment']],
  [KR_MACHINERY_EQUIPMENT, [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, 'machinery', 'machine', 'machine equipment']],
  [KR_STEEL, [KR_STEEL, '\uCCA0\uAC15', 'steel', 'metal']],
  [KR_STEEL_SHORT, [KR_STEEL, KR_STEEL_SHORT, 'steel', 'metal']],
  [KR_SERVICE, [KR_SERVICE, '\uC11C\uBE44\uC2A4', 'service', 'services', 'internet', 'software', 'game', 'media']],
  [KR_SERVICE_SHORT, [KR_SERVICE, KR_SERVICE_SHORT, 'service', 'services', 'internet', 'software', 'game', 'media']],
  [KR_HEALTHCARE, [KR_HEALTHCARE, 'healthcare', 'bio healthcare', '\uBC14\uC774\uC624 \uD5EC\uC2A4\uCF00\uC5B4', '\uBC14\uC774\uC624\uD5EC\uC2A4\uCF00\uC5B4']],
  [KR_CONSTRUCTION, [KR_CONSTRUCTION, '\uAC74\uC124', 'construction']],
  [KR_CONSTRUCTION_SHORT, [KR_CONSTRUCTION, KR_CONSTRUCTION_SHORT, 'construction']],
  [KR_TRANSPORT_WAREHOUSE, [KR_TRANSPORT_WAREHOUSE, 'transport', 'transport warehouse', 'logistics']],
  [KR_DISTRIBUTION, [KR_DISTRIBUTION, KR_DISTRIBUTION_SHORT, KR_CONSUMER_RETAIL, '\uC720\uD1B5\uC18C\uBE44\uC7AC', 'retail', 'distribution', 'consumer retail']],
  [KR_DISTRIBUTION_SHORT, [KR_DISTRIBUTION, KR_DISTRIBUTION_SHORT, KR_CONSUMER_RETAIL, '\uC720\uD1B5\uC18C\uBE44\uC7AC', 'retail', 'distribution', 'consumer retail']],
  [KR_CONSUMER_RETAIL, [KR_CONSUMER_RETAIL, '\uC720\uD1B5 \uC18C\uBE44\uC7AC', '\uC720\uD1B5\uC18C\uBE44\uC7AC', 'consumer retail']],
  [KR_FOOD, [KR_FOOD, KR_FOOD_TOBACCO, 'food', 'food beverage']],
  [KR_FOOD_TOBACCO, [KR_FOOD, KR_FOOD_TOBACCO, 'food', 'food beverage']],
  [KR_TEXTILE, [KR_TEXTILE, KR_TEXTILE_CLOTHING, 'textile']],
  [KR_TEXTILE_CLOTHING, [KR_TEXTILE, KR_TEXTILE_CLOTHING, 'textile']],
]);

const UNSAFE_THEME_KEYS = new Set([
  'DEFENSE',
  'NUCLEAR',
  'ROBOT',
  'SHIPBUILDING',
  'BATTERY',
  'SECONDARY_BATTERY',
  'BIO',
  'HOLDING',
  'AI',
]);

const UNSAFE_THEME_NORMALIZED_NAMES = new Set([
  'defense',
  'nuclear',
  'robot',
  'shipbuilding',
  'battery',
  'secondary battery',
  'secondarybattery',
  'bio',
  'holding',
  'ai',
  '\uC870\uC120',
  '\uBC29\uC0B0',
  '\uC6D0\uC790\uB825',
  '2\uCC28\uC804\uC9C0',
  '\uC774\uCC28\uC804\uC9C0',
  '\uBC14\uC774\uC624',
  '\uB85C\uBD07',
  '\uBC18\uB3C4\uCCB4',
  '\uC790\uB3D9\uCC28',
  '\uC9C0\uC8FC',
]);

const UNSAFE_ALIAS_BY_NORMALIZED_NAME = new Map<string, readonly string[]>([
  ['shipbuilding', [KR_TRANSPORT_EQUIPMENT, KR_TRANSPORT_EQUIPMENT_ALT, KR_MACHINERY, KR_MACHINERY_EQUIPMENT]],
  ['defense', [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, KR_TRANSPORT_EQUIPMENT, KR_TRANSPORT_EQUIPMENT_ALT, KR_ELECTRIC_ELECTRONICS]],
  ['nuclear', [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, KR_CONSTRUCTION, KR_ELECTRIC_ELECTRONICS]],
  ['secondary battery', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['secondarybattery', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['battery', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['robot', [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, KR_ELECTRIC_ELECTRONICS]],
  ['ai', [KR_SERVICE, KR_ELECTRIC_ELECTRONICS]],
  ['bio', [KR_MEDICINE, KR_PHARMA]],
  ['holding', [KR_OTHER_FINANCE, KR_FINANCE]],
  ['\uC870\uC120', [KR_TRANSPORT_EQUIPMENT, KR_TRANSPORT_EQUIPMENT_ALT, KR_MACHINERY, KR_MACHINERY_EQUIPMENT]],
  ['\uBC29\uC0B0', [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, KR_TRANSPORT_EQUIPMENT, KR_TRANSPORT_EQUIPMENT_ALT, KR_ELECTRIC_ELECTRONICS]],
  ['\uC6D0\uC790\uB825', [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, KR_CONSTRUCTION, KR_ELECTRIC_ELECTRONICS]],
  ['2\uCC28\uC804\uC9C0', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['\uC774\uCC28\uC804\uC9C0', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['\uBC14\uC774\uC624', [KR_MEDICINE, KR_PHARMA]],
  ['\uB85C\uBD07', [KR_MACHINERY, KR_MACHINERY_EQUIPMENT, KR_ELECTRIC_ELECTRONICS]],
  ['\uBC18\uB3C4\uCCB4', [KR_ELECTRIC_ELECTRONICS]],
  ['\uC790\uB3D9\uCC28', [KR_TRANSPORT_EQUIPMENT]],
  ['\uC9C0\uC8FC', [KR_OTHER_FINANCE, KR_FINANCE]],
]);

function stripNoise(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[\u00B7\u318D/]/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\b(KRX|KOSPI|KOSDAQ|KONEX|INDEX|INDICES|SECTOR|INDUSTRY|COMPOSITE)\b/gi, ' ')
    .replace(/(\uD55C\uAD6D\uAC70\uB798\uC18C|\uCF54\uC2A4\uD53C|\uCF54\uC2A4\uB2E5|\uCF54\uB125\uC2A4|\uC5C5\uC885|\uC139\uD130|\uC0B0\uC5C5|\uC9C0\uC218)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function canonicalizeOfficialIndexName(value: unknown): { canonicalName: string; codePrefixRemoved: boolean; codePrefix?: string } {
  const raw = String(value ?? '').trim();
  const codePrefix = raw.match(/^([0-9]+)/)?.[1];
  const codePrefixRemoved = Boolean(codePrefix);
  const withoutCodePrefix = raw.replace(/^[0-9]+\s*/g, '');
  return {
    canonicalName: normalizeOfficialSectorName(withoutCodePrefix),
    codePrefixRemoved,
    ...(codePrefix ? { codePrefix } : {}),
  };
}

export function buildOfficialSectorVerifyInputCandidates(input: {
  idxDiv?: string | null;
  idxCode?: string | null;
  officialIndexCode?: string | null;
}): string[] {
  const idxCode = String(input.idxCode ?? input.officialIndexCode ?? '').trim();
  if (!idxCode) return [];
  const idxDiv = String(input.idxDiv ?? '').trim();
  const candidates = [idxCode];
  if (idxDiv && idxDiv !== '-') {
    candidates.push(`${idxDiv}${idxCode}`);
    candidates.push(`${idxDiv}:${idxCode}`);
    candidates.push(`${idxDiv}-${idxCode}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

export function normalizeOfficialSectorName(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return stripNoise(raw)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedTargetCandidates(target: OfficialSectorIndexTarget): string[] {
  return [
    target.sectorName,
    target.sectorKey,
    ...(target.aliasCandidates ?? []),
  ].map(normalizeOfficialSectorName).filter(Boolean);
}

function officialSource(row: OfficialSectorIndexMasterRow | null | undefined): boolean {
  return row?.sourceTier === 'OFFICIAL_KIS_SECTOR_INDEX' || row?.sourceTier === 'OFFICIAL_KRX_SECTOR_INDEX';
}

function compactNameKey(value: string): string {
  return value.replace(/\s+/g, '');
}

function registerMasterName(
  lookup: Map<string, OfficialSectorIndexMasterRow>,
  key: string,
  row: OfficialSectorIndexMasterRow,
): void {
  if (!key) return;
  if (!lookup.has(key)) lookup.set(key, row);
  const compactKey = compactNameKey(key);
  if (compactKey && !lookup.has(compactKey)) lookup.set(compactKey, row);
}

function masterCanonicalName(row: OfficialSectorIndexMasterRow): string {
  return row.canonicalOfficialName ?? canonicalizeOfficialIndexName(row.officialIndexName).canonicalName;
}

function masterIdxDiv(row: OfficialSectorIndexMasterRow): string | null {
  return row.idxDiv ?? canonicalizeOfficialIndexName(row.officialIndexName).codePrefix ?? null;
}

function masterIdxCode(row: OfficialSectorIndexMasterRow): string {
  return row.idxCode ?? row.officialIndexCode;
}

function masterRawIdxName(row: OfficialSectorIndexMasterRow): string {
  return row.rawIdxName ?? row.rawSectorName ?? row.officialIndexName;
}

function masterCodePrefixRemoved(row: OfficialSectorIndexMasterRow): boolean {
  return row.codePrefixRemoved ?? canonicalizeOfficialIndexName(row.officialIndexName).codePrefixRemoved;
}

function masterVerifyInputCandidates(row: OfficialSectorIndexMasterRow): string[] {
  return row.verifyInputCandidates ?? buildOfficialSectorVerifyInputCandidates({
    idxDiv: masterIdxDiv(row),
    idxCode: masterIdxCode(row),
  });
}

// Lever 1: KOSPI/KOSDAQ 업종 코드(0xxx, 1xxx)를 KRX-시리즈(4xxx, 5xxx)보다 먼저 verify probe 가 시도하도록 정렬한다.
// (probe 는 첫 nonzero 를 채택하므로 KRX-시리즈 0값 코드를 뒤로 미뤄 KOSPI/KOSDAQ nonzero 를 우선 채집)
function verifyCandidateTier(candidate: string): number {
  const code = candidate.match(/(\d{4})$/)?.[1] ?? candidate;
  if (/^[01]\d{3}$/.test(code)) return 0;
  if (/^[45]\d{3}$/.test(code)) return 2;
  return 1;
}

// 매칭된 row 가 속한 SAFE alias 패밀리에 함께 매칭되는 다른 official 마스터 row 들을 찾는다.
// row 자체 판정(officialIndexCode/coverage)은 바꾸지 않고, verify 시도 후보 코드만 넓힌다.
function collectSafeAliasFamilyRows(
  matched: OfficialSectorIndexMasterRow,
  masterRowsByNameKey: Map<string, OfficialSectorIndexMasterRow[]>,
): OfficialSectorIndexMasterRow[] {
  const matchedNameKeys = new Set<string>(
    [
      matched.normalizedSectorName,
      masterCanonicalName(matched),
      normalizeOfficialSectorName(matched.officialIndexName),
      normalizeOfficialSectorName(matched.rawSectorName),
    ]
      .filter(Boolean)
      .flatMap((key) => [key, compactNameKey(key)]),
  );

  const familyRows = new Map<string, OfficialSectorIndexMasterRow>();
  for (const [, aliases] of SAFE_ALIAS_BY_NORMALIZED_NAME) {
    const normalizedAliasKeys = aliases.map(normalizeOfficialSectorName).filter(Boolean);
    const familyContainsMatched = normalizedAliasKeys.some((aliasKey) =>
      matchedNameKeys.has(aliasKey) || matchedNameKeys.has(compactNameKey(aliasKey)),
    );
    if (!familyContainsMatched) continue;
    for (const aliasKey of normalizedAliasKeys) {
      for (const candidateKey of [aliasKey, compactNameKey(aliasKey)]) {
        for (const row of masterRowsByNameKey.get(candidateKey) ?? []) {
          if (!officialSource(row)) continue;
          familyRows.set(`${row.officialIndexCode}:${row.officialIndexName}`, row);
        }
      }
    }
  }
  return Array.from(familyRows.values());
}

// 매칭된 row 의 verifyInputCandidates 를 동일 alias 패밀리의 다른 official row 코드 변형까지 확장한다.
// KOSPI/KOSDAQ(0xxx/1xxx) 우선, KRX-시리즈(4xxx/5xxx) 후순위로 정렬하고 중복 제거한다.
function expandedVerifyInputCandidates(
  matched: OfficialSectorIndexMasterRow,
  masterRowsByNameKey: Map<string, OfficialSectorIndexMasterRow[]>,
): string[] {
  const matchedCandidates = masterVerifyInputCandidates(matched);
  const familyRows = collectSafeAliasFamilyRows(matched, masterRowsByNameKey);
  const siblingCandidates = familyRows
    .filter((row) => row.officialIndexCode !== matched.officialIndexCode)
    .flatMap((row) => masterVerifyInputCandidates(row));
  const ordered = [...matchedCandidates, ...siblingCandidates].filter(Boolean);
  const deduped = Array.from(new Set(ordered));
  // 안정 정렬: 동일 tier 내에서는 채집 순서(matched 우선)를 유지한다.
  return deduped
    .map((candidate, index) => ({ candidate, index, tier: verifyCandidateTier(candidate) }))
    .sort((a, b) => (a.tier - b.tier) || (a.index - b.index))
    .map((entry) => entry.candidate);
}

function officialCandidateNames(row: OfficialSectorIndexMasterRow | null | undefined): {
  raw: string[];
  normalized: string[];
  canonical: string[];
} {
  if (!row) return { raw: [], normalized: [], canonical: [] };
  return {
    raw: Array.from(new Set([row.officialIndexName, row.rawSectorName].filter(Boolean))),
    normalized: Array.from(new Set([row.normalizedSectorName, normalizeOfficialSectorName(row.officialIndexName)].filter(Boolean))),
    canonical: Array.from(new Set([masterCanonicalName(row)].filter(Boolean))),
  };
}

function findMasterByName(
  lookup: Map<string, OfficialSectorIndexMasterRow>,
  normalizedName: string,
): OfficialSectorIndexMasterRow | null {
  if (!normalizedName) return null;
  return lookup.get(normalizedName) ?? lookup.get(compactNameKey(normalizedName)) ?? null;
}

function findBySafeAlias(
  target: OfficialSectorIndexTarget,
  masterByName: Map<string, OfficialSectorIndexMasterRow>,
): {
  row: OfficialSectorIndexMasterRow | null;
  aliasSource: string;
  safeAliasTarget: string;
  candidateOfficialNames: string[];
} | null {
  const candidates = normalizedTargetCandidates(target);
  const candidateOfficialNames: string[] = [];

  for (const candidate of candidates) {
    for (const [canonicalName, aliases] of SAFE_ALIAS_BY_NORMALIZED_NAME) {
      if (!aliases.includes(candidate)) continue;
      const row = findMasterByName(masterByName, normalizeOfficialSectorName(canonicalName));
      if (row) {
        candidateOfficialNames.push(row.officialIndexName);
        return { row, aliasSource: candidate, safeAliasTarget: canonicalName, candidateOfficialNames };
      }
      candidateOfficialNames.push(canonicalName);
    }
  }
  return candidateOfficialNames.length > 0
    ? { row: null, aliasSource: candidates[0] ?? '', safeAliasTarget: candidateOfficialNames[0] ?? '', candidateOfficialNames }
    : null;
}

function findByUnsafeAlias(
  target: OfficialSectorIndexTarget,
  masterByName: Map<string, OfficialSectorIndexMasterRow>,
): { row: OfficialSectorIndexMasterRow | null; aliasSource: string; candidateOfficialNames: string[] } | null {
  const candidates = normalizedTargetCandidates(target);
  for (const candidate of candidates) {
    const officialNames = UNSAFE_ALIAS_BY_NORMALIZED_NAME.get(candidate);
    if (!officialNames) continue;
    const candidateOfficialNames = Array.from(officialNames);
    for (const officialName of officialNames) {
      const row = findMasterByName(masterByName, normalizeOfficialSectorName(officialName));
      if (row) return { row, aliasSource: candidate, candidateOfficialNames };
    }
    return { row: null, aliasSource: candidate, candidateOfficialNames };
  }
  return null;
}

function isUnsafeThemeTarget(target: OfficialSectorIndexTarget): boolean {
  const key = String(target.sectorKey ?? '').trim().toUpperCase();
  if (UNSAFE_THEME_KEYS.has(key)) return true;
  return normalizedTargetCandidates(target).some((candidate) => UNSAFE_THEME_NORMALIZED_NAMES.has(candidate));
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function attemptFromRow(row: OfficialSectorIndexCodeMappingRow): OfficialSectorIndexMappingAttempt {
  return {
    internalSectorName: row.sectorName,
    normalizedInternalName: row.normalizedInternalName,
    aliasLookupKey: row.aliasLookupKey,
    candidateOfficialNames: row.candidateOfficialNames,
    exactMatch: row.exactMatch,
    safeAliasMatch: row.safeAliasMatch,
    safeAliasTarget: row.safeAliasTarget,
    unsafeAliasMatch: row.unsafeAliasMatch,
    unsafeAliasTargets: row.unsafeAliasTargets,
    rawOfficialCandidates: row.rawOfficialCandidates,
    normalizedOfficialCandidates: row.normalizedOfficialCandidates,
    canonicalOfficialCandidates: row.canonicalOfficialCandidates,
    selectedOfficialIndexName: row.selectedOfficialIndexName,
    selectedOfficialIndexCode: row.selectedOfficialIndexCode,
    idxDiv: row.idxDiv,
    idxCode: row.idxCode,
    rawIdxName: row.rawIdxName,
    canonicalOfficialName: row.canonicalOfficialName,
    verifyInputCandidates: row.verifyInputCandidates,
    selectedOfficialRawName: row.selectedOfficialRawName,
    selectedOfficialCanonicalName: row.selectedOfficialCanonicalName,
    codePrefixRemoved: row.codePrefixRemoved,
    includedInOfficialCoverage: row.includedInOfficialCoverage,
    shadowEvidenceOnly: row.shadowEvidenceOnly,
    reasonCode: row.reasonCode,
  };
}

function isLikelyEnglishSector(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function sumAliasCount(source: Map<string, readonly string[]>): number {
  return Array.from(source.values()).reduce((sum, aliases) => sum + aliases.length, 0);
}

export function getOfficialSectorIndexAliasDictionaryStatus(): OfficialSectorIndexAliasDictionaryStatus {
  const sampleAliases = [
    `AUTOMOTIVE -> ${KR_TRANSPORT_EQUIPMENT}`,
    `SEMICONDUCTOR -> ${KR_ELECTRIC_ELECTRONICS}`,
    `STEEL -> ${KR_STEEL}`,
    `SOFTWARE -> ${KR_SERVICE}`,
    `DEFENSE -> ${KR_MACHINERY}/${KR_TRANSPORT_EQUIPMENT}/${KR_ELECTRIC_ELECTRONICS} (unsafe)`,
  ];
  return {
    loaded: SAFE_ALIAS_BY_NORMALIZED_NAME.size > 0,
    aliasCount: sumAliasCount(SAFE_ALIAS_BY_NORMALIZED_NAME) + sumAliasCount(UNSAFE_ALIAS_BY_NORMALIZED_NAME),
    safeAliasCount: sumAliasCount(SAFE_ALIAS_BY_NORMALIZED_NAME),
    unsafeAliasCount: sumAliasCount(UNSAFE_ALIAS_BY_NORMALIZED_NAME),
    sampleAliases,
  };
}

function unresolvedReason(input: {
  sectorName: string;
  normalizedName: string;
  masterRowsCount: number;
  candidateOfficialNames: readonly string[];
}): string {
  if (input.masterRowsCount <= 0) return 'MASTER_ROWS_EMPTY';
  if (input.candidateOfficialNames.length > 0) return 'ALIAS_TARGET_NOT_IN_MASTER';
  if (isLikelyEnglishSector(input.sectorName) || isLikelyEnglishSector(input.normalizedName)) return 'EN_TO_KR_ALIAS_MISSING';
  return 'OFFICIAL_NAME_NOT_FOUND';
}

export function mapSectorNamesToOfficialIndexCodes(input: {
  targets: readonly OfficialSectorIndexTarget[];
  masterRows: readonly OfficialSectorIndexMasterRow[];
}): OfficialSectorIndexCodeMapResult {
  const masterByCode = new Map<string, OfficialSectorIndexMasterRow>();
  const masterByName = new Map<string, OfficialSectorIndexMasterRow>();
  // 동일 이름 키에 매핑되는 모든 official row 를 보존한다 (verify 후보 패밀리 확장용 — 매칭 판정엔 미사용).
  const masterRowsByNameKey = new Map<string, OfficialSectorIndexMasterRow[]>();
  const registerMasterRowByNameKey = (key: string, row: OfficialSectorIndexMasterRow): void => {
    if (!key) return;
    for (const candidateKey of [key, compactNameKey(key)]) {
      if (!candidateKey) continue;
      const bucket = masterRowsByNameKey.get(candidateKey);
      if (bucket) {
        if (!bucket.includes(row)) bucket.push(row);
      } else {
        masterRowsByNameKey.set(candidateKey, [row]);
      }
    }
  };
  for (const row of input.masterRows) {
    masterByCode.set(row.officialIndexCode, row);
    registerMasterName(masterByName, row.normalizedSectorName, row);
    registerMasterName(masterByName, masterCanonicalName(row), row);
    registerMasterName(masterByName, normalizeOfficialSectorName(row.officialIndexName), row);
    registerMasterName(masterByName, normalizeOfficialSectorName(row.rawSectorName), row);
    registerMasterRowByNameKey(row.normalizedSectorName, row);
    registerMasterRowByNameKey(masterCanonicalName(row), row);
    registerMasterRowByNameKey(normalizeOfficialSectorName(row.officialIndexName), row);
    registerMasterRowByNameKey(normalizeOfficialSectorName(row.rawSectorName), row);
  }

  const rows: OfficialSectorIndexCodeMappingRow[] = [];
  let safeAliasCount = 0;
  let unsafeAliasCount = 0;
  let exactMatchCount = 0;
  const unresolved: string[] = [];
  const unresolvedDetails: OfficialSectorIndexUnresolvedSectorReason[] = [];
  const unsafeAliasSectorNames: string[] = [];
  let safeSynonymMatchCount = 0;

  for (const target of input.targets) {
    const sectorName = String(target.sectorName ?? '').trim();
    const candidateCode = String(target.candidateIndexCode ?? '').trim();
    const normalizedName = normalizeOfficialSectorName(sectorName);
    const unsafeTheme = isUnsafeThemeTarget(target);
    let matched: OfficialSectorIndexMasterRow | null = null;
    let aliasSource: string | undefined;
    let safeAlias = false;
    let exactMatch = false;
    let aliasLookupKey: string | null = null;
    let safeAliasMatch: string | null = null;
    let safeAliasTarget: string | null = null;
    let unsafeAliasMatch: string | null = null;
    let unsafeAliasTargets: string[] = [];
    const candidateOfficialNames: string[] = [];

    if (/^\d{4}$/.test(candidateCode)) {
      matched = masterByCode.get(candidateCode) ?? null;
      exactMatch = Boolean(matched);
      if (matched) candidateOfficialNames.push(matched.officialIndexName);
    }
    if (!matched && normalizedName) {
      matched = findMasterByName(masterByName, normalizedName);
      exactMatch = Boolean(matched);
      if (matched) candidateOfficialNames.push(matched.officialIndexName);
    }
    if (!matched) {
      const aliasMatch = findBySafeAlias(target, masterByName);
      if (aliasMatch?.row && officialSource(aliasMatch.row)) {
        matched = aliasMatch.row;
        aliasSource = aliasMatch.aliasSource;
        aliasLookupKey = aliasMatch.aliasSource;
        safeAlias = true;
        safeAliasMatch = aliasMatch.row.officialIndexName;
      }
      if (aliasMatch) {
        aliasLookupKey ??= aliasMatch.aliasSource;
        safeAliasTarget = aliasMatch.safeAliasTarget;
      }
      if (aliasMatch?.candidateOfficialNames.length) candidateOfficialNames.push(...aliasMatch.candidateOfficialNames);
    }

    const unsafeAlias = unsafeTheme ? findByUnsafeAlias(target, masterByName) : null;
    if (unsafeAlias) {
      unsafeAliasMatch = unsafeAlias.row?.officialIndexName ?? unsafeAlias.candidateOfficialNames[0] ?? null;
      unsafeAliasTargets = Array.from(unsafeAlias.candidateOfficialNames);
      candidateOfficialNames.push(...unsafeAlias.candidateOfficialNames);
      if (!matched && unsafeAlias.row) {
        matched = unsafeAlias.row;
        aliasSource = unsafeAlias.aliasSource;
        aliasLookupKey = unsafeAlias.aliasSource;
      }
      aliasLookupKey ??= unsafeAlias.aliasSource;
    }

    const matchedOfficial = officialSource(matched);
    const uniqueCandidateOfficialNames = Array.from(new Set(candidateOfficialNames.filter(Boolean)));
    const matchedOfficialNames = officialCandidateNames(matched);

    const exactOfficialNameMatch = Boolean(exactMatch
      && matched
      && compactNameKey(masterCanonicalName(matched)) === compactNameKey(normalizedName));
    const officialCoverageSafe = !unsafeTheme || exactOfficialNameMatch;

    if (matched && matchedOfficial && officialCoverageSafe) {
      if (safeAlias) safeAliasCount += 1;
      if (safeAlias && safeAliasTarget) {
        const normalizedAliasTarget = normalizeOfficialSectorName(safeAliasTarget);
        const selectedCanonicalName = masterCanonicalName(matched);
        if (
          normalizedAliasTarget !== selectedCanonicalName
          && compactNameKey(normalizedAliasTarget) === compactNameKey(selectedCanonicalName)
        ) {
          safeSynonymMatchCount += 1;
        }
      }
      if (exactMatch && !safeAlias) exactMatchCount += 1;
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        normalizedInternalName: normalizedName,
        aliasLookupKey,
        candidateOfficialNames: uniqueCandidateOfficialNames,
        exactMatch,
        safeAliasMatch,
        safeAliasTarget,
        unsafeAliasMatch: null,
        unsafeAliasTargets: [],
        rawOfficialCandidates: matchedOfficialNames.raw,
        normalizedOfficialCandidates: matchedOfficialNames.normalized,
        canonicalOfficialCandidates: matchedOfficialNames.canonical,
        officialIndexCode: matched.officialIndexCode,
        officialIndexName: matched.officialIndexName,
        idxDiv: masterIdxDiv(matched),
        idxCode: masterIdxCode(matched),
        rawIdxName: masterRawIdxName(matched),
        canonicalOfficialName: masterCanonicalName(matched),
        verifyInputCandidates: expandedVerifyInputCandidates(matched, masterRowsByNameKey),
        selectedOfficialRawName: masterRawIdxName(matched),
        selectedOfficialCanonicalName: masterCanonicalName(matched),
        codePrefixRemoved: masterCodePrefixRemoved(matched),
        selectedOfficialIndexCode: matched.officialIndexCode,
        selectedOfficialIndexName: matched.officialIndexName,
        market: matched.market,
        sourceTier: matched.sourceTier,
        aliasResolved: Boolean(aliasSource),
        ...(aliasSource ? { aliasSource } : {}),
        safeAlias,
        unsafeAlias: false,
        officialCoverageEligible: true,
        includedInOfficialCoverage: true,
        shadowEvidenceOnly: false,
        reasonCode: safeAlias ? 'SAFE_ALIAS_MATCHED' : 'EXACT_MATCHED',
      });
      continue;
    }

    if (unsafeTheme) {
      unsafeAliasCount += 1;
      unsafeAliasSectorNames.push(sectorName);
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        normalizedInternalName: normalizedName,
        aliasLookupKey,
        candidateOfficialNames: uniqueCandidateOfficialNames,
        exactMatch,
        safeAliasMatch,
        safeAliasTarget,
        unsafeAliasMatch,
        unsafeAliasTargets,
        rawOfficialCandidates: matchedOfficialNames.raw,
        normalizedOfficialCandidates: matchedOfficialNames.normalized,
        canonicalOfficialCandidates: matchedOfficialNames.canonical,
        officialIndexCode: matched?.officialIndexCode ?? null,
        officialIndexName: matched?.officialIndexName ?? null,
        idxDiv: matched ? masterIdxDiv(matched) : null,
        idxCode: matched ? masterIdxCode(matched) : null,
        rawIdxName: matched ? masterRawIdxName(matched) : null,
        canonicalOfficialName: matched ? masterCanonicalName(matched) : null,
        verifyInputCandidates: matched ? masterVerifyInputCandidates(matched) : [],
        selectedOfficialRawName: matched ? masterRawIdxName(matched) : null,
        selectedOfficialCanonicalName: matched ? masterCanonicalName(matched) : null,
        codePrefixRemoved: matched ? masterCodePrefixRemoved(matched) : false,
        selectedOfficialIndexCode: matched?.officialIndexCode ?? null,
        selectedOfficialIndexName: matched?.officialIndexName ?? unsafeAliasMatch,
        market: matched?.market ?? 'UNKNOWN',
        sourceTier: matched?.sourceTier ?? 'NONE',
        aliasResolved: Boolean(matched || unsafeAliasMatch),
        ...(aliasSource ? { aliasSource } : {}),
        safeAlias: false,
        unsafeAlias: true,
        officialCoverageEligible: false,
        includedInOfficialCoverage: false,
        shadowEvidenceOnly: true,
        reasonCode: 'UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION',
      });
      continue;
    }

    if (matched && !matchedOfficial) {
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        normalizedInternalName: normalizedName,
        aliasLookupKey,
        candidateOfficialNames: uniqueCandidateOfficialNames,
        exactMatch,
        safeAliasMatch,
        safeAliasTarget,
        unsafeAliasMatch,
        unsafeAliasTargets,
        rawOfficialCandidates: matchedOfficialNames.raw,
        normalizedOfficialCandidates: matchedOfficialNames.normalized,
        canonicalOfficialCandidates: matchedOfficialNames.canonical,
        officialIndexCode: matched.officialIndexCode,
        officialIndexName: matched.officialIndexName,
        idxDiv: masterIdxDiv(matched),
        idxCode: masterIdxCode(matched),
        rawIdxName: masterRawIdxName(matched),
        canonicalOfficialName: masterCanonicalName(matched),
        verifyInputCandidates: masterVerifyInputCandidates(matched),
        selectedOfficialRawName: masterRawIdxName(matched),
        selectedOfficialCanonicalName: masterCanonicalName(matched),
        codePrefixRemoved: masterCodePrefixRemoved(matched),
        selectedOfficialIndexCode: matched.officialIndexCode,
        selectedOfficialIndexName: matched.officialIndexName,
        market: matched.market,
        sourceTier: matched.sourceTier,
        aliasResolved: Boolean(aliasSource),
        ...(aliasSource ? { aliasSource } : {}),
        safeAlias,
        unsafeAlias: false,
        officialCoverageEligible: false,
        includedInOfficialCoverage: false,
        shadowEvidenceOnly: true,
        reasonCode: 'NON_OFFICIAL_SOURCE_SHADOW_ONLY',
      });
      continue;
    }

    const failureReason = unresolvedReason({
      sectorName,
      normalizedName,
      masterRowsCount: input.masterRows.length,
      candidateOfficialNames: uniqueCandidateOfficialNames,
    });
    unresolved.push(sectorName);
    unresolvedDetails.push({
      sector: sectorName,
      normalizedInternalName: normalizedName,
      reason: failureReason,
      ...(safeAliasTarget ? { aliasTarget: safeAliasTarget } : {}),
      candidateOfficialNames: uniqueCandidateOfficialNames,
    });
    rows.push({
      sectorName,
      sectorKey: target.sectorKey,
      normalizedInternalName: normalizedName,
      aliasLookupKey,
      candidateOfficialNames: uniqueCandidateOfficialNames,
      exactMatch: false,
      safeAliasMatch: null,
      safeAliasTarget,
      unsafeAliasMatch: null,
      unsafeAliasTargets,
      rawOfficialCandidates: [],
      normalizedOfficialCandidates: [],
      canonicalOfficialCandidates: [],
      officialIndexCode: null,
      officialIndexName: null,
      idxDiv: null,
      idxCode: null,
      rawIdxName: null,
      canonicalOfficialName: null,
      verifyInputCandidates: [],
      selectedOfficialRawName: null,
      selectedOfficialCanonicalName: null,
      codePrefixRemoved: false,
      selectedOfficialIndexCode: null,
      selectedOfficialIndexName: null,
      market: 'UNKNOWN',
      sourceTier: 'NONE',
      aliasResolved: false,
      safeAlias: false,
      unsafeAlias: false,
      officialCoverageEligible: false,
      includedInOfficialCoverage: false,
      shadowEvidenceOnly: false,
      reasonCode: failureReason,
    });
  }

  const mappedSectorCount = rows.filter((row) => row.officialCoverageEligible && row.officialIndexCode).length;
  const mappedSectorPairs = rows
    .filter((row) => row.officialCoverageEligible && row.officialIndexCode && row.officialIndexName)
    .map((row) => `${row.sectorName} -> ${row.officialIndexName}(code=${row.officialIndexCode})`);
  const reasonCodes = new Set<string>();
  reasonCodes.add(mappedSectorCount > 0 ? 'OFFICIAL_INDEX_CODE_MAPPED' : 'OFFICIAL_INDEX_COVERAGE_ZERO');
  if (exactMatchCount > 0) reasonCodes.add('EXACT_MATCHED');
  if (safeAliasCount > 0) reasonCodes.add('SAFE_ALIAS_MATCHED');
  if (safeSynonymMatchCount > 0) reasonCodes.add('SAFE_SYNONYM_MATCHED_CANONICAL');
  if (unsafeAliasCount > 0) reasonCodes.add('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  if (unresolved.length > 0) {
    reasonCodes.add('OFFICIAL_INDEX_MASTER_UNRESOLVED_SECTORS');
    reasonCodes.add('INTERNAL_SECTOR_ALIAS_MISSING');
    for (const detail of unresolvedDetails) reasonCodes.add(detail.reason);
    if (input.masterRows.length > 0 && unresolved.some(isLikelyEnglishSector)) {
      reasonCodes.add('EN_TO_KR_ALIAS_MISSING');
    }
  }

  return {
    targetSectorCount: input.targets.length,
    mappedSectorCount,
    officialIndexCoverage: pct(mappedSectorCount, input.targets.length),
    exactMatchCount,
    safeAliasMatchCount: safeAliasCount,
    safeSynonymMatchCount,
    aliasResolvedCount: safeAliasCount + unsafeAliasCount,
    safeAliasCount,
    unsafeAliasCount,
    unsafeAliasSectorNames,
    mappedSectorPairs,
    unresolvedSectorNames: unresolved,
    unresolvedSectorDetails: unresolvedDetails,
    topMissingSectorNames: unresolved.slice(0, 12),
    internalSectorNames: input.targets.map((target) => String(target.sectorName ?? '').trim()).filter(Boolean),
    normalizedInternalSectorNames: input.targets.map((target) => normalizeOfficialSectorName(target.sectorName)).filter(Boolean),
    mappingAttempts: rows.map(attemptFromRow),
    rows,
    reasonCodes: Array.from(reasonCodes),
  };
}
