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
  officialIndexCode: string;
  officialIndexName: string;
  normalizedSectorName: string;
  rawSectorName: string;
  sourceTier: SectorIndexSourceTier;
  aliasResolved: boolean;
  aliasSource?: string;
  unsafeAlias: boolean;
  verified?: boolean;
  verifyReason?: string;
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
  candidateOfficialNames: string[];
  exactMatch: boolean;
  safeAliasMatch: string | null;
  unsafeAliasMatch: string | null;
  officialIndexCode: string | null;
  officialIndexName: string | null;
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
  candidateOfficialNames: string[];
  exactMatch: boolean;
  safeAliasMatch: string | null;
  unsafeAliasMatch: string | null;
  selectedOfficialIndexName: string | null;
  selectedOfficialIndexCode: string | null;
  includedInOfficialCoverage: boolean;
  shadowEvidenceOnly: boolean;
  verifyAttempted?: boolean;
  verified?: boolean;
  reasonCode: string;
}

export interface OfficialSectorIndexCodeMapResult {
  targetSectorCount: number;
  mappedSectorCount: number;
  officialIndexCoverage: number;
  exactMatchCount: number;
  safeAliasMatchCount: number;
  aliasResolvedCount: number;
  safeAliasCount: number;
  unsafeAliasCount: number;
  unsafeAliasSectorNames: string[];
  mappedSectorPairs: string[];
  unresolvedSectorNames: string[];
  topMissingSectorNames: string[];
  internalSectorNames: string[];
  normalizedInternalSectorNames: string[];
  mappingAttempts: OfficialSectorIndexMappingAttempt[];
  rows: OfficialSectorIndexCodeMappingRow[];
  reasonCodes: string[];
}

