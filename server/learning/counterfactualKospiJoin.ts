/**
 * @responsibility Join counterfactual board rows with KOSPI daily closes to compute display-only excess-return columns.
 *
 * 2026-07-03 patch (ADR-530 scope guard — display-only, 판정/차단/임계/영속 0줄).
 * - KIS 단일 통로: fetchKisSectorIndexDaily('0001', from, to, 'LOW') 리포트당 1콜 (짧은 TTL 캐시).
 * - Yahoo fallback 절대 금지 (ADR-0561 — 신규 Yahoo call site 0). fetch null/실패 시 전체
 *   join UNAVAILABLE graceful — providerIssue ≠ marketSignal (불변식 #6). executionImpact=NONE.
 * - base 우선순위: row.kospiAtRecord(기록 시점 지수 레벨) ?? 기록일(직전 거래일) 종가 —
 *   baseSource 필드('AT_RECORD'|'DAY_CLOSE')로 명시 노출 (단위 함정 회귀 방지).
 */
import { fetchKisSectorIndexDaily } from '../clients/kisClient/query.js';

export type KospiJoinStatus = 'JOINED' | 'UNAVAILABLE';
export type KospiJoinBaseSource = 'AT_RECORD' | 'DAY_CLOSE';

/** 보드 행의 구조적 최소 셰이프 — counterfactualOutcomeBoard 순환 import 회피. */
export interface KospiJoinRowInput {
  recordedAt: string;
  kospiAtRecord: number | null;
  returnD5: number | null;
}

export interface KospiRowJoinD5 {
  /** D+5 거래일 KOSPI 수익률(%) — 시계열 끝을 넘으면(미성숙) null. */
  kospiReturnD5: number | null;
  baseSource: KospiJoinBaseSource | null;
}

export interface KospiJoinContext {
  status: KospiJoinStatus;
  /** UNAVAILABLE 사유 코드 (silent 금지 — 상태 필드로 노출). JOINED 면 'OK'. */
  reason: string;
  joinD5(row: KospiJoinRowInput): KospiRowJoinD5;
}

/** 밴드별 additive 집계 (양쪽 D5 존재 row 만). */
export interface KospiBandExcessD5 {
  avgExcessD5: number | null;
  /** stockD5 > kospiD5 비율 (0~1). */
  winVsMarketD5: number | null;
  kospiJoinedD5: number;
  /** 시장 상승창 bucket — kospiReturnD5 > 0 인 joined rows. */
  marketUpD5: KospiMarketBucketExcessD5;
  /** 시장 하락창 bucket — kospiReturnD5 <= 0 (경계 0 은 하락창 포함, 정의 고정). */
  marketDownD5: KospiMarketBucketExcessD5;
  /** 전체 joined 표본 excess 의 median (홀=중앙값, 짝=중앙 2개 평균) — 복권형 평균 왜곡 판별. */
  medianExcessD5: number | null;
}

/** 시장 국면 bucket 집계 (2026-07-03 patch 2 — display-only additive). */
export interface KospiMarketBucketExcessD5 {
  n: number;
  avgExcessD5: number | null;
  winVsMarketD5: number | null;
}

interface KospiBar {
  dateKey: string;
  close: number;
}

const KOSPI_COMPOSITE_ISCD = '0001';
/** from = 가장 오래된 recordedAt 날짜 − 여유 15일 (직전 거래일 base 확보 마진). */
const FROM_MARGIN_CALENDAR_DAYS = 15;
const FORWARD_TRADING_DAYS_D5 = 5;
/** 리포트당 1콜 원칙 — 동일 조회창 재빌드 시 재사용 (짧은 TTL). */
const KOSPI_BARS_CACHE_TTL_MS = 10 * 60_000;

let _barsCache: { key: string; expiresAt: number; bars: KospiBar[] } | null = null;

/** 테스트 결정성용 캐시 초기화 (override 교체 시 stale 방지). */
export function resetCounterfactualKospiJoinCacheForTest(): void {
  _barsCache = null;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function toYyyymmdd(dateKey10: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey10) ? dateKey10.replace(/-/g, '') : null;
}

