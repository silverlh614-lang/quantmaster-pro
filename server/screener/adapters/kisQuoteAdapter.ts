// @responsibility KIS 시세 + 일봉 캔들 → YahooQuoteExtended 호환 어댑터
/**
 * adapters/kisQuoteAdapter.ts — KIS 현재가 + 일봉 캔들 어댑터 (ADR-0029).
 *
 * Yahoo 가 일시 차단·게이트로 막혔거나 한국 장중 시가가 부정확할 때 KIS API 폴백.
 * fetchKisDailyCandles + buildExtendedFromKisDaily 로 Yahoo 산식과 동일한 지표를
 * 산출 (kisChartDataFetcher 가 KIS FHKST03010100 호출).
 *
 * enrichQuoteWithKisMTAS — Yahoo 다운샘플 MTAS 가 한국 종목에서 부족할 때 KIS 월/주봉
 * 데이터 (FHKST03010100 + 주봉 다운샘플) 로 monthlyAboveEMA12/weeklyAboveCloud 보강.
 */

import { realDataKisGet, HAS_REAL_DATA_CLIENT } from '../../clients/kisClient.js';
import { fetchKisMTASData, fetchKisDailyCandles, type KisChartCandle } from '../kisChartDataFetcher.js';
import { recordMtasAttempt } from '../dataCompletenessTracker.js';
import { calcRSI, calcRSI14, calcEMAArr, calcMACD } from './_indicators.js';
import type { YahooQuoteExtended } from './yahooQuoteAdapter.js';

/**
 * KIS 일봉 캔들(FHKST03010100) OHLCV로부터 YahooQuoteExtended 호환
 * 기술적 지표를 산출한다. fetchYahooQuote의 지표 계산 로직과 동일한
 * 공식을 사용하므로 산출값은 Yahoo 결과와 호환된다.
 *
 * 주의: fetchYahooQuote의 지표 산식이 변경되면 여기도 동기화할 것.
 */
