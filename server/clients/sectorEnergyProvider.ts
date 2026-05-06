// @responsibility sectorEnergyProvider 외부 클라이언트 모듈
/**
 * sectorEnergyProvider.ts — KRX 실데이터를 sectorEnergyEngine 입력으로 가공.
 *
 * sectorEnergyEngine.ts 는 순수 계산기(연료 없음). 이 모듈은 KRX Open API
 * (인증) + KRX 공개 엔드포인트에서 섹터별 return4w / volumeChangePct /
 * foreignConcentration 세 축을 뽑아 `SectorEnergyInput[]` 으로 변환한다.
 *
 * 설계 원칙:
 *   1. 호출 비용 최소화 — 20영업일 전/후 스냅샷 2회(+ 오늘 투자자별 1회)만 사용.
 *      (섹터별 풀 OHLCV 시리즈를 매번 40회 쿼리하지 않는다.)
 *   2. KRX 지수명 → 전략 12섹터 매핑을 하나의 테이블로 관리.
 *      미매칭 KRX 지수는 NEUTRAL 처리로 귀결되도록 0 기본값만 남긴다.
 *   3. 실패·권한·타임아웃 전부 빈 배열 — 상위 엔진이 `summary: '입력 없음'` 으로 처리.
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

/** 전략 레벨 12섹터 — sectorEnergyEngine 의 계절성 테이블과 동일한 키. */
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

/**
 * KRX 지수명 → 전략 12섹터.
 * KRX 는 "KOSPI 전기전자", "KOSDAQ IT S/W & SVC" 처럼 접두사·하위 분류가 혼재한다.
 * 대소문자·공백 없이 포함 여부(includes)로 매칭한다. 한 KRX 지수가 여러 후보에
 * 걸리면 선언 순서대로 첫 매칭을 채택 — 더 구체적인 키워드를 앞에 둔다.
 */
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

/** 개별 종목의 KRX 섹터 필드 → 전략 12섹터 (없으면 null). */
function classifyStockSector(stockSector: string): StrategicSector | null {
  if (!stockSector) return null;
  for (const [pattern, canonical] of KRX_INDEX_TO_SECTOR) {
    if (pattern.test(stockSector)) return canonical;
  }
  return null;
}

/** KRX 지수행(indexName) → 전략 12섹터 (없으면 null). */
function classifyIndex(indexName: string): StrategicSector | null {
  if (!indexName) return null;
  for (const [pattern, canonical] of KRX_INDEX_TO_SECTOR) {
    if (pattern.test(indexName)) return canonical;
  }
  return null;
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

/** KST 기준 오늘에서 N KRX 거래일 전 YYYYMMDD. */
function businessDaysAgo(n: number): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  // 오늘은 장 마감 후에야 KRX에 반영되므로 기준은 하루 전부터.
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

/**
 * close 자릿수가 ±10배 를 초과해 어긋났을 때 매칭 미스 의심으로 skip.
 * (sanity ±90% 보다 보수적인 1차 방어선 — KRX 응답에서 indexCode 체계가
 * today/past 사이 비대칭일 때 다른 섹터끼리 비교되는 회귀를 차단.)
 */
const SECTOR_CLOSE_RATIO_MAX = 10;
const SECTOR_CLOSE_RATIO_MIN = 0.1;

/** ADR-0122 (사용자 §4): 12 섹터 중 returns.length>0 섹터 최소 임계 — 미달 시 결과 폐기. */
export const SECTOR_ENERGY_MIN_VALID_DEFAULT = 8;

/** ADR-0122 (사용자 §1): today/past 응답 indexCode 충실도 임계 (90% 이상). */
export const SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD = 0.9;

/** sectorEnergy 결과 신뢰도 4값 union (사용자 §7). */
export type SectorEnergyDataQuality =
  | 'OK'
  | 'PARTIAL'
  | 'STALE'
  | 'FAILED';

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

  const todayCodeCount = todayRows.filter((r) => Boolean(r.indexCode)).length;
  const pastCodeCount = pastRows.filter((r) => Boolean(r.indexCode)).length;
  const todayCodeFillRatio = todayCodeCount / todayRows.length;
  const pastCodeFillRatio = pastCodeCount / pastRows.length;

  if (todayCodeFillRatio < SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD) {
    reasons.push(
      `today indexCode 충실도 ${(todayCodeFillRatio * 100).toFixed(1)}% < ` +
      `${(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD * 100).toFixed(0)}%`,
    );
  }
  if (pastCodeFillRatio < SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD) {
    reasons.push(
      `past indexCode 충실도 ${(pastCodeFillRatio * 100).toFixed(1)}% < ` +
      `${(SECTOR_ENERGY_INDEX_CODE_FILL_THRESHOLD * 100).toFixed(0)}%`,
    );
  }

  return {
    valid: reasons.length === 0,
    todayCodeFillRatio,
    pastCodeFillRatio,
    reasons,
  };
}

export function isSectorEnergySymmetryDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SYMMETRY_DISABLED === 'true';
}
export function isSectorEnergyIndexNameFallbackEnabled(): boolean {
  return process.env.SECTOR_ENERGY_INDEX_NAME_FALLBACK === 'true';
}
export function getSectorEnergyMinValid(): number {
  const env = Number(process.env.SECTOR_ENERGY_MIN_VALID);
  if (Number.isFinite(env) && env > 0 && env <= 12) return env;
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
      if (!t.indexCode) {
        past = pastByName.get(t.indexName);
        if (past) matchKind = 'name';
      }
    }
    if (!past || past.close <= 0 || matchKind === null) continue;

    const ratio = t.close > 0 ? t.close / past.close : 0;
    if (!Number.isFinite(ratio) || ratio > SECTOR_CLOSE_RATIO_MAX || ratio < SECTOR_CLOSE_RATIO_MIN) {
      const tKey = t.indexCode || t.indexName || '?';
      const pKey = past.indexCode || past.indexName || '?';
      console.warn(
        `[sectorEnergy:diag] 자릿수 격차 ${ratio.toFixed(3)}x — skip "${t.indexName}"` +
        ` (today close=${t.close}@${t.baseDate} ${matchKind}=${tKey}` +
        ` ↔ past close=${past.close}@${past.baseDate} ${pKey})`,
      );
      continue;
    }

    if (t.baseDate && past.baseDate && t.baseDate === past.baseDate) {
      console.warn(
        `[sectorEnergy:diag] today/past baseDate 동일 ${t.baseDate} — skip "${t.indexName}"`,
      );
      continue;
    }

    const labelKey = t.indexCode || t.indexName;
    const returnPct = safePctChange(t.close, past.close, {
      label: `sectorEnergy.return:${labelKey}`,
    });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(t.volume, past.volume, {
          label: `sectorEnergy.volume:${labelKey}`,
          sanityBoundPct: 1000,
        }) ?? 0)
      : 0;
    const acc = bySector.get(canonical) ?? { returns: [], volumes: [] };
    acc.returns.push(returnPct);
    acc.volumes.push(volumePct);
    bySector.set(canonical, acc);
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
    const prev = rawBySector.get(canonical) ?? 0;
    rawBySector.set(canonical, prev + row.foreignNetBuy);
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
    const canonical = classifyStockSector(s.sector);
    if (canonical) out.set(s.code, canonical);
  }
  return out;
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
  const result = await buildSectorEnergyInputsWithMetaWithFallback();
  return result.inputs;
}

