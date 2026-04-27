// @responsibility kisChartDataFetcher 스크리너 모듈
/**
 * kisChartDataFetcher.ts — KIS API 기반 월봉/주봉 차트 데이터 조회
 *
 * 아이디어 9: Yahoo Finance의 한국 주식 월봉/주봉 데이터 부족 문제 해결
 *
 * KIS API FHKST03010100 (국내주식기간별시세) 엔드포인트를 활용하여
 * 월봉/주봉 OHLCV 데이터를 직접 조회한다.
 *
 * Yahoo Finance 다운샘플링(일봉→월봉/주봉) 대비 장점:
 *   - 정확한 월봉/주봉 데이터 (실제 거래소 기준)
 *   - 한국 주식 장기 히스토리 안정적 제공
 *   - 데이터 누락/null 값 문제 없음
 *
 * MTAS 구성 요소 중 월봉/주봉 지표를 KIS 데이터로 대체:
 *   - monthlyAboveEMA12: 월봉 종가 > 12개월 EMA
 *   - monthlyEMARising:  12개월 EMA 우상향
 *   - weeklyAboveCloud:  주봉 일목균형표 구름대 위
 *   - weeklyLaggingSpanUp: 주봉 후행스팬 상향
 */

import { realDataKisGet, HAS_REAL_DATA_CLIENT } from '../clients/kisClient.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface KisChartCandle {
  date: string;     // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KisMTASData {
  monthlyAboveEMA12: boolean;
  monthlyEMARising: boolean;
  weeklyAboveCloud: boolean;
  weeklyLaggingSpanUp: boolean;
  dataAvailable: boolean;       // KIS 데이터 조회 성공 여부
  monthlyCandleCount: number;   // 조회된 월봉 수
  weeklyCandleCount: number;    // 조회된 주봉 수
}

// ── 유틸: EMA 계산 ───────────────────────────────────────────────────────────