function buildExtendedFromKisDaily(
  candles: KisChartCandle[],
  live: { price: number; dayOpen: number; prevClose: number; changePercent: number; volume: number },
): YahooQuoteExtended {
  // KIS 캔들은 과거→최신 순서. 마지막 봉 종가는 라이브 현재가로 대체하여
  // 장중 실시간 MA/RSI/MACD 가 Yahoo 방식(meta.regularMarketPrice 덮어쓰기)과 일치하도록 한다.
  const closes  = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  if (closes.length > 0 && live.price > 0) closes[closes.length - 1] = live.price;
  if (volumes.length > 0 && live.volume > 0) volumes[volumes.length - 1] = live.volume;

  // 평균 거래량 (최근 60거래일, 당일 제외)
  const pastVolumes = volumes.slice(Math.max(0, volumes.length - 61), -1);
  const avgVolume = pastVolumes.length > 0
    ? pastVolumes.reduce((s, v) => s + v, 0) / pastVolumes.length
    : live.volume;

  const avg = (arr: number[], n: number) => {
    const slice = arr.slice(-n);
    return slice.length >= n ? slice.reduce((a, b) => a + b, 0) / n : 0;
  };
  const ma5  = avg(closes, 5);
  const ma20 = avg(closes, 20);
  const ma60 = avg(closes, 60);

  const high5d  = highs.length >= 5  ? Math.max(...highs.slice(-5))  : highs.length > 0 ? Math.max(...highs) : 0;
  const high20d = highs.length >= 20 ? Math.max(...highs.slice(-20)) : highs.length > 0 ? Math.max(...highs) : 0;
  const high60d = highs.length >= 60 ? Math.max(...highs.slice(-60)) : highs.length > 0 ? Math.max(...highs) : 0;

  // ATR (True Range 기반 14일·20일·5일 이평)
  const trueRanges: number[] = [];
  const minLen = Math.min(closes.length, highs.length, lows.length);
  for (let i = 1; i < minLen; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    );
    trueRanges.push(tr);
  }
  const atr = trueRanges.length >= 14
    ? trueRanges.slice(-14).reduce((a, b) => a + b, 0) / 14
    : trueRanges.length > 0
      ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length
      : 0;
  const atr20avg = trueRanges.length >= 20
    ? trueRanges.slice(-20).reduce((a, b) => a + b, 0) / 20
    : atr;
  const atr5d = trueRanges.length >= 5
    ? trueRanges.slice(-5).reduce((a, b) => a + b, 0) / 5
    : atr;

  // RSI14 + MACD
  const rsi14 = calcRSI14(closes);
  const { macd, signal: macdSignal, histogram: macdHistogram } = calcMACD(closes);

  // Phase 2 가속도 지표
  const closes5dAgo   = closes.length > 5 ? closes.slice(0, -5) : closes;
  const rsi5dAgo      = parseFloat(calcRSI14(closes5dAgo).toFixed(1));
  const macdPast      = calcMACD(closes5dAgo);
  const macd5dHistAgo = parseFloat(macdPast.histogram.toFixed(2));
  const ma60Before    = avg(closes5dAgo, 60);
  const ma60TrendUp   = ma60 > 0 && ma60Before > 0 && ma60 > ma60Before;

  // 주봉 RSI(9) — 5영업일 다운샘플
  const weeklyClosesSample: number[] = [];
  for (let i = 4; i < closes.length; i += 5) weeklyClosesSample.push(closes[i]);
  const weeklyRSI = parseFloat(calcRSI(weeklyClosesSample, 9).toFixed(1));

  // 5거래일 수익률
  const close5dAgo = closes.length > 5 ? closes[closes.length - 6] : closes[0] ?? live.price;
  const return5d = close5dAgo > 0 ? ((live.price - close5dAgo) / close5dAgo) * 100 : 0;

  // 20거래일 수익률 — Gate 24 상대강도(vs KOSPI 20d) 용. 이력 부족 시 첫 종가 기준으로 폴백
  // (이는 return5d 와 동일한 폴백 패턴). 이력이 정말 없으면 0.
  const close20dAgo = closes.length > 20 ? closes[closes.length - 21] : closes[0] ?? live.price;
  const return20d = close20dAgo > 0 ? ((live.price - close20dAgo) / close20dAgo) * 100 : 0;

  // Compression Score: BB 폭
  const calcBBWidthAt = (cs: number[], endIdx: number): number => {
    if (endIdx < 19 || cs.length <= endIdx) return 0;
    const slice = cs.slice(endIdx - 19, endIdx + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / 20;
    if (mean === 0) return 0;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20;
    return (4 * Math.sqrt(variance)) / mean;
  };
  const bbWidthCurrent = calcBBWidthAt(closes, closes.length - 1);
  let bbWidthSum = 0, bbWidthCount = 0;
  for (let i = 0; i < 20 && (closes.length - 1 - i) >= 19; i++) {
    bbWidthSum += calcBBWidthAt(closes, closes.length - 1 - i);
    bbWidthCount++;
  }
  const bbWidth20dAvg = bbWidthCount > 0 ? bbWidthSum / bbWidthCount : bbWidthCurrent;

  const vol5dAvg  = volumes.length >= 5
    ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : live.volume;
  const vol20dAvg = volumes.length >= 20
    ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : avgVolume;
  const dailyVolumeDrying = vol20dAvg > 0 && vol5dAvg < vol20dAvg * 0.7;

  // 주봉 다운샘플링 (5거래일 단위)
  const wCloses: number[] = [], wHighs: number[] = [], wLows: number[] = [];
  for (let i = 0; i < closes.length; i += 5) {
    const end = Math.min(i + 5, closes.length);
    wCloses.push(closes[end - 1]);
    wHighs.push(Math.max(...highs.slice(i, end)));
    wLows.push(Math.min(...lows.slice(i, end)));
  }

  // 월봉 다운샘플링 (~21거래일 단위)
  const mClosesSample: number[] = [];
  for (let i = 0; i < closes.length; i += 21) {
    const end = Math.min(i + 21, closes.length);
    mClosesSample.push(closes[end - 1]);
  }

  // 월봉 MTAS 힌트 (정식 값은 enrichQuoteWithKisMTAS가 월봉 API로 덮어씀)
  let monthlyAboveEMA12 = false, monthlyEMARising = false;
  if (mClosesSample.length >= 13) {
    const mEma12 = calcEMAArr(mClosesSample, 12);
    const lastEma = mEma12[mEma12.length - 1];
    const prevEma = mEma12.length >= 2 ? mEma12[mEma12.length - 2] : lastEma;
    monthlyAboveEMA12 = live.price > lastEma;
    monthlyEMARising  = lastEma > prevEma;
  }

  // 주봉 일목균형표 힌트
  let weeklyAboveCloud = false, weeklyLaggingSpanUp = false;
  if (wCloses.length >= 52) {
    const wn = wCloses.length;
    const refBar = wn - 27;
    const midpoint = (h: number[], l: number[], s: number, e: number): number => {
      if (s < 0 || e > h.length) return 0;
      return (Math.max(...h.slice(s, e)) + Math.min(...l.slice(s, e))) / 2;
    };
    const tenkanRef = midpoint(wHighs, wLows, refBar - 8,  refBar + 1);
    const kijunRef  = midpoint(wHighs, wLows, refBar - 25, refBar + 1);
    const spanA = (tenkanRef + kijunRef) / 2;
    const spanB = midpoint(wHighs, wLows, refBar - 51, refBar + 1);
    const cloudTop = Math.max(spanA, spanB);
    weeklyAboveCloud    = cloudTop > 0 && wCloses[wn - 1] > cloudTop;
    weeklyLaggingSpanUp = wCloses[wn - 1] > wCloses[wn - 27];
  }

  // 거래중지·관리종목 감지 (거래량 0 비율)
  const recent5Vol  = volumes.slice(-5);
  const recent10Vol = volumes.slice(-10);
  const zeroVolDays5  = recent5Vol.filter(v => v === 0).length;
  const zeroVolDays10 = recent10Vol.filter(v => v === 0).length;
  const isHighRisk = zeroVolDays5 >= 5 || zeroVolDays10 >= 8;

  return {
    price: Math.round(live.price),
    changePercent: live.changePercent,
    volume: live.volume,
    avgVolume,
    dayOpen: Math.round(live.dayOpen),
    prevClose: Math.round(live.prevClose),
    ma5, ma20, ma60,
    high5d, high20d, high60d,
    atr, atr20avg,
    per: 0,
    rsi14: parseFloat(rsi14.toFixed(1)),
    macd: parseFloat(macd.toFixed(2)),
    macdSignal: parseFloat(macdSignal.toFixed(2)),
    macdHistogram: parseFloat(macdHistogram.toFixed(2)),
    rsi5dAgo, weeklyRSI, ma60TrendUp, macd5dHistAgo,
    return5d: parseFloat(return5d.toFixed(2)),
    return20d: parseFloat(return20d.toFixed(2)),
    recentCloses10d:  closes.slice(-10),
    recentHighs10d:   highs.slice(-10),
    recentLows10d:    lows.slice(-10),
    recentVolumes10d: volumes.slice(-10),
    bbWidthCurrent: parseFloat(bbWidthCurrent.toFixed(6)),
    bbWidth20dAvg:  parseFloat(bbWidth20dAvg.toFixed(6)),
    vol5dAvg: Math.round(vol5dAvg),
    vol20dAvg: Math.round(vol20dAvg),
    atr5d: parseFloat(atr5d.toFixed(2)),
    monthlyAboveEMA12, monthlyEMARising,
    weeklyAboveCloud, weeklyLaggingSpanUp,
    dailyVolumeDrying,
    isHighRisk,
  };
}

