// @responsibility sectorEnergyProvider 외부 클라이언트 모듈
/**
 * sectorEnergyProvider.ts — KRX 실데이터를 sectorEnergyEngine 입력으로 가공.
 *
 * ADR-0343: public meta builder itself is fallback-aware.
 * ADR-0362: KRX index daily 가 empty 일 때 종목별 KRX 일별거래 + sector map 으로 합성.
 * ADR-0365: data-dbg index rows 는 IDX_IND_CD 없이 IDX_NM 만 올 수 있다.
 * ADR-0369: indexName fallback 은 기본 OFF. 서로 다른 KRX 지수를 이름/정규식으로 잘못
 * 매칭하면 -100%~-500% 수익률과 1000%+ 거래량 이상치가 발생한다. 기본 경로는
 * stock-daily synthetic sectorEnergy 이며, indexName fallback 은 ENV opt-in 전용이다.
 * ADR-0370 (Phase 1): RETURN_SANITY_BOUND_PCT default 90 → 30 강화 (한국 섹터 일일
 * 변화 ±15%·주간 ±30% 초과는 데이터 결함 의심). indexName fallback ENV 활성 시
 * 부팅 1회 console.warn. aggregateIndexDeltas 키 합성 시 indexCode 우선 + indexName
 * 단독 매칭은 fallback OFF 시 호출 0건 보장. 동일 key 중복 silent overwrite 금지
 * (console.warn skip).
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

// ADR-0370: default 90 → 30. 한국 섹터 일일 ±15% / 주간 ±30% 가 정상 상한.
// 30 초과는 데이터 결함 의심 (자릿수 격차, 액면병합/분할, 잘못된 indexName 매칭 등).
// 회귀 발견 시 SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT=90 ENV 1줄로 즉시 롤백.
export const RETURN_SANITY_BOUND_PCT_DEFAULT = 30;
const RETURN_SANITY_BOUND_PCT = Number(
  process.env.SECTOR_ENERGY_RETURN_SANITY_BOUND_PCT ?? String(RETURN_SANITY_BOUND_PCT_DEFAULT),
);
const VOLUME_SANITY_BOUND_PCT = Number(process.env.SECTOR_ENERGY_VOLUME_SANITY_BOUND_PCT ?? '1000');
export const SECTOR_ENERGY_MIN_VALID_DEFAULT = 8;
export const SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD = 0.9;
// ADR-0396 (= 사용자 명시 ADR-0371): 5단계 union 격상 — DEGRADED 신규 (심각한 부족, 보조 신호로만).
export type SectorEnergyDataQuality = 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';

export interface SymmetryValidationResult {
  valid: boolean;
  todayCodeFillRatio: number;
  pastCodeFillRatio: number;
  reasons: string[];
}

export interface SectorEnergyBuildResult {
  inputs: SectorEnergyInput[];
  dataQuality: SectorEnergyDataQuality;
  validSectorCount: number;
  totalSectorCount: number;
  symmetryValidation?: SymmetryValidationResult;
  reasons: string[];
}

function classifySector(label: string): StrategicSector | null {
  if (!label) return null;
  for (const [pattern, canonical] of KRX_INDEX_TO_SECTOR) {
    if (pattern.test(label)) return canonical;
  }
  return null;
}

function classifyIndex(indexName: string): StrategicSector | null {
  return classifySector(indexName);
}

function resolveStockSector(row: KrxStockDailyRow): StrategicSector | null {
  return classifySector(row.sector) ?? classifySector(getSectorByCode(row.code));
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

export function isSectorEnergySymmetryDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SYMMETRY_DISABLED === 'true';
}

export function isSectorEnergyIndexNameFallbackEnabled(): boolean {
  // ADR-0369: unsafe fallback is opt-in only.
  // ADR-0370: 정확 비교 (=== 'true') 의무 (ADR-0157 정합).
  return process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK === 'true';
}

// ADR-0370: 부팅 시점 1회 unsafe fallback 활성 경고. 모듈 로드 시 1회만 실행.
// ENV 정확 비교 (=== 'true') — 'TRUE'/'1'/'yes' 거부 (ADR-0157 정합).
let _indexNameFallbackWarningEmitted = false;
export function emitIndexNameFallbackWarningIfEnabled(): boolean {
  if (_indexNameFallbackWarningEmitted) return false;
  if (process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK !== 'true') return false;
  console.warn(
    '[SECTOR_ENERGY] unsafe indexName fallback is enabled. ' +
      'This may produce unreliable sector deltas (ADR-0369/0370).',
  );
  _indexNameFallbackWarningEmitted = true;
  return true;
}
export function __resetIndexNameFallbackWarningForTests(): void {
  _indexNameFallbackWarningEmitted = false;
}
// 모듈 로드 시 1회 실행 (부팅 시점 진단).
emitIndexNameFallbackWarningIfEnabled();

export function getSectorEnergyMinValid(): number {
  const env = Number(process.env.SECTOR_ENERGY_MIN_VALID);
  if (Number.isFinite(env) && env > 0 && env <= TOTAL_SECTOR_COUNT) return env;
  return SECTOR_ENERGY_MIN_VALID_DEFAULT;
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

function pushDelta(
  bySector: Map<StrategicSector, { returns: number[]; volumes: number[] }>,
  sector: StrategicSector,
  returnPct: number,
  volumePct: number,
): void {
  // ADR-0370: sanity bound default 90 → 30. 초과 시 진단 로그 + skip.
  if (!Number.isFinite(returnPct)) return;
  if (Math.abs(returnPct) > RETURN_SANITY_BOUND_PCT) {
    console.warn(
      `[SectorEnergy] sanity-violation pct=${returnPct.toFixed(2)}% sector=${sector} ` +
        `bound=${RETURN_SANITY_BOUND_PCT}% (ADR-0370)`,
    );
    return;
  }
  if (!Number.isFinite(volumePct) || Math.abs(volumePct) > VOLUME_SANITY_BOUND_PCT) return;
  const acc = bySector.get(sector) ?? { returns: [], volumes: [] };
  acc.returns.push(returnPct);
  acc.volumes.push(volumePct);
  bySector.set(sector, acc);
}

/**
 * ADR-0370: composite key (`${market}:${indexCode|indexName}`) 우선순위.
 * 1) indexCode 있으면 → `${market}:${indexCode}` (정확 매칭, 동일 indexName 다른 시장 분리)
 * 2) 그 외 → `${market}:${indexName}` (indexName fallback, ENV 활성 시에만 사용)
 *
 * KOSPI:반도체 와 KOSDAQ:반도체 같은 동일 이름 다른 시장 sub-index 의 silent overwrite
 * 영구 차단. KrxIndexDailyRow.market 필드 부재 시 빈 문자열 — 단일 시장 호환.
 */
