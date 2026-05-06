// @responsibility sectorEnergyProvider 외부 클라이언트 모듈
/**
 * sectorEnergyProvider.ts — KRX 실데이터를 sectorEnergyEngine 입력으로 가공.
 * ADR-0343: public meta builder itself is fallback-aware.
 * ADR-0362: KRX index daily 가 empty 일 때 종목별 KRX 일별거래 + sector map 으로 합성.
 * ADR-0365: data-dbg index rows 는 IDX_IND_CD 없이 IDX_NM 만 올 수 있으므로
 * indexCode symmetry 실패 시 indexName 매칭 또는 stock-daily synthetic fallback 으로 강등.
 */

import {
  fetchKospiIndexDaily,
  fetchKosdaqIndexDaily,
  recentBusinessDaysKst,
  fetchKospiDailyTrade,
  fetchKosdaqDailyTrade,
  type KrxIndexDailyRow,
  type KrxStockDailyRow,
} from './krxOpenApi.js';
import { fetchInvestorTrading, type KrxInvestorRow } from './krxClient.js';
import { safePctChange } from '../utils/safePctChange.js';
import { isKrxTradingDay } from '../calendar/krxTradingCalendar.js';
import { getSectorByCode } from '../screener/sectorMap.js';

export type StrategicSector =
  | '반도체'
  | '이차전지'
  | '바이오/헬스케어'
  | '인터넷/플랫폼'
  | '자동차'
  | '조선'
  | '방산'
  | '금융'
  | '유통/소비재'
  | '건설/부동산'
  | '에너지/화학'
  | '통신/유틸리티';

export interface SectorEnergyInput {
  name: StrategicSector;
  return4w: number;
  volumeChangePct: number;
  foreignConcentration: number;
}

const CANONICAL_SECTORS: StrategicSector[] = [
  '반도체', '이차전지', '바이오/헬스케어', '인터넷/플랫폼',
  '자동차', '조선', '방산', '금융',
  '유통/소비재', '건설/부동산', '에너지/화학', '통신/유틸리티',
];
const TOTAL_SECTOR_COUNT = CANONICAL_SECTORS.length;

const KRX_INDEX_TO_SECTOR: Array<[RegExp, StrategicSector]> = [
  [/반도체|전기전자|IT\s*하드|IT\s*H\/W/i, '반도체'],
  [/이차\s*전지|배터리|2차\s*전지|전지/, '이차전지'],
  [/바이오|헬스|의약|제약|의료/, '바이오/헬스케어'],
  [/플랫폼|인터넷|S\/W|소프트웨어|IT\s*S\/W|게임|미디어|서비스업/i, '인터넷/플랫폼'],
  [/자동차|운수장비/, '자동차'],
  [/조선|기계/, '조선'],
  [/방산|국방/, '방산'],
  [/은행|증권|보험|금융/, '금융'],
  [/유통|소비재|음식료|섬유/, '유통/소비재'],
  [/건설|부동산|리츠/, '건설/부동산'],
  [/에너지|화학|철강|비금속|종이|목재|석유/, '에너지/화학'],
  [/통신|전기가스|유틸리티/, '통신/유틸리티'],
];

function classifyStockSector(stockSector: string): StrategicSector | null {
  if (!stockSector) return null;
  for (const [pattern, canonical] of KRX_INDEX_TO_SECTOR) {
    if (pattern.test(stockSector)) return canonical;
  }
  return null;
}

function classifyIndex(indexName: string): StrategicSector | null {
  if (!indexName) return null;
  for (const [pattern, canonical] of KRX_INDEX_TO_SECTOR) {
    if (pattern.test(indexName)) return canonical;
  }
  return null;
}

function resolveStockSector(row: KrxStockDailyRow): StrategicSector | null {
  return classifyStockSector(row.sector) ?? classifyStockSector(getSectorByCode(row.code));
}