function calcEMAArr(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

// ── KIS API 호출: 기간별 시세 조회 ──────────────────────────────────────────

/**
 * KIS FHKST03010100 — 국내주식기간별시세(일/주/월별) 조회.
 *
 * @param code    종목코드 6자리 (e.g. '005930')
 * @param period  'D'=일봉 | 'W'=주봉 | 'M'=월봉
 * @param startDate  조회 시작일 YYYYMMDD
 * @param endDate    조회 종료일 YYYYMMDD
 * @returns 캔들 배열 (오래된 순서: 과거 → 최근)
 */
export async function fetchKisChartData(
  code: string,
  period: 'D' | 'W' | 'M',
  startDate: string,
  endDate: string,
): Promise<KisChartCandle[]> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return [];

  try {
    const data = await realDataKisGet(
      'FHKST03010100',
      '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: code.padStart(6, '0'),
        FID_INPUT_DATE_1: startDate,
        FID_INPUT_DATE_2: endDate,
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: '0',  // 수정주가 반영
      },
    );

    const output2 = (data as { output2?: Record<string, string>[] } | null)?.output2;
    if (!output2 || !Array.isArray(output2)) return [];

    const candles: KisChartCandle[] = output2
      .filter((row) => row.stck_bsop_date && parseInt(row.stck_clpr ?? '0', 10) > 0)
      .map((row) => ({
        date:   row.stck_bsop_date,
        open:   parseInt(row.stck_oprc ?? '0', 10),
        high:   parseInt(row.stck_hgpr ?? '0', 10),
        low:    parseInt(row.stck_lwpr ?? '0', 10),
        close:  parseInt(row.stck_clpr ?? '0', 10),
        volume: parseInt(row.acml_vol  ?? '0', 10),
      }))
      // KIS API는 최신→과거 순서로 반환 → 과거→최신으로 역순 정렬
      .reverse();

    return candles;
  } catch (err) {
    console.warn(`[KisChart] ${code} ${period}봉 조회 실패:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ── MTAS 구성 요소 계산 ──────────────────────────────────────────────────────

/** 당일 MTAS 결과 인메모리 캐시 (서버 재시작 전까지 유효) */
const _mtasCache = new Map<string, { data: KisMTASData; cachedAt: number }>();
/** 캐시 TTL: 6시간 — 월봉/주봉은 당일 중 변하지 않으므로 충분 */
const MTAS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * KIS API 월봉/주봉 데이터로 MTAS 구성 요소를 계산한다.
 *
 * 월봉: 최근 24개월 데이터로 12개월 EMA 계산
 * 주봉: 최근 78주 데이터로 일목균형표 구름대 계산
 *
 * 캐시: 6시간 TTL 인메모리 캐시 — 13:00 장중 재스캔 시 KIS 호출 0회
 * KIS API 미설정 시 또는 데이터 부족 시 null 반환 → Yahoo 폴백 사용
 */
export async function fetchKisMTASData(
  code: string,
  currentPrice: number,
): Promise<KisMTASData | null> {
  // 캐시 히트 → 즉시 반환 (KIS API 호출 없음)
  const cached = _mtasCache.get(code);
  if (cached && Date.now() - cached.cachedAt < MTAS_CACHE_TTL_MS) {
    return cached.data;
  }

  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return null;

  // 조회 기간: 현재 날짜 기준 2년 전 ~ 오늘
  const now = new Date();
  const endDate = formatDate(now);
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const startDate = formatDate(twoYearsAgo);

  // 월봉/주봉 병렬 조회 (rate limit 고려하여 순차 실행)
  const monthlyCandles = await fetchKisChartData(code, 'M', startDate, endDate);
  // KIS rate limit (초당 20건) 방지 — 최소 간격 확보
  await new Promise(r => setTimeout(r, 100));
  const weeklyCandles = await fetchKisChartData(code, 'W', startDate, endDate);

  if (monthlyCandles.length === 0 && weeklyCandles.length === 0) {
    return null;
  }

  // ── 월봉 지표: 주가 > 12개월 EMA이고 EMA 우상향 ──
  let monthlyAboveEMA12 = false;
  let monthlyEMARising = false;

  if (monthlyCandles.length >= 13) {
    const mCloses = monthlyCandles.map(c => c.close);
    const mEma12 = calcEMAArr(mCloses, 12);
    const lastEma = mEma12[mEma12.length - 1];
    const prevEma = mEma12.length >= 2 ? mEma12[mEma12.length - 2] : lastEma;
    monthlyAboveEMA12 = currentPrice > lastEma;
    monthlyEMARising = lastEma > prevEma;
  }

  // ── 주봉 지표: 일목균형표 구름대 위 + 후행스팬 상향 ──
  let weeklyAboveCloud = false;
  let weeklyLaggingSpanUp = false;

  if (weeklyCandles.length >= 52) {
    const wCloses = weeklyCandles.map(c => c.close);
    const wHighs = weeklyCandles.map(c => c.high);
    const wLows = weeklyCandles.map(c => c.low);
    const wn = wCloses.length;

    // 구름대는 26봉 전 데이터로 형성
    const refBar = wn - 27;
    const midpoint = (h: number[], l: number[], s: number, e: number): number => {
      if (s < 0 || e > h.length) return 0;
      return (Math.max(...h.slice(s, e)) + Math.min(...l.slice(s, e))) / 2;
    };

    const tenkanRef = midpoint(wHighs, wLows, refBar - 8, refBar + 1);  // 9봉 중앙값
    const kijunRef  = midpoint(wHighs, wLows, refBar - 25, refBar + 1); // 26봉 중앙값
    const spanA = (tenkanRef + kijunRef) / 2;
    const spanB = midpoint(wHighs, wLows, refBar - 51, refBar + 1);     // 52봉 중앙값
    const cloudTop = Math.max(spanA, spanB);

    weeklyAboveCloud = cloudTop > 0 && wCloses[wn - 1] > cloudTop;
    // 후행스팬: 현재 종가 vs 26주 전 종가
    weeklyLaggingSpanUp = wCloses[wn - 1] > wCloses[wn - 27];
  }

  const result: KisMTASData = {
    monthlyAboveEMA12,
    monthlyEMARising,
    weeklyAboveCloud,
    weeklyLaggingSpanUp,
    dataAvailable: true,
    monthlyCandleCount: monthlyCandles.length,
    weeklyCandleCount: weeklyCandles.length,
  };
  // 캐시 저장 — 이후 6시간 내 동일 종목 재조회 시 KIS 호출 없이 즉시 반환
  _mtasCache.set(code, { data: result, cachedAt: Date.now() });
  return result;
}

// ── 유틸: 날짜 포맷 ──────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * KIS 일봉 데이터 조회 래퍼 — 최근 N 영업일 캔들 반환.
 * Yahoo Finance 실패 시 KIS 기반으로 RSI/MACD/MA/ATR 등 기술적 지표를
 * 산출하기 위한 엔트리포인트.
 *
 * FHKST03010100 한 번 호출당 최대 ~100 봉 반환 — 120봉 확보 위해
 * calendarDays(기본 220)로 충분한 캘린더 범위를 지정한다.
 */
export async function fetchKisDailyCandles(
  code: string,
  calendarDays = 220,
): Promise<KisChartCandle[]> {
  const now = new Date();
  const endDate = formatDate(now);
  const start = new Date(now);
  start.setDate(start.getDate() - calendarDays);
  const startDate = formatDate(start);
  return fetchKisChartData(code, 'D', startDate, endDate);
}