export async function buildSectorEnergyInputsWithMeta(): Promise<SectorEnergyBuildResult> {
  const todayCandidates: Array<string | undefined> = [undefined, ...recentBusinessDaysKst(5)];
  const past = businessDaysAgo(20);

  let selectedToday: string | undefined;
  let todayKospiIdx: KrxIndexDailyRow[] = [];
  let todayKosdaqIdx: KrxIndexDailyRow[] = [];
  const attemptedTodayDates: string[] = [];
  for (const candidate of todayCandidates) {
    if (candidate) attemptedTodayDates.push(candidate);
    const [kospiIdx, kosdaqIdx] = await Promise.all([
      fetchKospiIndexDaily(candidate),
      fetchKosdaqIndexDaily(candidate),
    ]);
    if (kospiIdx.length + kosdaqIdx.length > 0) {
      selectedToday = candidate;
      todayKospiIdx = kospiIdx;
      todayKosdaqIdx = kosdaqIdx;
      break;
    }
  }

  const [pastKospiIdx, pastKosdaqIdx, kospiStocks, kosdaqStocks, investors] =
    await Promise.all([
      fetchKospiIndexDaily(past),
      fetchKosdaqIndexDaily(past),
      fetchKospiDailyTrade(selectedToday),
      fetchKosdaqDailyTrade(selectedToday),
      fetchInvestorTrading(),
    ]);

  const todayIdx = [...todayKospiIdx, ...todayKosdaqIdx];
  const pastIdx = [...pastKospiIdx, ...pastKosdaqIdx];
  if (todayIdx.length === 0) {
    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: 12,
      reasons: [
        'todayIdx empty — KRX OpenAPI 응답 부재',
        `attempted=${attemptedTodayDates.join(',') || 'default'}`,
      ],
    };
  }

  const symmetry = validateIndexResponseSymmetry(todayIdx, pastIdx);
  if (!symmetry.valid && !isSectorEnergySymmetryDisabled()) {
    console.warn(
      `[sectorEnergy:diag] ADR-0122 symmetry 검증 실패 — 응답 페어 폐기: ` +
      symmetry.reasons.join('; '),
    );
    return {
      inputs: [],
      dataQuality: 'FAILED',
      validSectorCount: 0,
      totalSectorCount: 12,
      symmetryValidation: symmetry,
      reasons: ['symmetry validation failed', ...symmetry.reasons],
    };
  }

  const deltas = aggregateIndexDeltas(todayIdx, pastIdx);
  const stockSectorMap = buildStockSectorMap([...kospiStocks, ...kosdaqStocks]);
  const foreignMap = aggregateForeignConcentration(investors, stockSectorMap);

  const canonicalSectors: StrategicSector[] = [
    '반도체', '이차전지', '바이오/헬스케어', '인터넷/플랫폼',
    '자동차', '조선', '방산', '금융',
    '유통/소비재', '건설/부동산', '에너지/화학', '통신/유틸리티',
  ];

  const out: SectorEnergyInput[] = [];
  let validSectorCount = 0;
  for (const sector of canonicalSectors) {
    const d = deltas.get(sector);
    const returns = d?.returns ?? [];
    const volumes = d?.volumes ?? [];
    if (returns.length > 0) validSectorCount++;
    const avg = (xs: number[]): number =>
      xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    const return4w = avg(returns);
    const volumeChangePct = avg(volumes);
    const foreignConcentration = foreignMap.get(sector) ?? 0;
    out.push({
      name: sector,
      return4w: Number(return4w.toFixed(2)),
      volumeChangePct: Number(volumeChangePct.toFixed(2)),
      foreignConcentration: Number(foreignConcentration.toFixed(1)),
    });
  }

  const minValid = getSectorEnergyMinValid();
  const reasons: string[] = [];
  if (validSectorCount < minValid) {
    console.warn(
      `[sectorEnergy:diag] ADR-0122 유효 섹터 ${validSectorCount}/12 < 임계 ${minValid} — 결과 폐기 (STALE).`,
    );
    return {
      inputs: [],
      dataQuality: 'STALE',
      validSectorCount,
      totalSectorCount: 12,
      symmetryValidation: symmetry,
      reasons: [`validSectorCount=${validSectorCount} < min=${minValid}`],
    };
  }

  const dataQuality: SectorEnergyDataQuality = validSectorCount === 12 ? 'OK' : 'PARTIAL';
  if (dataQuality === 'PARTIAL') {
    reasons.push(`PARTIAL: validSectorCount=${validSectorCount}/12`);
  }

  return {
    inputs: out,
    dataQuality,
    validSectorCount,
    totalSectorCount,
    symmetryValidation: symmetry,
    reasons,
  };
}

export const SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48;

export function isSectorEnergyFallbackDisabled(): boolean {
  return process.env.SECTOR_ENERGY_FALLBACK_DISABLED === 'true';
}

export async function buildSectorEnergyInputsWithMetaWithFallback(): Promise<SectorEnergyBuildResult> {
  const result = await buildSectorEnergyInputsWithMeta();
  if (isSectorEnergyFallbackDisabled()) return result;
  if (result.dataQuality !== 'FAILED') return result;
  let cached: { sectorEnergyInputs?: SectorEnergyInput[]; sectorEnergyInputsUpdatedAt?: string } | null;
  try {
    const { loadMacroState } = await import('../persistence/macroStateRepo.js');
    cached = loadMacroState();
  } catch {
    cached = null;
  }
  if (!cached || !cached.sectorEnergyInputs || !cached.sectorEnergyInputsUpdatedAt) {
    return result;
  }
  const updatedAtMs = new Date(cached.sectorEnergyInputsUpdatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return result;
  const ageHours = (Date.now() - updatedAtMs) / (3600 * 1000);
  if (ageHours < 0 || ageHours >= SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS) return result;
  console.warn(
    `[sectorEnergy] FAILED — macroState 캐시 fallback (${ageHours.toFixed(1)}h 전 데이터, ADR-0343)`,
  );
  return {
    inputs: cached.sectorEnergyInputs,
    dataQuality: 'STALE',
    validSectorCount: cached.sectorEnergyInputs.length,
    totalSectorCount: 12,
    reasons: [
      ...result.reasons,
      `fallback to macroState cache (${ageHours.toFixed(1)}h old)`,
    ],
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
      if (data.length > 0) {
        _cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
      }
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