const KR_ELECTRIC_ELECTRONICS = '\uC804\uAE30\uC804\uC790';
const KR_FINANCE = '\uAE08\uC735\uC5C5';
const KR_BANK = '\uC740\uD589';
const KR_INSURANCE = '\uBCF4\uD5D8';
const KR_SECURITIES = '\uC99D\uAD8C';
const KR_CHEMICAL = '\uD654\uD559';
const KR_PHARMA = '\uC81C\uC57D';
const KR_MEDICINE = '\uC758\uC57D\uD488';
const KR_TRANSPORT_EQUIPMENT = '\uC6B4\uC218\uC7A5\uBE44';
const KR_MACHINERY = '\uAE30\uACC4';
const KR_STEEL = '\uCCA0\uAC15\uAE08\uC18D';
const KR_SERVICE = '\uC11C\uBE44\uC2A4\uC5C5';
const KR_CONSTRUCTION = '\uAC74\uC124\uC5C5';
const KR_TRANSPORT_WAREHOUSE = '\uC6B4\uC218\uCC3D\uACE0';
const KR_DISTRIBUTION = '\uC720\uD1B5\uC5C5';
const KR_FOOD = '\uC74C\uC2DD\uB8CC\uD488';
const KR_TEXTILE = '\uC12C\uC720\uC758\uBCF5';
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
  [KR_INSURANCE, [KR_INSURANCE, 'insurance']],
  [KR_SECURITIES, [KR_SECURITIES, 'securities', 'brokerage']],
  [KR_BANK, [KR_BANK, 'bank', 'banks']],
  [KR_CHEMICAL, [KR_CHEMICAL, 'chemical', 'chemicals', 'chemistry']],
  [KR_PHARMA, [KR_PHARMA, 'pharma', 'pharmaceutical']],
  [KR_MEDICINE, [KR_MEDICINE, 'pharma', 'pharmaceutical', 'healthcare']],
  [KR_TRANSPORT_EQUIPMENT, [KR_TRANSPORT_EQUIPMENT, '\uC6B4\uC1A1\uC7A5\uBE44', 'transport equipment', 'automotive', 'auto', 'car']],
  [KR_MACHINERY, [KR_MACHINERY, 'machinery', 'machine', 'machine equipment']],
  [KR_STEEL, [KR_STEEL, '\uCCA0\uAC15', 'steel', 'metal']],
  [KR_SERVICE, [KR_SERVICE, '\uC11C\uBE44\uC2A4', 'service', 'services', 'internet', 'software', 'game', 'media']],
  [KR_CONSTRUCTION, [KR_CONSTRUCTION, '\uAC74\uC124', 'construction']],
  [KR_TRANSPORT_WAREHOUSE, [KR_TRANSPORT_WAREHOUSE, 'transport', 'transport warehouse', 'logistics']],
  [KR_DISTRIBUTION, [KR_DISTRIBUTION, 'retail', 'distribution']],
  [KR_FOOD, [KR_FOOD, 'food', 'food beverage']],
  [KR_TEXTILE, [KR_TEXTILE, 'textile']],
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
  ['shipbuilding', [KR_TRANSPORT_EQUIPMENT, KR_MACHINERY]],
  ['defense', [KR_MACHINERY, KR_TRANSPORT_EQUIPMENT, KR_ELECTRIC_ELECTRONICS]],
  ['nuclear', [KR_MACHINERY, KR_CONSTRUCTION, KR_ELECTRIC_ELECTRONICS]],
  ['secondary battery', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['secondarybattery', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['battery', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['robot', [KR_MACHINERY, KR_ELECTRIC_ELECTRONICS]],
  ['ai', [KR_SERVICE, KR_ELECTRIC_ELECTRONICS]],
  ['bio', [KR_MEDICINE, KR_PHARMA]],
  ['holding', [KR_OTHER_FINANCE, KR_FINANCE]],
  ['\uC870\uC120', [KR_TRANSPORT_EQUIPMENT, KR_MACHINERY]],
  ['\uBC29\uC0B0', [KR_MACHINERY, KR_TRANSPORT_EQUIPMENT, KR_ELECTRIC_ELECTRONICS]],
  ['\uC6D0\uC790\uB825', [KR_MACHINERY, KR_CONSTRUCTION, KR_ELECTRIC_ELECTRONICS]],
  ['2\uCC28\uC804\uC9C0', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['\uC774\uCC28\uC804\uC9C0', [KR_CHEMICAL, KR_ELECTRIC_ELECTRONICS]],
  ['\uBC14\uC774\uC624', [KR_MEDICINE, KR_PHARMA]],
  ['\uB85C\uBD07', [KR_MACHINERY, KR_ELECTRIC_ELECTRONICS]],
  ['\uBC18\uB3C4\uCCB4', [KR_ELECTRIC_ELECTRONICS]],
  ['\uC790\uB3D9\uCC28', [KR_TRANSPORT_EQUIPMENT]],
  ['\uC9C0\uC8FC', [KR_OTHER_FINANCE, KR_FINANCE]],
]);

function stripNoise(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\b(KRX|KOSPI|KOSDAQ|KONEX|INDEX|INDICES|SECTOR|INDUSTRY|COMPOSITE)\b/gi, ' ')
    .replace(/(\uD55C\uAD6D\uAC70\uB798\uC18C|\uCF54\uC2A4\uD53C|\uCF54\uC2A4\uB2E5|\uCF54\uB125\uC2A4|\uC5C5\uC885|\uC139\uD130|\uC0B0\uC5C5|\uC9C0\uC218)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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
): { row: OfficialSectorIndexMasterRow | null; aliasSource: string; candidateOfficialNames: string[] } | null {
  const candidates = normalizedTargetCandidates(target);
  const candidateOfficialNames: string[] = [];

  for (const candidate of candidates) {
    for (const [canonicalName, aliases] of SAFE_ALIAS_BY_NORMALIZED_NAME) {
      if (!aliases.includes(candidate)) continue;
      const row = findMasterByName(masterByName, normalizeOfficialSectorName(canonicalName));
      if (row) {
        candidateOfficialNames.push(row.officialIndexName);
        return { row, aliasSource: candidate, candidateOfficialNames };
      }
      candidateOfficialNames.push(canonicalName);
    }
  }
  return candidateOfficialNames.length > 0 ? { row: null, aliasSource: candidates[0] ?? '', candidateOfficialNames } : null;
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
    candidateOfficialNames: row.candidateOfficialNames,
    exactMatch: row.exactMatch,
    safeAliasMatch: row.safeAliasMatch,
    unsafeAliasMatch: row.unsafeAliasMatch,
    selectedOfficialIndexName: row.selectedOfficialIndexName,
    selectedOfficialIndexCode: row.selectedOfficialIndexCode,
    includedInOfficialCoverage: row.includedInOfficialCoverage,
    shadowEvidenceOnly: row.shadowEvidenceOnly,
    reasonCode: row.reasonCode,
  };
}

function isLikelyEnglishSector(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

export function mapSectorNamesToOfficialIndexCodes(input: {
  targets: readonly OfficialSectorIndexTarget[];
  masterRows: readonly OfficialSectorIndexMasterRow[];
}): OfficialSectorIndexCodeMapResult {
  const masterByCode = new Map<string, OfficialSectorIndexMasterRow>();
  const masterByName = new Map<string, OfficialSectorIndexMasterRow>();
  for (const row of input.masterRows) {
    masterByCode.set(row.officialIndexCode, row);
    registerMasterName(masterByName, row.normalizedSectorName, row);
    registerMasterName(masterByName, normalizeOfficialSectorName(row.officialIndexName), row);
    registerMasterName(masterByName, normalizeOfficialSectorName(row.rawSectorName), row);
  }

  const rows: OfficialSectorIndexCodeMappingRow[] = [];
  let safeAliasCount = 0;
  let unsafeAliasCount = 0;
  let exactMatchCount = 0;
  const unresolved: string[] = [];
  const unsafeAliasSectorNames: string[] = [];

  for (const target of input.targets) {
    const sectorName = String(target.sectorName ?? '').trim();
    const candidateCode = String(target.candidateIndexCode ?? '').trim();
    const normalizedName = normalizeOfficialSectorName(sectorName);
    const unsafeTheme = isUnsafeThemeTarget(target);
    let matched: OfficialSectorIndexMasterRow | null = null;
    let aliasSource: string | undefined;
    let safeAlias = false;
    let exactMatch = false;
    let safeAliasMatch: string | null = null;
    let unsafeAliasMatch: string | null = null;
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
        safeAlias = true;
        safeAliasMatch = aliasMatch.row.officialIndexName;
      }
      if (aliasMatch?.candidateOfficialNames.length) candidateOfficialNames.push(...aliasMatch.candidateOfficialNames);
    }

    const unsafeAlias = unsafeTheme ? findByUnsafeAlias(target, masterByName) : null;
    if (unsafeAlias) {
      unsafeAliasMatch = unsafeAlias.row?.officialIndexName ?? unsafeAlias.candidateOfficialNames[0] ?? null;
      candidateOfficialNames.push(...unsafeAlias.candidateOfficialNames);
      if (!matched && unsafeAlias.row) {
        matched = unsafeAlias.row;
        aliasSource = unsafeAlias.aliasSource;
      }
    }

    const matchedOfficial = officialSource(matched);
    const uniqueCandidateOfficialNames = Array.from(new Set(candidateOfficialNames.filter(Boolean)));

    if (matched && matchedOfficial && !unsafeTheme) {
      if (safeAlias) safeAliasCount += 1;
      if (exactMatch && !safeAlias) exactMatchCount += 1;
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        normalizedInternalName: normalizedName,
        candidateOfficialNames: uniqueCandidateOfficialNames,
        exactMatch,
        safeAliasMatch,
        unsafeAliasMatch: null,
        officialIndexCode: matched.officialIndexCode,
        officialIndexName: matched.officialIndexName,
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
        reasonCode: safeAlias ? 'SAFE_ALIAS_MAPPED' : 'OFFICIAL_INDEX_CODE_MAPPED',
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
        candidateOfficialNames: uniqueCandidateOfficialNames,
        exactMatch,
        safeAliasMatch,
        unsafeAliasMatch,
        officialIndexCode: matched?.officialIndexCode ?? null,
        officialIndexName: matched?.officialIndexName ?? null,
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
        candidateOfficialNames: uniqueCandidateOfficialNames,
        exactMatch,
        safeAliasMatch,
        unsafeAliasMatch,
        officialIndexCode: matched.officialIndexCode,
        officialIndexName: matched.officialIndexName,
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

    unresolved.push(sectorName);
    rows.push({
      sectorName,
      sectorKey: target.sectorKey,
      normalizedInternalName: normalizedName,
      candidateOfficialNames: uniqueCandidateOfficialNames,
      exactMatch: false,
      safeAliasMatch: null,
      unsafeAliasMatch: null,
      officialIndexCode: null,
      officialIndexName: null,
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
      reasonCode: 'OFFICIAL_INDEX_CODE_UNRESOLVED',
    });
  }

  const mappedSectorCount = rows.filter((row) => row.officialCoverageEligible && row.officialIndexCode).length;
  const mappedSectorPairs = rows
    .filter((row) => row.officialCoverageEligible && row.officialIndexCode && row.officialIndexName)
    .map((row) => `${row.sectorName} -> ${row.officialIndexName}(code=${row.officialIndexCode})`);
  const reasonCodes = new Set<string>();
  reasonCodes.add(mappedSectorCount > 0 ? 'OFFICIAL_INDEX_CODE_MAPPED' : 'OFFICIAL_INDEX_COVERAGE_ZERO');
  if (safeAliasCount > 0) reasonCodes.add('SAFE_ALIAS_MAPPED');
  if (unsafeAliasCount > 0) reasonCodes.add('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  if (unresolved.length > 0) {
    reasonCodes.add('OFFICIAL_INDEX_MASTER_UNRESOLVED_SECTORS');
    reasonCodes.add('INTERNAL_SECTOR_ALIAS_MISSING');
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
    aliasResolvedCount: safeAliasCount + unsafeAliasCount,
    safeAliasCount,
    unsafeAliasCount,
    unsafeAliasSectorNames,
    mappedSectorPairs,
    unresolvedSectorNames: unresolved,
    topMissingSectorNames: unresolved.slice(0, 12),
    internalSectorNames: input.targets.map((target) => String(target.sectorName ?? '').trim()).filter(Boolean),
    normalizedInternalSectorNames: input.targets.map((target) => normalizeOfficialSectorName(target.sectorName)).filter(Boolean),
    mappingAttempts: rows.map(attemptFromRow),
    rows,
    reasonCodes: Array.from(reasonCodes),
  };
}
