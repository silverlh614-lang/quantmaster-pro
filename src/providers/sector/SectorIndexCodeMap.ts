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
  '반도체': '전기전자',
  '전기전자': '전기전자',
  '바이오': '제약',
  '제약': '제약',
  '2차전지': '화학',
  '이차전지': '화학',
  '자동차': '운송장비',
  '운송장비': '운송장비',
  '금융': '금융업',
  '금융업': '금융업',
  '증권': '증권',
  '보험': '보험',
  '은행': '은행',
  '화학': '화학',
  '건설': '건설',
  '기계장비': '기계장비',
  '서비스업': '서비스업',
};

const UNSAFE_ALIASES: Record<string, string[]> = {
  '조선': ['운송장비', '기계장비'],
  '방산': ['기계장비', '운송장비', '전기전자'],
  '원자력': ['기계장비', '건설', '전기전자'],
  '로봇': ['기계장비', '전기전자'],
  'ai': ['서비스업', '전기전자'],
  '인공지능': ['서비스업', '전기전자'],
};

export function normalizeSectorName(name: string): string {
  return name
    .normalize('NFKC')
    .trim()
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/[·ㆍ,./\\|]/g, ' ')
    .replace(/\b(KRX|KOSPI|KOSDAQ|KOSPI200)\b/gi, ' ')
    .replace(/(코스피|코스닥|코스피200|업종|지수|전체|종합)/g, ' ')
    .replace(/[\s\-_]+/g, ' ')
    .trim();
}

export function resolveSectorAlias(
  normalized: string,
): { resolved: string; aliasResolved: boolean; unsafeAlias: boolean; aliasSource?: string } {
  const safeTarget = SAFE_ALIASES[normalized];
  if (safeTarget) {
    return {
      resolved: safeTarget,
      aliasResolved: safeTarget !== normalized,
      unsafeAlias: false,
      aliasSource: safeTarget !== normalized ? 'SAFE_DICT' : 'EXACT_OFFICIAL_NAME',
    };
  }

  const unsafeTargets = UNSAFE_ALIASES[normalized.toLowerCase()] ?? UNSAFE_ALIASES[normalized];
  if (unsafeTargets && unsafeTargets.length > 0) {
    return {
      resolved: unsafeTargets[0],
      aliasResolved: true,
      unsafeAlias: true,
      aliasSource: 'UNSAFE_THEME_DICT',
    };
  }

  return { resolved: normalized, aliasResolved: false, unsafeAlias: false };
}
