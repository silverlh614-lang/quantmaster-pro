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
  officialIndexCode: string | null;
  officialIndexName: string | null;
  market: OfficialSectorIndexMasterRow['market'];
  sourceTier: OfficialSectorEnergySourceTier;
  aliasResolved: boolean;
  aliasSource?: string;
  safeAlias: boolean;
  unsafeAlias: boolean;
  officialCoverageEligible: boolean;
  shadowEvidenceOnly: boolean;
  reasonCode: string;
}

export interface OfficialSectorIndexCodeMapResult {
  targetSectorCount: number;
  mappedSectorCount: number;
  officialIndexCoverage: number;
  aliasResolvedCount: number;
  safeAliasCount: number;
  unsafeAliasCount: number;
  unresolvedSectorNames: string[];
  topMissingSectorNames: string[];
  rows: OfficialSectorIndexCodeMappingRow[];
  reasonCodes: string[];
}

const SAFE_ALIAS_BY_NORMALIZED_NAME = new Map<string, readonly string[]>([
  ['finance', ['finance', 'financial', 'financials']],
  ['bank', ['bank', 'banks']],
  ['insurance', ['insurance']],
  ['securities', ['securities', 'brokerage']],
  ['chemical', ['chemical', 'chemicals']],
  ['pharma', ['pharma', 'pharmaceutical', 'healthcare', 'bio']],
  ['electric electronics', ['electric electronics', 'electronics']],
  ['machinery', ['machinery', 'machine equipment']],
  ['construction', ['construction']],
  ['steel', ['steel', 'metal']],
  ['전기전자', ['전기전자', 'electric electronics', 'electronics']],
  ['금융업', ['금융', '금융업', 'finance', 'financial', 'financials']],
  ['보험', ['보험']],
  ['증권', ['증권']],
  ['은행', ['은행']],
  ['화학', ['화학', 'chemical', 'chemicals']],
  ['제약', ['제약', 'pharma', 'pharmaceutical']],
  ['운수장비', ['운수장비', '운송장비', 'transport equipment']],
  ['기계', ['기계', 'machinery']],
  ['철강금속', ['철강금속', '철강', 'steel', 'metal']],
  ['서비스업', ['서비스업', '서비스', 'service']],
  ['건설업', ['건설업', '건설', 'construction']],
  ['운수창고', ['운수창고', 'transport warehouse']],
]);

const UNSAFE_THEME_KEYS = new Set([
  'DEFENSE',
  'NUCLEAR',
  'ROBOT',
  'SHIPBUILDING',
  'BATTERY',
  'SEMICONDUCTOR',
  'AUTO',
  'AI',
]);

const UNSAFE_THEME_NORMALIZED_NAMES = new Set([
  'defense',
  'nuclear',
  'robot',
  'shipbuilding',
  'battery',
  'semiconductor',
  'auto',
  'automotive',
  'ai',
  '조선',
  '방산',
  '원자력',
  '2차전지',
  '이차전지',
  '로봇',
  '반도체',
  '자동차',
]);

function stripNoise(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\b(KRX|KOSPI|KOSDAQ|KONEX|INDEX|INDICES|SECTOR|INDUSTRY|COMPOSITE)\b/gi, ' ')
    .replace(/(한국거래소|코스피|코스닥|코넥스|업종|섹터|산업|지수)/g, ' ')
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

function findBySafeAlias(
  target: OfficialSectorIndexTarget,
  masterByName: Map<string, OfficialSectorIndexMasterRow>,
): { row: OfficialSectorIndexMasterRow; aliasSource: string } | null {
  const candidates = [
    target.sectorName,
    target.sectorKey,
    ...(target.aliasCandidates ?? []),
  ]
    .map(normalizeOfficialSectorName)
    .filter(Boolean);

  for (const candidate of candidates) {
    for (const [canonicalName, aliases] of SAFE_ALIAS_BY_NORMALIZED_NAME) {
      if (!aliases.includes(candidate)) continue;
      const row = masterByName.get(canonicalName);
      if (row) return { row, aliasSource: candidate };
    }
  }
  return null;
}