function kstTodayYyyymmdd(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

function minusCalendarDaysYyyymmdd(dateKey10: string, days: number): string | null {
  const ms = Date.parse(`${dateKey10}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
}

function unavailable(reason: string): KospiJoinContext {
  return {
    status: 'UNAVAILABLE',
    reason,
    joinD5: () => ({ kospiReturnD5: null, baseSource: null }),
  };
}

/**
 * KOSPI 일봉 확보 — 성공 시에만 캐시 (실패는 다음 리포트에서 재시도).
 * fetchKisSectorIndexDaily 는 flag OFF/미인증/전송 실패 전부 null 반환 (기존 계약).
 */
async function loadKospiBars(from: string, to: string): Promise<KospiBar[] | null> {
  const key = `${from}:${to}`;
  if (_barsCache && _barsCache.key === key && _barsCache.expiresAt > Date.now()) {
    return _barsCache.bars;
  }
  let daily: Awaited<ReturnType<typeof fetchKisSectorIndexDaily>> = null;
  try {
    daily = await fetchKisSectorIndexDaily(KOSPI_COMPOSITE_ISCD, from, to, 'LOW');
  } catch (e) {
    // providerIssue ≠ marketSignal (불변식 #6) — 표시 전용 join 만 UNAVAILABLE, 사유 로그.
    console.warn(
      '[counterfactualKospiJoin] KOSPI daily fetch failed (display-only join → UNAVAILABLE):',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
  if (!daily) return null;
  const bars = daily.series
    .filter((row) => /^\d{8}$/.test(row.baseDate) && Number.isFinite(row.close) && row.close > 0)
    .map((row): KospiBar => ({ dateKey: row.baseDate, close: row.close }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  _barsCache = { key, expiresAt: Date.now() + KOSPI_BARS_CACHE_TTL_MS, bars };
  return bars;
}

/**
 * 대상 rows 로 조회창을 결정해 KOSPI 거래일 캘린더(bar 배열)를 확보하고 row→D5 join
 * 함수를 반환한다. rows 비어있으면 KIS 콜 0 (NO_ROWS).
 */
export async function buildCounterfactualKospiJoinContext(
  rows: readonly KospiJoinRowInput[],
  now: Date = new Date(),
): Promise<KospiJoinContext> {
  if (rows.length === 0) return unavailable('NO_ROWS');
  const oldestDateKey = rows.reduce<string | null>((oldest, row) => {
    const key = row.recordedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return oldest;
    return oldest === null || key < oldest ? key : oldest;
  }, null);
  if (oldestDateKey === null) return unavailable('INVALID_RECORDED_AT');
  const from = minusCalendarDaysYyyymmdd(oldestDateKey, FROM_MARGIN_CALENDAR_DAYS);
  if (from === null) return unavailable('INVALID_RECORDED_AT');
  const to = kstTodayYyyymmdd(now);
  const bars = await loadKospiBars(from, to);
  if (bars === null) return unavailable('KIS_SECTOR_INDEX_DAILY_UNAVAILABLE');
  if (bars.length === 0) return unavailable('EMPTY_SERIES');

  const joinD5 = (row: KospiJoinRowInput): KospiRowJoinD5 => {
    const recordedKey = toYyyymmdd(row.recordedAt.slice(0, 10));
    if (recordedKey === null) return { kospiReturnD5: null, baseSource: null };
    // bar index i — 기록일 정확 일치, 없으면 그 이전 최근 거래일 (bars 는 날짜 오름차순).
    let i = -1;
    for (let k = bars.length - 1; k >= 0; k -= 1) {
      if (bars[k].dateKey <= recordedKey) {
        i = k;
        break;
      }
    }
    if (i < 0) return { kospiReturnD5: null, baseSource: null };
    const target = bars[i + FORWARD_TRADING_DAYS_D5];
    if (!target) return { kospiReturnD5: null, baseSource: null }; // 미성숙 — 시계열 끝 초과
    const atRecord = row.kospiAtRecord;
    const useAtRecord = typeof atRecord === 'number' && Number.isFinite(atRecord) && atRecord > 0;
    const base = useAtRecord ? atRecord : bars[i].close;
    return {
      kospiReturnD5: round2((target.close / base - 1) * 100),
      baseSource: useAtRecord ? 'AT_RECORD' : 'DAY_CLOSE',
    };
  };

  return { status: 'JOINED', reason: 'OK', joinD5 };
}

interface JoinedD5Pair {
  stock: number;
  kospi: number;
}

function emptyMarketBucket(): KospiMarketBucketExcessD5 {
  return { n: 0, avgExcessD5: null, winVsMarketD5: null };
}

function bucketExcessD5(pairs: readonly JoinedD5Pair[]): KospiMarketBucketExcessD5 {
  if (pairs.length === 0) return emptyMarketBucket();
  const avgExcess = pairs.reduce((sum, p) => sum + (p.stock - p.kospi), 0) / pairs.length;
  const wins = pairs.filter((p) => p.stock > p.kospi).length;
  return {
    n: pairs.length,
    avgExcessD5: round2(avgExcess),
    winVsMarketD5: round2(wins / pairs.length),
  };
}

/** 표준 median — 홀수는 중앙값, 짝수는 중앙 2개 평균. 표본 0 이면 null. */
function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round2(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

/** 밴드 집계 — 양쪽(D5 stock/KOSPI) 존재 row 만 표본. 표본 0 이면 null (N/A 표기). */
export function computeBandKospiExcessD5(
  rows: readonly KospiJoinRowInput[],
  ctx: KospiJoinContext,
): KospiBandExcessD5 {
  const pairs: JoinedD5Pair[] = [];
  for (const row of rows) {
    const stock = row.returnD5;
    if (typeof stock !== 'number' || !Number.isFinite(stock)) continue;
    const kospi = ctx.joinD5(row).kospiReturnD5;
    if (kospi === null) continue;
    pairs.push({ stock, kospi });
  }
  if (pairs.length === 0) {
    return {
      avgExcessD5: null,
      winVsMarketD5: null,
      kospiJoinedD5: 0,
      marketUpD5: emptyMarketBucket(),
      marketDownD5: emptyMarketBucket(),
      medianExcessD5: null,
    };
  }
  const avgExcess = pairs.reduce((sum, p) => sum + (p.stock - p.kospi), 0) / pairs.length;
  const wins = pairs.filter((p) => p.stock > p.kospi).length;
  return {
    avgExcessD5: round2(avgExcess),
    winVsMarketD5: round2(wins / pairs.length),
    kospiJoinedD5: pairs.length,
    // 시장 국면 분해 — 경계 kospiReturnD5 = 0 은 하락창(marketDownD5) 포함 (정의 고정·테스트).
    marketUpD5: bucketExcessD5(pairs.filter((p) => p.kospi > 0)),
    marketDownD5: bucketExcessD5(pairs.filter((p) => p.kospi <= 0)),
    medianExcessD5: medianOf(pairs.map((p) => p.stock - p.kospi)),
  };
}

/** 밴드 객체에 additive 로만 결합 — 기존 필드 무변경 (board 쪽 diff 최소화 seam). */
export function attachKospiExcessD5ToBand<T extends object>(
  band: T,
  rows: readonly KospiJoinRowInput[],
  ctx: KospiJoinContext,
): T & KospiBandExcessD5 {
  return { ...band, ...computeBandKospiExcessD5(rows, ctx) };
}

/** board 레벨 시장 컨텍스트 — join 된 rows 의 kospiReturnD5 평균 + join 상태. */
export function computeBoardKospiContextD5(
  rows: readonly KospiJoinRowInput[],
  ctx: KospiJoinContext,
): { kospiAvgD5: number | null; kospiJoinStatus: KospiJoinStatus } {
  const values = rows
    .map((row) => ctx.joinD5(row).kospiReturnD5)
    .filter((value): value is number => value !== null);
  return {
    kospiAvgD5: values.length > 0 ? round2(values.reduce((sum, v) => sum + v, 0) / values.length) : null,
    kospiJoinStatus: ctx.status,
  };
}