function shiftedKstDateKey(kst: Date): string {
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toYyyymmdd(dateKey: string): string {
  return dateKey.replace(/-/g, '');
}

function businessDaysAgo(n: number): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  kst.setUTCDate(kst.getUTCDate() - 1);
  let remaining = n;
  let guard = 0;
  while (remaining > 0 && guard < 80) {
    kst.setUTCDate(kst.getUTCDate() - 1);
    if (isKrxTradingDay(shiftedKstDateKey(kst))) remaining -= 1;
    guard += 1;
  }
  return toYyyymmdd(shiftedKstDateKey(kst));
}

const SECTOR_CLOSE_RATIO_MAX = 10;
const SECTOR_CLOSE_RATIO_MIN = 0.1;
export const SECTOR_ENERGY_MIN_VALID_DEFAULT = 8;
export const SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD = 0.9;
export type SectorEnergyDataQuality = 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';

export interface SymmetryValidationResult {
  valid: boolean;
  todayCodeFillRatio: number;
  pastCodeFillRatio: number;
  reasons: string[];
}

export function validateIndexResponseSymmetry(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
): SymmetryValidationResult {
  const reasons: string[] = [];
  if (todayRows.length === 0 || pastRows.length === 0) {
    reasons.push(`empty rows: today=${todayRows.length}, past=${pastRows.length}`);
    return { valid: false, todayCodeFillRatio: 0, pastCodeFillRatio: 0, reasons };
  }
  const todayCodeFillRatio = todayRows.filter((r) => Boolean(r.indexCode)).length / todayRows.length;
  const pastCodeFillRatio = pastRows.filter((r) => Boolean(r.indexCode)).length / pastRows.length;
  if (todayCodeFillRatio < SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD) {
    reasons.push(`today indexCode 충실도 ${(todayCodeFillRatio * 100).toFixed(1)}% < ${(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD * 100).toFixed(0)}%`);
  }
  if (pastCodeFillRatio < SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD) {
    reasons.push(`past indexCode 충실도 ${(pastCodeFillRatio * 100).toFixed(1)}% < ${(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD * 100).toFixed(0)}%`);
  }
  return { valid: reasons.length === 0, todayCodeFillRatio, pastCodeFillRatio, reasons };
}

export function isSectorEnergySymmetryDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SYMMETRY_DISABLED === 'true';
}

export function isSectorEnergyIndexNameFallbackEnabled(): boolean {
  return process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK !== 'false';
}

export function getSectorEnergyMinValid(): number {
  const env = Number(process.env.SECTOR_ENERGY_MIN_VALID);
  if (Number.isFinite(env) && env > 0 && env <= TOTAL_SECTOR_COUNT) return env;
  return SECTOR_ENERGY_MIN_VALID_DEFAULT;
}

export function aggregateIndexDeltas(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
): Map<StrategicSector, { returns: number[]; volumes: number[] }> {
  const pastByCode = new Map<string, KrxIndexDailyRow>();
  const pastByName = new Map<string, KrxIndexDailyRow>();
  for (const r of pastRows) {
    if (r.indexCode) pastByCode.set(r.indexCode, r);
    if (r.indexName) pastByName.set(r.indexName, r);
  }
  const bySector = new Map<StrategicSector, { returns: number[]; volumes: number[] }>();
  for (const t of todayRows) {
    const canonical = classifyIndex(t.indexName);
    if (!canonical) continue;
    let past: KrxIndexDailyRow | undefined;
    let matchKind: 'code' | 'name' | null = null;
    if (t.indexCode) {
      past = pastByCode.get(t.indexCode);
      if (past) matchKind = 'code';
    }
    if (!past && t.indexName && isSectorEnergyIndexNameFallbackEnabled()) {
      past = pastByName.get(t.indexName);
      if (past) matchKind = 'name';
    }
    if (!past || past.close <= 0 || matchKind === null) continue;
    const ratio = t.close > 0 ? t.close / past.close : 0;
    if (!Number.isFinite(ratio) || ratio > SECTOR_CLOSE_RATIO_MAX || ratio < SECTOR_CLOSE_RATIO_MIN) continue;
    if (t.baseDate && past.baseDate && t.baseDate === past.baseDate) continue;
    const labelKey = t.indexCode || t.indexName;
    const returnPct = safePctChange(t.close, past.close, { label: `sectorEnergy.return:${labelKey}` });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(t.volume, past.volume, { label: `sectorEnergy.volume:${labelKey}`, sanityBoundPct: 1000 }) ?? 0)
      : 0;
    const acc = bySector.get(canonical) ?? { returns: [], volumes: [] };
    acc.returns.push(returnPct);
    acc.volumes.push(volumePct);
    bySector.set(canonical, acc);
  }
  return bySector;
}