function isUnsafeThemeTarget(target: OfficialSectorIndexTarget): boolean {
  const key = String(target.sectorKey ?? '').trim().toUpperCase();
  if (UNSAFE_THEME_KEYS.has(key)) return true;
  const candidates = [
    target.sectorName,
    target.sectorKey,
    ...(target.aliasCandidates ?? []),
  ].map(normalizeOfficialSectorName).filter(Boolean);
  return candidates.some((candidate) => UNSAFE_THEME_NORMALIZED_NAMES.has(candidate));
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

export function mapSectorNamesToOfficialIndexCodes(input: {
  targets: readonly OfficialSectorIndexTarget[];
  masterRows: readonly OfficialSectorIndexMasterRow[];
}): OfficialSectorIndexCodeMapResult {
  const masterByCode = new Map<string, OfficialSectorIndexMasterRow>();
  const masterByName = new Map<string, OfficialSectorIndexMasterRow>();
  for (const row of input.masterRows) {
    masterByCode.set(row.officialIndexCode, row);
    if (row.normalizedSectorName) masterByName.set(row.normalizedSectorName, row);
  }

  const rows: OfficialSectorIndexCodeMappingRow[] = [];
  let safeAliasCount = 0;
  let unsafeAliasCount = 0;
  const unresolved: string[] = [];

  for (const target of input.targets) {
    const sectorName = String(target.sectorName ?? '').trim();
    const candidateCode = String(target.candidateIndexCode ?? '').trim();
    const normalizedName = normalizeOfficialSectorName(sectorName);
    const unsafeTheme = isUnsafeThemeTarget(target);
    let matched: OfficialSectorIndexMasterRow | null = null;
    let aliasSource: string | undefined;
    let safeAlias = false;

    if (/^\d{4}$/.test(candidateCode)) {
      matched = masterByCode.get(candidateCode) ?? null;
    }
    if (!matched && normalizedName) {
      matched = masterByName.get(normalizedName) ?? null;
    }
    if (!matched) {
      const aliasMatch = findBySafeAlias(target, masterByName);
      if (aliasMatch) {
        matched = aliasMatch.row;
        aliasSource = aliasMatch.aliasSource;
        safeAlias = true;
      }
    }

    const matchedOfficial = matched?.sourceTier === 'OFFICIAL_KIS_SECTOR_INDEX'
      || matched?.sourceTier === 'OFFICIAL_KRX_SECTOR_INDEX';

    if (matched && matchedOfficial && !unsafeTheme) {
      if (safeAlias) safeAliasCount += 1;
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        officialIndexCode: matched.officialIndexCode,
        officialIndexName: matched.officialIndexName,
        market: matched.market,
        sourceTier: matched.sourceTier,
        aliasResolved: Boolean(aliasSource),
        ...(aliasSource ? { aliasSource } : {}),
        safeAlias,
        unsafeAlias: false,
        officialCoverageEligible: true,
        shadowEvidenceOnly: false,
        reasonCode: safeAlias ? 'SAFE_ALIAS_MAPPED' : 'OFFICIAL_INDEX_CODE_MAPPED',
      });
      continue;
    }

    if (matched && !matchedOfficial) {
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        officialIndexCode: matched.officialIndexCode,
        officialIndexName: matched.officialIndexName,
        market: matched.market,
        sourceTier: matched.sourceTier,
        aliasResolved: Boolean(aliasSource),
        ...(aliasSource ? { aliasSource } : {}),
        safeAlias,
        unsafeAlias: unsafeTheme,
        officialCoverageEligible: false,
        shadowEvidenceOnly: true,
        reasonCode: 'NON_OFFICIAL_SOURCE_SHADOW_ONLY',
      });
      continue;
    }

    if (unsafeTheme) {
      unsafeAliasCount += 1;
      rows.push({
        sectorName,
        sectorKey: target.sectorKey,
        officialIndexCode: matched?.officialIndexCode ?? null,
        officialIndexName: matched?.officialIndexName ?? null,
        market: matched?.market ?? 'UNKNOWN',
        sourceTier: matched?.sourceTier ?? 'NONE',
        aliasResolved: Boolean(matched),
        aliasSource: target.sectorKey,
        safeAlias: false,
        unsafeAlias: true,
        officialCoverageEligible: false,
        shadowEvidenceOnly: true,
        reasonCode: 'UNSAFE_ALIAS_SHADOW_ONLY',
      });
      continue;
    }

    unresolved.push(sectorName);
    rows.push({
      sectorName,
      sectorKey: target.sectorKey,
      officialIndexCode: null,
      officialIndexName: null,
      market: 'UNKNOWN',
      sourceTier: 'NONE',
      aliasResolved: false,
      safeAlias: false,
      unsafeAlias: false,
      officialCoverageEligible: false,
      shadowEvidenceOnly: false,
      reasonCode: 'OFFICIAL_INDEX_CODE_UNRESOLVED',
    });
  }

  const mappedSectorCount = rows.filter((row) => row.officialCoverageEligible && row.officialIndexCode).length;
  const reasonCodes = new Set<string>();
  reasonCodes.add(mappedSectorCount > 0 ? 'OFFICIAL_INDEX_MASTER_LOADED' : 'OFFICIAL_INDEX_COVERAGE_ZERO');
  if (safeAliasCount > 0) reasonCodes.add('SAFE_ALIAS_MAPPED');
  if (unsafeAliasCount > 0) reasonCodes.add('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  if (unresolved.length > 0) reasonCodes.add('OFFICIAL_INDEX_MASTER_UNRESOLVED_SECTORS');

  return {
    targetSectorCount: input.targets.length,
    mappedSectorCount,
    officialIndexCoverage: pct(mappedSectorCount, input.targets.length),
    aliasResolvedCount: safeAliasCount + unsafeAliasCount,
    safeAliasCount,
    unsafeAliasCount,
    unresolvedSectorNames: unresolved,
    topMissingSectorNames: unresolved.slice(0, 12),
    rows,
    reasonCodes: Array.from(reasonCodes),
  };
}
