import type { SectorEnergySourceTier } from '../../services/sector/SectorEnergyDiagnostics';

export interface SectorIndexMasterRow {
  market: 'KOSPI' | 'KOSDAQ' | 'KOSPI200' | 'UNKNOWN';
  idxDiv?: string;
  officialIndexCode: string;
  officialIndexName: string;
  normalizedSectorName: string;
  rawSectorName: string;
  sourceTier: SectorEnergySourceTier;
  aliasResolved: boolean;
  aliasSource?: string;
  unsafeAlias: boolean;
}

const SAFE_ALIASES: Record<string, string> = {
  '전기전자': '전기전자',
  '금융업': '금융',
  '금융': '금융',
  '보험': '보험',
  '증권': '증권',
  '은행': '은행',
  '화학': '화학',
  '제약': '제약',
};

const UNSAFE_ALIASES: Record<string, string[]> = {
  '조선': ['운수장비', '기계장비'],
  '방산': ['기계장비', '운수장비', '전기전자'],
  '원자력': ['기계장비', '건설', '전기전자'],
  '2차전지': ['화학', '전기전자'],
  'ai': ['서비스업', '전기전자'],
  '로봇': ['기계장비', '전기전자'],
  '바이오': ['제약'],
};

export function normalizeSectorName(name: string): string {
  return name
    .normalize('NFKC')
    .trim()
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[\s\-_]+/g, ' ')
    .replace(/(KRX|코스피|코스닥|업종|지수)/gi, '')
    .trim();
}

export function resolveSectorAlias(normalized: string): { resolved: string; aliasResolved: boolean; unsafeAlias: boolean; aliasSource?: string } {
  if (SAFE_ALIASES[normalized]) {
    return { resolved: SAFE_ALIASES[normalized], aliasResolved: SAFE_ALIASES[normalized] !== normalized, unsafeAlias: false, aliasSource: 'SAFE_DICT' };
  }

  const unsafeTargets = UNSAFE_ALIASES[normalized.toLowerCase()] ?? UNSAFE_ALIASES[normalized];
  if (unsafeTargets && unsafeTargets.length > 0) {
    return { resolved: unsafeTargets[0], aliasResolved: true, unsafeAlias: true, aliasSource: 'UNSAFE_DICT' };
  }

  return { resolved: normalized, aliasResolved: false, unsafeAlias: false };
}