function aggregateStockDeltas(
  todayStocks: KrxStockDailyRow[],
  pastStocks: KrxStockDailyRow[],
): Map<StrategicSector, { returns: number[]; volumes: number[] }> {
  const pastByCode = new Map<string, KrxStockDailyRow>();
  for (const row of pastStocks) {
    if (row.code && row.close > 0) pastByCode.set(row.code, row);
  }
  const bySector = new Map<StrategicSector, { returns: number[]; volumes: number[] }>();
  for (const today of todayStocks) {
    if (!today.code || today.close <= 0) continue;
    const sector = resolveStockSector(today);
    if (!sector) continue;
    const past = pastByCode.get(today.code);
    if (!past || past.close <= 0) continue;
    const returnPct = safePctChange(today.close, past.close, { label: `sectorEnergy.stockReturn:${today.code}` });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(today.volume, past.volume, { label: `sectorEnergy.stockVolume:${today.code}`, sanityBoundPct: 5000 }) ?? 0)
      : 0;
    const acc = bySector.get(sector) ?? { returns: [], volumes: [] };
    acc.returns.push(returnPct);
    acc.volumes.push(volumePct);
    bySector.set(sector, acc);
  }
  return bySector;
}

function aggregateForeignConcentration(
  investors: KrxInvestorRow[],
  stockSectorMap: Map<string, StrategicSector>,
): Map<StrategicSector, number> {
  const rawBySector = new Map<StrategicSector, number>();
  for (const row of investors) {
    const canonical = stockSectorMap.get(row.code);
    if (!canonical) continue;
    rawBySector.set(canonical, (rawBySector.get(canonical) ?? 0) + row.foreignNetBuy);
  }
  if (rawBySector.size === 0) return rawBySector;
  const values = Array.from(rawBySector.values());
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalized = new Map<StrategicSector, number>();
  if (max === min) {
    for (const [k] of rawBySector) normalized.set(k, 50);
    return normalized;
  }
  for (const [sector, v] of rawBySector) {
    normalized.set(sector, ((v - min) / (max - min)) * 100);
  }
  return normalized;
}

function buildStockSectorMap(stocks: KrxStockDailyRow[]): Map<string, StrategicSector> {
  const out = new Map<string, StrategicSector>();
  for (const s of stocks) {
    const canonical = resolveStockSector(s);
    if (canonical) out.set(s.code, canonical);
  }
  return out;
}

function buildInputsFromDeltas(
  deltas: Map<StrategicSector, { returns: number[]; volumes: number[] }>,
  foreignMap: Map<StrategicSector, number>,
): { inputs: SectorEnergyInput[]; validSectorCount: number } {
  const inputs: SectorEnergyInput[] = [];
  let validSectorCount = 0;
  for (const sector of CANONICAL_SECTORS) {
    const d = deltas.get(sector);
    const returns = d?.returns ?? [];
    const volumes = d?.volumes ?? [];
    if (returns.length > 0) validSectorCount++;
    const avg = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    inputs.push({
      name: sector,
      return4w: Number(avg(returns).toFixed(2)),
      volumeChangePct: Number(avg(volumes).toFixed(2)),
      foreignConcentration: Number((foreignMap.get(sector) ?? 0).toFixed(1)),
    });
  }
  return { inputs, validSectorCount };
}