/**
 * Yahoo Finance 실패 시 KIS API로 YahooQuoteExtended 를 구성하는 폴백.
 *
 * 2단계 조회:
 *   1) FHKST01010100 (현재가) — 라이브 시가·현재가·전일종가·등락률
 *   2) FHKST03010100 (일봉) — 최근 ~120영업일 OHLCV 로 MA/RSI/MACD/ATR/MTAS 산출
 *
 * 일봉 조회 실패 또는 데이터 부족(<20봉) 시 보수적 0값 폴백으로 degrade.
 */
export async function fetchKisQuoteFallback(code: string): Promise<YahooQuoteExtended | null> {
  if (!HAS_REAL_DATA_CLIENT && !process.env.KIS_APP_KEY) return null;
  try {
    const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    });
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;

    const price      = parseInt(out.stck_prpr ?? '0', 10);
    if (price <= 0) return null;

    const dayOpen    = parseInt(out.stck_oprc  ?? '0', 10) || price;
    const volume     = parseInt(out.acml_vol   ?? '0', 10);
    const prdyVrss   = parseInt(out.stck_prdy_vrss ?? '0', 10);
    // prdy_vrss_sign: '1'=상한, '2'=상승, '3'=보합, '4'=하한, '5'=하락
    const signStr    = out.prdy_vrss_sign ?? '3';
    const prdyChange = signStr === '5' || signStr === '4' ? -Math.abs(prdyVrss) : Math.abs(prdyVrss);
    const prevClose  = price - prdyChange || price;
    const changePercent = prevClose > 0 ? (prdyChange / prevClose) * 100 : 0;
    const live = { price, dayOpen, prevClose, changePercent, volume };

    // 일봉 120봉 조회 → 기술적 지표 풀 산출. 실패/부족 시 보수적 0값 폴백.
    const candles = await fetchKisDailyCandles(code).catch(() => [] as KisChartCandle[]);
    if (candles.length >= 20) {
      return buildExtendedFromKisDaily(candles, live);
    }

    return {
      price, dayOpen, prevClose, changePercent,
      volume,
      // 일봉 데이터 부족 — 보수적 0값 (Gate 통과 불가)
      avgVolume: 0, ma5: 0, ma20: 0, ma60: 0,
      high5d: price, high20d: price, high60d: price,
      atr: 0, atr20avg: 0, per: 0,
      rsi14: 50, macd: 0, macdSignal: 0, macdHistogram: 0,
      rsi5dAgo: 50, weeklyRSI: 50,
      ma60TrendUp: false, macd5dHistAgo: 0,
      return5d: 0,
      return20d: 0,
      bbWidthCurrent: 0, bbWidth20dAvg: 0,
      vol5dAvg: 0, vol20dAvg: 0, atr5d: 0,
      monthlyAboveEMA12: false, monthlyEMARising: false,
      weeklyAboveCloud: false, weeklyLaggingSpanUp: false,
      dailyVolumeDrying: false,
      isHighRisk: false,
    };
  } catch (e) {
    console.error(`[fetchKisQuoteFallback] ${code}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * KIS 현재가 API(FHKST01010100)에서 시가·전일종가·현재가만 경량 조회.
 * Yahoo Finance의 regularMarketOpen이 한국 장중 부정확한 값을 반환하는 문제를
 * 보정하기 위해 사용한다. Yahoo 전체 Quote를 대체하지 않고 dayOpen/prevClose만
 * 덮어쓰는 용도이므로 히스토리 지표는 포함하지 않는다.
 */
export async function fetchKisIntraday(code: string): Promise<{
  price: number;
  dayOpen: number;
  prevClose: number;
  volume: number;
} | null> {
  if (!HAS_REAL_DATA_CLIENT && !process.env.KIS_APP_KEY) return null;
  try {
    const data = await realDataKisGet('FHKST01010100', '/uapi/domestic-stock/v1/quotations/inquire-price', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: code.padStart(6, '0'),
    });
    const out = (data as { output?: Record<string, string> } | null)?.output;
    if (!out) return null;

    const price = parseInt(out.stck_prpr ?? '0', 10);
    if (price <= 0) return null;

    const dayOpen    = parseInt(out.stck_oprc  ?? '0', 10) || price;
    const volume     = parseInt(out.acml_vol   ?? '0', 10);
    const prdyVrss   = parseInt(out.stck_prdy_vrss ?? '0', 10);
    const signStr    = out.prdy_vrss_sign ?? '3';
    const prdyChange = signStr === '5' || signStr === '4' ? -Math.abs(prdyVrss) : Math.abs(prdyVrss);
    const prevClose  = price - prdyChange || price;

    return { price, dayOpen, prevClose, volume };
  } catch (e) {
    console.error(`[fetchKisIntraday] ${code}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// Yahoo Finance 호출 캐시 — 동일 종목 중복 호출을 억제해 429 Rate Limit을 회피한다.
// 스크리너·시그널·리포트가 같은 분 안에 동일 심볼을 여러 번 조회하므로
// 5분 TTL로만 묶어도 호출 수가 대폭 줄어든다. null 은 캐싱하지 않는다(일시 실패 재시도 허용).
const YAHOO_QUOTE_CACHE_TTL_MS = 5 * 60 * 1000;
const _yahooQuoteCache = new Map<string, { data: YahooQuoteExtended; ts: number }>();


/**
 * 아이디어 9: KIS API 월봉/주봉 데이터로 MTAS 구성 요소를 보강한다.
 *
 * Yahoo Finance 다운샘플링(일봉→월봉/주봉)은 한국 주식 데이터 부족으로
 * MTAS가 낮게 산출되는 문제가 있다. KIS API (FHKST03010100)로 실제
 * 월봉/주봉 데이터를 조회하여 정확한 MTAS를 계산한다.
 *
 * KIS 데이터 조회 성공 시 Yahoo 파생 값을 KIS 값으로 덮어쓴다.
 * 실패 시 기존 Yahoo 값 유지 (graceful fallback).
 */
export async function enrichQuoteWithKisMTAS(
  quote: YahooQuoteExtended,
  code: string,
): Promise<YahooQuoteExtended> {
  try {
    const kisMtas = await fetchKisMTASData(code, quote.price);
    const available = !!(kisMtas && kisMtas.dataAvailable
      && (kisMtas.monthlyCandleCount >= 13 || kisMtas.weeklyCandleCount >= 52));
    recordMtasAttempt(code, available);
    if (!kisMtas || !kisMtas.dataAvailable) return quote;

    // KIS 데이터가 충분한 경우에만 덮어쓰기
    const enriched = { ...quote };

    if (kisMtas.monthlyCandleCount >= 13) {
      enriched.monthlyAboveEMA12 = kisMtas.monthlyAboveEMA12;
      enriched.monthlyEMARising = kisMtas.monthlyEMARising;
      console.log(
        `[KisMTAS] ${code} 월봉 KIS 보강: EMA12위=${kisMtas.monthlyAboveEMA12} 상승=${kisMtas.monthlyEMARising} (${kisMtas.monthlyCandleCount}개월)`,
      );
    }

    if (kisMtas.weeklyCandleCount >= 52) {
      enriched.weeklyAboveCloud = kisMtas.weeklyAboveCloud;
      enriched.weeklyLaggingSpanUp = kisMtas.weeklyLaggingSpanUp;
      console.log(
        `[KisMTAS] ${code} 주봉 KIS 보강: 구름대위=${kisMtas.weeklyAboveCloud} 후행스팬=${kisMtas.weeklyLaggingSpanUp} (${kisMtas.weeklyCandleCount}주)`,
      );
    }

    return enriched;
  } catch (err) {
    recordMtasAttempt(code, false);
    console.warn(`[KisMTAS] ${code} KIS 보강 실패 (Yahoo 폴백):`, err instanceof Error ? err.message : err);
    return quote;
  }
}
