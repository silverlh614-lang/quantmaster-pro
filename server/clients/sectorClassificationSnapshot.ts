// @responsibility Internal read-only SymbolSectorMap snapshot for grouped SectorEnergy diagnostics.

export type SectorClassificationSource =
  | 'INTERNAL_SNAPSHOT'
  | 'KRX_MASTER'
  | 'MANUAL_REVIEWED'
  | 'UNKNOWN';

export type SectorClassificationConfidence =
  | 'VERIFIED'
  | 'REVIEW_REQUIRED'
  | 'MISSING';

export type StandardSectorKey =
  | 'SEMICONDUCTOR'
  | 'BATTERY'
  | 'BIO_HEALTHCARE'
  | 'FINANCE'
  | 'SHIPBUILDING'
  | 'DEFENSE'
  | 'NUCLEAR'
  | 'STEEL'
  | 'CHEMICAL'
  | 'CONSTRUCTION'
  | 'CONSUMER_RETAIL'
  | 'IT_INTERNET'
  | 'AUTOMOTIVE'
  | 'OTHER';

export type SymbolSectorSnapshotRow = {
  symbol: string;
  name?: string;
  sectorKey: StandardSectorKey;
  sectorName: string;
  source: SectorClassificationSource;
  confidence: SectorClassificationConfidence;
  reviewedAt?: string;
  aliases?: string[];
};

export interface SectorClassificationSnapshotCoverage {
  requestedSymbols: number;
  classifiedSymbols: number;
  missingClassification: number;
  snapshotCoverage: string;
  source: SectorClassificationSource;
  confidence: SectorClassificationConfidence;
  missingSymbols: string[];
  executionImpact: 'NONE';
}

export const STANDARD_SECTOR_KEYS: ReadonlyArray<StandardSectorKey> = Object.freeze([
  'SEMICONDUCTOR',
  'BATTERY',
  'BIO_HEALTHCARE',
  'FINANCE',
  'SHIPBUILDING',
  'DEFENSE',
  'NUCLEAR',
  'STEEL',
  'CHEMICAL',
  'CONSTRUCTION',
  'CONSUMER_RETAIL',
  'IT_INTERNET',
  'AUTOMOTIVE',
  'OTHER',
]);

const REVIEWED_AT = '2026-05-14';

function row(
  symbol: string,
  name: string,
  sectorKey: StandardSectorKey,
  sectorName: string,
  aliases: string[] = [],
): SymbolSectorSnapshotRow {
  return Object.freeze({
    symbol,
    name,
    sectorKey,
    sectorName,
    source: 'INTERNAL_SNAPSHOT' as const,
    confidence: 'VERIFIED' as const,
    reviewedAt: REVIEWED_AT,
    ...(aliases.length > 0 ? { aliases } : {}),
  });
}

/**
 * Internal SymbolSectorMap snapshot. Read-only, low-frequency classification data.
 * This is not an official KRX benchmark and never promotes KIS basket/proxy rows to CORE.
 */