function buildStockDailyFallbackResult(
  todayStocks: KrxStockDailyRow[],
  pastStocks: KrxStockDailyRow[],
  foreignMap: Map<StrategicSector, number>,
  prefixReasons: string[],
  qualityIfComplete: SectorEnergyDataQuality = 'STALE',
): SectorEnergyBuildResult | null {
  const deltas = aggregateStockDeltas(todayStocks, pastStocks);
  const { inputs, validSectorCount } = buildInputsFromDeltas(deltas, foreignMap);
  const minValid = getSectorEnergyMinValid();
  if (validSectorCount >= minValid) {
    return {
      inputs,
      dataQuality: validSectorCount === TOTAL_SECTOR_COUNT ? qualityIfComplete : 'STALE',
      validSectorCount,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      reasons: [
        ...prefixReasons,
        `ADR-0365 stock-daily fallback sector energy validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`,
      ],
    };
  }
  return null;
}

export interface SectorEnergyBuildResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  symmetryValidation?: SymmetryValidationResult;
  reasons: string[];
}

export async function buildSectorEnergyInputs(): Promise<SectorEnergyInput[]> {
  const result = await buildSectorEnergyInputsWithMeta();
  return result.inputs;
}

export async function buildSectorEnergyInputsWithMeta(): Promise<SectorEnergyBuildResult> {
  return buildSectorEnergyInputsWithMetaWithFallback();
}

async function buildSectorEnergyInputsWithMetaRaw(): Promise<SectorEnergyBuildResult> {
  const todayCandidates: Array<string | undefined> = [undefined, ...recentBusinessDaysKst(5)];
  const past = businessDaysAgo(20);
  let selectedToday: string | undefined;
  let todayKospiIdx: KrxIndexDailyRow[] = [];
  let todayKosdaqIdx: KrxIndexDailyRow[] = [];
  const attemptedTodayDates: string[] = [];
  for (const candidate of todayCandidates) {
    if (candidate) attemptedTodayDates.push(candidate);
    const [kospiIdx, kosdaqIdx] = await Promise.all([fetchKospiIndexDaily(candidate), fetchKosdaqIndexDaily(candidate)]);
    if (kospiIdx.length + kosdaqIdx.length > 0) {
      selectedToday = candidate;
      todayKospiIdx = kospiIdx;
      todayKosdaqIdx = kosdaqIdx;
      break;
    }
  }
  const [pastKospiIdx, pastKosdaqIdx, kospiStocks, kosdaqStocks, pastKospiStocks, pastKosdaqStocks, investors] = await Promise.all([
    fetchKospiIndexDaily(past),
    fetchKosdaqIndexDaily(past),
    fetchKospiDailyTrade(selectedToday),
    fetchKosdaqDailyTrade(selectedToday),
    fetchKospiDailyTrade(past),
    fetchKosdaqDailyTrade(past),
    fetchInvestorTrading(),
  ]);

  const todayIdx = [...todayKospiIdx, ...todayKosdaqIdx];
  const pastIdx = [...pastKospiIdx, ...pastKosdaqIdx];
  const todayStocks = [...kospiStocks, ...kosdaqStocks];
  const pastStocks = [...pastKospiStocks, ...pastKosdaqStocks];
  const stockSectorMap = buildStockSectorMap(todayStocks);
  const foreignMap = aggregateForeignConcentration(investors, stockSectorMap);

  if (todayIdx.length === 0) {
    const fallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      ['todayIdx empty — KRX index OpenAPI 응답 부재', `attempted=${attemptedTodayDates.join(',') || 'default'}`],
      'PARTIAL',
    );
    if (fallback) return fallback;
    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      reasons: [
        'todayIdx empty — KRX OpenAPI 응답 부재',
        `attempted=${attemptedTodayDates.join(',') || 'default'}`,
        `stock-daily fallback insufficient validSectorCount=0 < min=${getSectorEnergyMinValid()}`,
      ],
    };
  }

  const symmetry = validateIndexResponseSymmetry(todayIdx, pastIdx);
  if (!symmetry.valid && !isSectorEnergySymmetryDisabled()) {
    // ADR-0365: data-dbg 응답은 indexCode 없이 indexName만 정상 제공될 수 있다.
    // 먼저 indexName 기반 매칭을 시도하고, 부족하면 stock-daily 합성 fallback으로 강등한다.
    const nameDeltas = aggregateIndexDeltas(todayIdx, pastIdx);
    const nameBuilt = buildInputsFromDeltas(nameDeltas, foreignMap);
    const minValid = getSectorEnergyMinValid();
    if (nameBuilt.validSectorCount >= minValid) {
      return {
        inputs: nameBuilt.inputs,
        dataQuality: nameBuilt.validSectorCount === TOTAL_SECTOR_COUNT ? 'PARTIAL' : 'STALE',
        validSectorCount: nameBuilt.validSectorCount,
        totalSectorCount: TOTAL_SECTOR_COUNT,
        symmetryValidation: symmetry,
        reasons: [
          'symmetry validation failed but indexName fallback succeeded',
          ...symmetry.reasons,
          `ADR-0365 indexName matched sector energy validSectorCount=${nameBuilt.validSectorCount}/${TOTAL_SECTOR_COUNT}`,
        ],
      };
    }
    const fallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      ['symmetry validation failed', ...symmetry.reasons],
      'STALE',
    );
    if (fallback) {
      return { ...fallback, symmetryValidation: symmetry };
    }
    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: nameBuilt.validSectorCount,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      symmetryValidation: symmetry,
      reasons: [
        'symmetry validation failed',
        ...symmetry.reasons,
        `indexName fallback insufficient validSectorCount=${nameBuilt.validSectorCount} < min=${minValid}`,
      ],
    };
  }

  const deltas = aggregateIndexDeltas(todayIdx, pastIdx);
  const { inputs, validSectorCount } = buildInputsFromDeltas(deltas, foreignMap);
  const minValid = getSectorEnergyMinValid();
  if (validSectorCount < minValid) {
    return {
      inputs: [],
      dataQuality: 'STALE',
      validSectorCount,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      symmetryValidation: symmetry,
      reasons: [`validSectorCount=${validSectorCount} < min=${minValid}`],
    };
  }
  const dataQuality: SectorEnergyDataQuality = validSectorCount === TOTAL_SECTOR_COUNT ? 'OK' : 'PARTIAL';
  return {
    inputs,
    dataQuality,
    validSectorCount,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    symmetryValidation: symmetry,
    reasons: dataQuality === 'PARTIAL' ? [`PARTIAL: validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`] : [],
  };
}

