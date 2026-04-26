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
  fetchKospiDailyTrade,
  fetchKosdaqDailyTrade,
  type KrxIndexDailyRow,
  type KrxStockDailyRow,
} from './krxOpenApi.js';
import { fetchInvestorTrading, type KrxInvestorRow } from './krxClient.js';
import { safePctChange } from '../utils/safePctChange.js';

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

/** KST 기준 오늘에서 N영업일 전 YYYYMMDD. */
function businessDaysAgo(n: number): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const kst = new Date(utcMs + 9 * 60 * 60_000);
  // 오늘은 장 마감 후에야 KRX에 반영되므로 기준은 하루 전부터.
  kst.setUTCDate(kst.getUTCDate() - 1);
  let remaining = n;
  while (remaining > 0) {
    kst.setUTCDate(kst.getUTCDate() - 1);
    if (kst.getUTCDay() !== 0 && kst.getUTCDay() !== 6) remaining -= 1;
  }
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** (today 행, past 행) 쌍으로 return/volume 변화율을 집계. 평균값으로 12섹터로 축약. */
function aggregateIndexDeltas(
  todayRows: KrxIndexDailyRow[],
  pastRows: KrxIndexDailyRow[],
): Map<StrategicSector, { returns: number[]; volumes: number[] }> {
  const pastByCode = new Map<string, KrxIndexDailyRow>();
  for (const r of pastRows) {
    // indexCode가 있으면 우선, 없으면 indexName으로 매칭.
    const key = r.indexCode || r.indexName;
    if (key) pastByCode.set(key, r);
  }
  const bySector = new Map<StrategicSector, { returns: number[]; volumes: number[] }>();
  for (const t of todayRows) {
    const canonical = classifyIndex(t.indexName);
    if (!canonical) continue;
    const key = t.indexCode || t.indexName;
    const past = pastByCode.get(key);
    if (!past || past.close <= 0) continue;
    // ADR-0028: stale past data 시 sanity 위반은 스킵 (섹터 에너지 평균 왜곡 방지).
    const returnPct = safePctChange(t.close, past.close, {
      label: `sectorEnergy.return:${key}`,
    });
    if (returnPct === null) continue;
    const volumePct = past.volume > 0
      ? (safePctChange(t.volume, past.volume, {
          label: `sectorEnergy.volume:${key}`,
          sanityBoundPct: 1000, // 거래량은 ±1000% 까지 허용 (저거래일 → 고거래일 정상)
        }) ?? 0)
      : 0;
    const acc = bySector.get(canonical) ?? { returns: [], volumes: [] };
    acc.returns.push(returnPct);
    acc.volumes.push(volumePct);
    bySector.set(canonical, acc);
  }
  return bySector;
}

/**
 * 오늘 투자자별 거래실적(주식 단위) → 섹터별 외국인 집중도.
 * 외국인 순매수 수량만으로는 거래대금 대비 비율을 정확히 구하기 어렵다 — 주식 단위
 * 순매수 절대치를 합산해 섹터간 상대비교(min-max 0~100)로 대체 지표를 만든다.
 * 완벽한 4주 거래대금 비율은 아니지만, 섹터간 순위 신호로는 충분.
 */
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

/**
 * sectorEnergyEngine 가 그대로 소비할 수 있는 `SectorEnergyInput[]` 를 반환.
 * 모든 외부 호출 실패 시 빈 배열.
 */
export async function buildSectorEnergyInputs(): Promise<SectorEnergyInput[]> {
  const today = undefined; // krxOpenApi 가 최근 영업일 자동 선택
  const past = businessDaysAgo(20);

  const [todayKospiIdx, todayKosdaqIdx, pastKospiIdx, pastKosdaqIdx, kospiStocks, kosdaqStocks, investors] =
    await Promise.all([
      fetchKospiIndexDaily(today),
      fetchKosdaqIndexDaily(today),
      fetchKospiIndexDaily(past),
      fetchKosdaqIndexDaily(past),
      fetchKospiDailyTrade(today),
      fetchKosdaqDailyTrade(today),
      fetchInvestorTrading(),
    ]);

  const todayIdx = [...todayKospiIdx, ...todayKosdaqIdx];
  const pastIdx = [...pastKospiIdx, ...pastKosdaqIdx];
  if (todayIdx.length === 0) return [];

  const deltas = aggregateIndexDeltas(todayIdx, pastIdx);
  const stockSectorMap = buildStockSectorMap([...kospiStocks, ...kosdaqStocks]);
  const foreignMap = aggregateForeignConcentration(investors, stockSectorMap);

  const canonicalSectors: StrategicSector[] = [
    '반도체', '이차전지', '바이오/헬스케어', '인터넷/플랫폼',
    '자동차', '조선', '방산', '금융',
    '유통/소비재', '건설/부동산', '에너지/화학', '통신/유틸리티',
  ];

  const out: SectorEnergyInput[] = [];
  for (const sector of canonicalSectors) {
    const d = deltas.get(sector);
    const returns = d?.returns ?? [];
    const volumes = d?.volumes ?? [];
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
  return out;
}

// ── 캐시 ─────────────────────────────────────────────────────────────────────
// 장중 변동을 실시간 반영할 필요는 없으므로 30분 캐시. 동시 요청은 단일 Promise로 합친다.

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