export const SYMBOL_SECTOR_SNAPSHOT: ReadonlyArray<SymbolSectorSnapshotRow> = Object.freeze([
  row('005930', '삼성전자', 'SEMICONDUCTOR', '반도체', ['Samsung Electronics']),
  row('000660', 'SK하이닉스', 'SEMICONDUCTOR', '반도체'),
  row('042700', '한미반도체', 'SEMICONDUCTOR', '반도체'),
  row('039030', '이오테크닉스', 'SEMICONDUCTOR', '반도체'),
  row('373220', 'LG에너지솔루션', 'BATTERY', '이차전지'),
  row('006400', '삼성SDI', 'BATTERY', '이차전지'),
  row('247540', '에코프로비엠', 'BATTERY', '이차전지'),
  row('003670', '포스코퓨처엠', 'BATTERY', '이차전지'),
  row('207940', '삼성바이오로직스', 'BIO_HEALTHCARE', '바이오/헬스케어'),
  row('068270', '셀트리온', 'BIO_HEALTHCARE', '바이오/헬스케어'),
  row('326030', 'SK바이오팜', 'BIO_HEALTHCARE', '바이오/헬스케어'),
  row('128940', '한미약품', 'BIO_HEALTHCARE', '바이오/헬스케어'),
  row('105560', 'KB금융', 'FINANCE', '금융'),
  row('055550', '신한지주', 'FINANCE', '금융'),
  row('086790', '하나금융지주', 'FINANCE', '금융'),
  row('316140', '우리금융지주', 'FINANCE', '금융'),
  row('329180', 'HD현대중공업', 'SHIPBUILDING', '조선'),
  row('042660', '한화오션', 'SHIPBUILDING', '조선'),
  row('010140', '삼성중공업', 'SHIPBUILDING', '조선'),
  row('009540', 'HD한국조선해양', 'SHIPBUILDING', '조선'),
  row('012450', '한화에어로스페이스', 'DEFENSE', '방산'),
  row('064350', '현대로템', 'DEFENSE', '방산'),
  row('079550', 'LIG넥스원', 'DEFENSE', '방산'),
  row('047810', '한국항공우주', 'DEFENSE', '방산'),
  row('034020', '두산에너빌리티', 'NUCLEAR', '원자력'),
  row('010120', 'LS ELECTRIC', 'NUCLEAR', '원자력'),
  row('051600', '한전KPS', 'NUCLEAR', '원자력'),
  row('052690', '한전기술', 'NUCLEAR', '원자력'),
  row('005490', 'POSCO홀딩스', 'STEEL', '철강'),
  row('004020', '현대제철', 'STEEL', '철강'),
  row('010130', '고려아연', 'STEEL', '철강'),
  row('016380', 'KG스틸', 'STEEL', '철강'),
  row('096770', 'SK이노베이션', 'CHEMICAL', '화학'),
  row('010950', 'S-Oil', 'CHEMICAL', '화학'),
  row('051910', 'LG화학', 'CHEMICAL', '화학'),
  row('011170', '롯데케미칼', 'CHEMICAL', '화학'),
  row('000720', '현대건설', 'CONSTRUCTION', '건설'),
  row('028050', '삼성E&A', 'CONSTRUCTION', '건설'),
  row('047040', '대우건설', 'CONSTRUCTION', '건설'),
  row('006360', 'GS건설', 'CONSTRUCTION', '건설'),
  row('023530', '롯데쇼핑', 'CONSUMER_RETAIL', '유통/소비재'),
  row('004170', '신세계', 'CONSUMER_RETAIL', '유통/소비재'),
  row('097950', 'CJ제일제당', 'CONSUMER_RETAIL', '유통/소비재'),
  row('035420', 'NAVER', 'IT_INTERNET', 'IT/인터넷'),
  row('035720', '카카오', 'IT_INTERNET', 'IT/인터넷'),
  row('005380', '현대차', 'AUTOMOTIVE', '자동차'),
]);

const SNAPSHOT_BY_SYMBOL: ReadonlyMap<string, SymbolSectorSnapshotRow> = new Map(
  SYMBOL_SECTOR_SNAPSHOT.map((item) => [item.symbol, item]),
);

export function normalizeKrxSymbol(symbol: string): string {
  const digits = String(symbol ?? '').replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits.padStart(6, '0');
}

export function getSymbolSectorSnapshotRow(symbol: string): SymbolSectorSnapshotRow | undefined {
  return SNAPSHOT_BY_SYMBOL.get(normalizeKrxSymbol(symbol));
}

export function evaluateSectorClassificationSnapshotCoverage(symbols: readonly string[]): SectorClassificationSnapshotCoverage {
  const normalized = Array.from(new Set(symbols.map(normalizeKrxSymbol).filter((symbol) => /^\d{6}$/.test(symbol))));
  const missingSymbols = normalized.filter((symbol) => !SNAPSHOT_BY_SYMBOL.has(symbol));
  const classifiedSymbols = normalized.length - missingSymbols.length;
  const confidence: SectorClassificationConfidence = missingSymbols.length === 0
    ? 'VERIFIED'
    : classifiedSymbols > 0 ? 'REVIEW_REQUIRED' : 'MISSING';
  return {
    requestedSymbols: normalized.length,
    classifiedSymbols,
    missingClassification: missingSymbols.length,
    snapshotCoverage: `${classifiedSymbols}/${normalized.length}`,
    source: 'INTERNAL_SNAPSHOT',
    confidence,
    missingSymbols,
    executionImpact: 'NONE',
  };
}

export function groupSymbolsBySnapshotSector(symbols: readonly string[]): Map<StandardSectorKey, SymbolSectorSnapshotRow[]> {
  const grouped = new Map<StandardSectorKey, SymbolSectorSnapshotRow[]>();
  for (const symbol of Array.from(new Set(symbols.map(normalizeKrxSymbol)))) {
    const row = SNAPSHOT_BY_SYMBOL.get(symbol);
    if (!row) continue;
    const current = grouped.get(row.sectorKey) ?? [];
    current.push(row);
    grouped.set(row.sectorKey, current);
  }
  return grouped;
}