export const SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48;
export function isSectorEnergyFallbackDisabled(): boolean { return process.env.SECTOR_ENERGY_FALLBACK_DISABLED === 'true'; }

export async function buildSectorEnergyInputsWithMetaWithFallback(): Promise<SectorEnergyBuildResult> {
  const result = await buildSectorEnergyInputsWithMetaRaw();
  if (isSectorEnergyFallbackDisabled()) return result;
  if (result.dataQuality !== 'FAILED') return result;
  let cached: { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
  try {
    const { loadMacroState } = await import('../persistence/macroStateRepo.js');
    cached = loadMacroState();
  } catch { cached = null; }
  if (!cached || !cached.sectorEnergyInputs || !cached.sectorEnergyInputsUpdatedAt) return result;
  const updatedAtMs = new Date(cached.sectorEnergyInputsUpdatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return result;
  const ageHours = (Date.now() - updatedAtMs) / (3600 * 1000);
  if (ageHours < 0 || ageHours >= SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS) return result;
  return {
    inputs: cached.sectorEnergyInputs,
    dataQuality: 'STALE',
    validSectorCount: cached.sectorEnergyInputs.length,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    reasons: [...result.reasons, `fallback to macroState cache (${ageHours.toFixed(1)}h old, ADR-0343)`],
  };
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache: { data: SectorEnergyInput[]; expiresAt: number } | null = null;
let _inflight: Promise<SectorEnergyInput[]> | null = null;

export async function getSectorEnergyInputs(force = false): Promise<SectorEnergyInput[]> {
  if (!force && _cache && _cache.expiresAt > Date.now()) return _cache.data;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const data = await buildSectorEnergyInputs();
      if (data.length > 0) _cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      return data;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function resetSectorEnergyCache(): void {
  _cache = null;
  _inflight = null;
}