function indexRowMarket(row: KrxIndexDailyRow): string {
  // KrxIndexDailyRow 의 market 필드는 옵셔널 — 부재 시 빈 문자열 (호환).
  // ts-ignore: 외부 타입 변경 없이 옵셔널 access.
  const m = (row as unknown as { market?: string }).market;
  return typeof m === 'string' ? m : '';
}

// ADR-0370: indexRowKey 헬퍼 — composite key 합성 SSOT (외부 reference 가능).
// `${market}:code:${indexCode}` 우선 / useNameFallback=true 시 `${market}:name:${indexName}` fallback.
export function indexRowKey(row: KrxIndexDailyRow, useNameFallback: boolean): string | null {
  const market = indexRowMarket(row);
  if (row.indexCode) return `${market}:code:${row.indexCode}`;
  if (useNameFallback && row.indexName) return `${market}:name:${row.indexName}`;
  return null;
}

export function aggregateIndexDeltas(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
): Map<StrategicSector, { returns: number[]; volumes: number[] }> {
  const useNameFallback = isSectorEnergyIndexNameFallbackEnabled();

  // ADR-0370: composite key 합성. 동일 key 중복 시 silent overwrite 금지 → console.warn skip.
  // 두 layer 분리:
  //  (1) pastByCode = `${market}:code:${indexCode}` — 정확 매칭 (KOSPI vs KOSDAQ 분리)
  //  (2) pastByName = `${market}:name:${indexName}` — useNameFallback=true 시에만 활성
  const pastByCode = new Map<string, KrxIndexDailyRow>();
  const pastByName = new Map<string, KrxIndexDailyRow>();
  for (const r of pastRows) {
    const market = indexRowMarket(r);
    if (r.indexCode) {
      const codeKey = `${market}:code:${r.indexCode}`;
      if (pastByCode.has(codeKey)) {
        console.warn(
          `[SectorEnergy] duplicate past key=${codeKey} skipped (ADR-0370). ` +
            `existing.close=${pastByCode.get(codeKey)!.close} duplicate.close=${r.close}`,
        );
      } else {
        pastByCode.set(codeKey, r);
      }
    }
    if (useNameFallback && r.indexName) {
      const nameKey = `${market}:name:${r.indexName}`;
      if (!pastByName.has(nameKey)) pastByName.set(nameKey, r);
      // pastByName 중복은 silent (fallback 자체가 unsafe opt-in 이라 첫 번째만 사용)
    }
  }

  const bySector = new Map<StrategicSector, { returns: number[]; volumes: number[] }>();
  for (const t of todayRows) {
    const sector = classifyIndex(t.indexName);
    if (!sector) continue;

    // ADR-0370: 우선순위 SSOT
    //  1) today.indexCode 있으면 → pastByCode (KOSPI vs KOSDAQ 분리, default 경로)
    //  2) useNameFallback=true 이고 매칭 실패 시 → pastByName (회귀 분석 ENV opt-in)
    //  useNameFallback=false (default) 시 indexName fallback 경로 호출 0건 보장.
    const market = indexRowMarket(t);
    let past: KrxIndexDailyRow | undefined;
    if (t.indexCode) {
      past = pastByCode.get(`${market}:code:${t.indexCode}`);
    }
    if (!past && useNameFallback && t.indexName) {
      past = pastByName.get(`${market}:name:${t.indexName}`);
    }

    if (!past || past.close <= 0 || t.close <= 0) continue;
    if (t.baseDate && past.baseDate && t.baseDate === past.baseDate) continue;

    const labelKey = t.indexCode || t.indexName;
    const returnPct = safePctChange(t.close, past.close, { label: `sectorEnergy.return:${labelKey}` });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(t.volume, past.volume, { label: `sectorEnergy.volume:${labelKey}`, sanityBoundPct: VOLUME_SANITY_BOUND_PCT }) ?? 0)
      : 0;
    pushDelta(bySector, sector, returnPct, volumePct);
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
      ? (safePctChange(today.volume, past.volume, { label: `sectorEnergy.stockVolume:${today.code}`, sanityBoundPct: VOLUME_SANITY_BOUND_PCT }) ?? 0)
      : 0;
    pushDelta(bySector, sector, returnPct, volumePct);
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
  for (const [sector, v] of rawBySector) normalized.set(sector, ((v - min) / (max - min)) * 100);
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
  const avg = (xs: number[]): number => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  for (const sector of CANONICAL_SECTORS) {
    const d = deltas.get(sector);
    const returns = d?.returns ?? [];
    const volumes = d?.volumes ?? [];
    if (returns.length > 0) validSectorCount++;
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
  if (validSectorCount < minValid) return null;
  return {
    inputs,
    dataQuality: validSectorCount === TOTAL_SECTOR_COUNT ? qualityIfComplete : 'STALE',
    validSectorCount,
    totalSectorCount: TOTAL_SECTOR_COUNT,
    reasons: [
      ...prefixReasons,
      `ADR-0369 stock-daily synthetic sector energy validSectorCount=${validSectorCount}/${TOTAL_SECTOR_COUNT}`,
    ],
  };
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
      reasons: ['todayIdx empty — KRX OpenAPI 응답 부재', `attempted=${attemptedTodayDates.join(',') || 'default'}`],
    };
  }

  const symmetry = validateIndexResponseSymmetry(todayIdx, pastIdx);
  if (!symmetry.valid && !isSectorEnergySymmetryDisabled()) {
    const stockFallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      ['symmetry validation failed — indexCode missing, stock-daily fallback preferred', ...symmetry.reasons],
      'STALE',
    );
    if (stockFallback) return { ...stockFallback, symmetryValidation: symmetry };

    if (isSectorEnergyIndexNameFallbackEnabled()) {
      const nameDeltas = aggregateIndexDeltas(todayIdx, pastIdx);
      const nameBuilt = buildInputsFromDeltas(nameDeltas, foreignMap);
      if (nameBuilt.validSectorCount >= getSectorEnergyMinValid()) {
        return {
          inputs: nameBuilt.inputs,
          dataQuality: nameBuilt.validSectorCount === TOTAL_SECTOR_COUNT ? 'PARTIAL' : 'STALE',
          validSectorCount: nameBuilt.validSectorCount,
          totalSectorCount: TOTAL_SECTOR_COUNT,
          symmetryValidation: symmetry,
          reasons: [
            'symmetry validation failed but explicit indexName fallback succeeded',
            ...symmetry.reasons,
            `ADR-0369 indexName fallback opt-in validSectorCount=${nameBuilt.validSectorCount}/${TOTAL_SECTOR_COUNT}`,
          ],
        };
      }
    }

    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: TOTAL_SECTOR_COUNT,
      symmetryValidation: symmetry,
      reasons: ['symmetry validation failed', ...symmetry.reasons, 'stock-daily fallback insufficient and indexName fallback disabled'],
    };
  }

  const deltas = aggregateIndexDeltas(todayIdx, pastIdx);
  const { inputs, validSectorCount } = buildInputsFromDeltas(deltas, foreignMap);
  const minValid = getSectorEnergyMinValid();
  if (validSectorCount < minValid) {
    const fallback = buildStockDailyFallbackResult(
      todayStocks,
      pastStocks,
      foreignMap,
      [`index-code sector validSectorCount=${validSectorCount} < min=${minValid}`],
      'STALE',
    );
    if (fallback) return { ...fallback, symmetryValidation: symmetry };
    return { inputs: [], dataQuality: 'STALE', validSectorCount, totalSectorCount: TOTAL_SECTOR_COUNT, symmetryValidation: symmetry, reasons: [`validSectorCount=${validSectorCount} < min=${minValid}`] };
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

/**
 * ADR-0397 (= 사용자 명시 ADR-0372): Yahoo ETF L4 fallback degradation 정책 SSOT.
 *
 * Yahoo ETF 는 KRX 섹터지수의 *원천 대체재 아님* — L4 보험 레이어.
 * 사용자 명시 절대 변경 금지 정책:
 *   - confidence × 0.5 (호출자 측 합성 후 한 번 더 강등)
 *   - allowStrongBuy=false (ADR-0398 STRONG_BUY 게이트 입력)
 *   - dataQuality='DEGRADED' 강제 (5-state union, ADR-0396)
 *
 * 한계 사유 (ADR-0397 §"Yahoo ETF 한계"):
 *   1. volumeChangePct=0 (Yahoo ETF 는 KRX 섹터 거래량 미제공)
 *   2. foreignConcentration=0 (외인 수급 미제공)
 *   3. 4주 수익률 단일 축 의존 위험
 */
function applyYahooEtfDegradation(yahooResult: SectorEnergyBuildResult): SectorEnergyBuildResult {
  return {
    ...yahooResult,
    dataQuality: 'DEGRADED',
    reasons: [
      ...yahooResult.reasons,
      'L4 Yahoo ETF fallback (ADR-0397) — confidence × 0.5, allowStrongBuy=false, dataQuality=DEGRADED 강제',
    ],
  };
}

export async function buildSectorEnergyInputsWithMetaWithFallback(): Promise<SectorEnergyBuildResult> {
  const result = await buildSectorEnergyInputsWithMetaRaw();
  if (isSectorEnergyFallbackDisabled()) return result;
  if (result.dataQuality !== 'FAILED') return result;

  // L3: macroState cache (48h, ADR-0343) — 우선 시도
  let cached: { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
  try {
    const { loadMacroState } = await import('../persistence/macroStateRepo.js');
    cached = loadMacroState();
  } catch { cached = null; }

  if (cached?.sectorEnergyInputs && cached.sectorEnergyInputsUpdatedAt) {
    const updatedAtMs = new Date(cached.sectorEnergyInputsUpdatedAt).getTime();
    if (Number.isFinite(updatedAtMs)) {
      const ageHours = (Date.now() - updatedAtMs) / (3600 * 1000);
      if (ageHours >= 0 && ageHours < SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS) {
        return {
          inputs: cached.sectorEnergyInputs,
          dataQuality: 'STALE',
          validSectorCount: cached.sectorEnergyInputs.length,
          totalSectorCount: TOTAL_SECTOR_COUNT,
          reasons: [...result.reasons, `fallback to macroState cache (${ageHours.toFixed(1)}h old, ADR-0343)`],
        };
      }
    }
  }

  // L4: Yahoo ETF fallback (ADR-0397, 본 PR — 신규).
  // 진입 조건: KRX 실패 (L1+L2) + macroState cache 부재/EXPIRED (L3) 모두 충족 시.
  // 호출 순서 SSOT 절대 변경 금지 — L1 → L2 → L3 → L4.
  if (!isSectorEnergyEtfFallbackDisabled()) {
    try {
      const { buildSectorEnergyFromYahooETF } = await import('./sectorEnergyFallbackProvider.js');
      const yahoo = await buildSectorEnergyFromYahooETF();
      if (yahoo.dataQuality !== 'FAILED' && yahoo.validSectorCount > 0) {
        return applyYahooEtfDegradation(yahoo);
      }
    } catch {
      // L4 자체 throw 시 L1~L4 모두 실패 처리 (본 result 그대로 반환)
    }
  }

  return result; // L1~L4 모두 실패 시 FAILED 그대로
}

/**
 * ADR-0397: Yahoo ETF L4 fallback ENV 헬퍼 SSOT.
 * 정확 비교 (=== 'true') ADR-0157 의무. default OFF — 활성화 시 즉시 L4 비활성.
 *
 * 호출자 측 inline ENV 검사 0건 — SSOT 위임 (ADR-0185~0189 정합).
 *
 * NOTE: ADR-0364 의 sectorEnergyFallbackProvider 는 자체 ENV
 * `SECTOR_ENERGY_ETF_FALLBACK_DISABLED` 도 가짐 — 본 함수와 동일한 SSOT 통합.
 */
export function isSectorEnergyEtfFallbackDisabled(): boolean {
  // ADR-0364 동일 ENV 변수명 정합 — sectorEnergyFallbackProvider.isSectorEnergyEtfFallbackDisabled() 와 동일.
  // 사용자 명시 ADR-0372 ENV `SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED` 도 함께 우회 (alias).
  if (process.env.SECTOR_ENERGY_YAHOO_ETF_FALLBACK_DISABLED === 'true') return true;
  return process.env.SECTOR_ENERGY_ETF_FALLBACK_DISABLED === 'true';
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
