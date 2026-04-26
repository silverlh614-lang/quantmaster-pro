// @responsibility Yahoo Finance OHLCV+지표 시세 페칭 어댑터 단일 통로
/**
 * adapters/yahooQuoteAdapter.ts — Yahoo 시세 + 기술적 지표 페칭 (ADR-0029).
 *
 * 5분 in-memory cache + guardedFetch (egressGuard) + range=2y / interval=1d.
 * MTAS(월봉/주봉) 계산에 충분한 데이터 확보 + Phase 2 가속도 지표 + Compression Score
 * + 위험 종목 감지(거래중지/관리종목) 까지 한 번에 산출.
 */

import { guardedFetch } from '../../utils/egressGuard.js';
import { calcRSI, calcRSI14, calcEMAArr, calcMACD } from './_indicators.js';

// 아이디어 5: 확장된 Yahoo 시세 인터페이스 (MA/고가/ATR/RSI/MACD + 가속도 포함)
export interface YahooQuoteExtended {
  price: number;
  dayOpen: number;         // 당일 시가
  prevClose: number;       // 전일 종가
  changePercent: number;
  volume: number;
  avgVolume: number;
  ma5: number;             // 5일 이동평균
  ma20: number;            // 20일 이동평균
  ma60: number;            // 60일 이동평균
  high5d: number;          // 5일 최고가 (Gate 24 breakout_momentum 용 — momentum 과 독립 입력)
  high20d: number;         // 20일 최고가
  high60d: number;         // 60일 최고가 (눌림목 판단용)
  atr: number;             // 최근 14일 ATR (Average True Range)
  atr20avg: number;        // 20일 ATR 평균 (VCP 판단용)
  per: number;             // PER (Yahoo 제공 시)
  rsi14: number;           // RSI(14) — Wilder 평활화 실계산
  macd: number;            // MACD 라인 (EMA12 − EMA26)
  macdSignal: number;      // Signal 라인 (MACD의 EMA9)
  macdHistogram: number;   // MACD − Signal (양수 = 상승 압력)
  // Phase 2 컨플루언스 가속도 지표
  rsi5dAgo: number;        // RSI(14) 5일 전 값 (RSI 가속도 계산용)
  weeklyRSI: number;       // 주봉 RSI(9) — 5영업일 다운샘플
  ma60TrendUp: boolean;    // MA60 상승 추세 (현재 > 5일 전 MA60)
  macd5dHistAgo: number;   // MACD 히스토그램 5일 전 (MACD 가속도 계산용)
  // Regret Asymmetry Filter 용
  return5d: number;        // 직전 5거래일 수익률 (%) — FOMO 쿨다운 판단
  return20d: number;       // 직전 20거래일 수익률 (%) — Gate 24 상대강도(vs KOSPI 20d) 입력
  // Pre-Breakout Accumulation Detector 용 (최근 10일 OHLCV 원본 배열)
  recentCloses10d?: number[];   // 최근 10일 종가 배열
  recentHighs10d?: number[];    // 최근 10일 일중 고가 배열
  recentLows10d?: number[];     // 최근 10일 일중 저가 배열
  recentVolumes10d?: number[];  // 최근 10일 거래량 배열
  // Compression Score 구성 요소
  bbWidthCurrent: number;       // 현재 BB 폭 비율 (4σ/SMA)
  bbWidth20dAvg: number;        // 최근 20봉 BB 폭 이동평균
  vol5dAvg: number;             // 5일 평균 거래량
  vol20dAvg: number;            // 20일 평균 거래량
  atr5d: number;                // 5일 ATR
  // MTAS 구성 요소
  monthlyAboveEMA12: boolean;   // 월봉: 주가 > 12개월 EMA
  monthlyEMARising: boolean;    // 월봉: EMA12 우상향 중
  weeklyAboveCloud: boolean;    // 주봉: 일목균형표 구름대 위
  weeklyLaggingSpanUp: boolean; // 주봉: 후행스팬 상향
  dailyVolumeDrying: boolean;   // 일봉: 거래량 마름 (vol5d < vol20d × 0.7)
  // 위험 종목 플래그
  isHighRisk: boolean;          // 거래중지/관리종목/위험 분류 감지
}

// 스크리너·시그널·리포트가 같은 분 안에 동일 심볼을 여러 번 조회하므로
// 5분 TTL로만 묶어도 호출 수가 대폭 줄어든다. null 은 캐싱하지 않는다(일시 실패 재시도 허용).
const YAHOO_QUOTE_CACHE_TTL_MS = 5 * 60 * 1000;
const _yahooQuoteCache = new Map<string, { data: YahooQuoteExtended; ts: number }>();

export async function fetchYahooQuote(symbol: string): Promise<YahooQuoteExtended | null> {
  const cached = _yahooQuoteCache.get(symbol);
  if (cached && Date.now() - cached.ts < YAHOO_QUOTE_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    // range=2y — MTAS(월봉/주봉) 계산에 충분한 데이터 확보 (MA60, 가속도 지표 포함)
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d`;
    const res = await guardedFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, 'HISTORICAL');
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const rawHighs: (number | null)[]  = result.indicators?.quote?.[0]?.high ?? [];
    const rawLows: (number | null)[]   = result.indicators?.quote?.[0]?.low ?? [];
    const rawVolumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

    // null 값 제거한 유효 데이터
    const closes  = rawCloses.filter((v): v is number => v != null && v > 0);
    const highs   = rawHighs.filter((v): v is number => v != null && v > 0);
    const lows    = rawLows.filter((v): v is number => v != null && v > 0);
    const volumes = rawVolumes.filter((v): v is number => v != null && v > 0);

    if (closes.length < 5) return null;

    const price = meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0;
    const prevClose = meta.regularMarketPreviousClose ?? closes[closes.length - 2] ?? price;
    const dayOpen = meta.regularMarketOpen ?? price;
    const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = volumes[volumes.length - 1] ?? 0;

    // 평균 거래량 (최근 60거래일, 당일 제외 — 2y 범위에서도 일관성 유지)
    const pastVolumes = volumes.slice(Math.max(0, volumes.length - 61), -1);
    const avgVolume = pastVolumes.length > 0
      ? pastVolumes.reduce((s, v) => s + v, 0) / pastVolumes.length
      : volume;

    // 이동평균 계산
    const avg = (arr: number[], n: number) => {
      const slice = arr.slice(-n);
      return slice.length >= n ? slice.reduce((a, b) => a + b, 0) / n : 0;
    };
    const ma5  = avg(closes, 5);
    const ma20 = avg(closes, 20);
    const ma60 = avg(closes, 60);

    // 5일 최고가 (Gate 24 breakout_momentum 용 — momentum 과 독립 입력)
    const high5d = highs.length >= 5
      ? Math.max(...highs.slice(-5))
      : highs.length > 0 ? Math.max(...highs) : 0;

    // 20일 최고가
    const high20d = highs.length >= 20
      ? Math.max(...highs.slice(-20))
      : Math.max(...highs);

    // 60일 최고가 (눌림목 판단: 고점 대비 조정폭)
    const high60d = highs.length >= 60
      ? Math.max(...highs.slice(-60))
      : Math.max(...highs);

    // ATR (Average True Range) 계산 — 14일 기준
    const trueRanges: number[] = [];
    const minLen = Math.min(closes.length, highs.length, lows.length);
    for (let i = 1; i < minLen; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
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

    // PER — Yahoo meta에서 제공 시 사용
    const per = parseFloat(meta.trailingPE ?? '999');

    // RSI14 + MACD — 실데이터 계산
    const rsi14 = calcRSI14(closes);
    const { macd, signal: macdSignal, histogram: macdHistogram } = calcMACD(closes);

    // ── Phase 2 가속도 지표 ──
    // RSI 5일 전 (현재에서 마지막 5봉 제거)
    const closes5dAgo   = closes.length > 5 ? closes.slice(0, -5) : closes;
    const rsi5dAgo      = parseFloat(calcRSI14(closes5dAgo).toFixed(1));

    // MACD 히스토그램 5일 전
    const macdPast      = calcMACD(closes5dAgo);
    const macd5dHistAgo = parseFloat(macdPast.histogram.toFixed(2));

    // MA60 상승 추세 (현재 MA60 > 5일 전 MA60)
    const avgFn = (arr: number[], n: number) => {
      const s = arr.slice(-n); return s.length >= n ? s.reduce((a, b) => a + b, 0) / n : 0;
    };
    const ma60Before  = avgFn(closes5dAgo, 60);
    const ma60TrendUp = ma60 > 0 && ma60Before > 0 && ma60 > ma60Before;

    // 주봉 RSI(9) — 5영업일마다 다운샘플
    const weeklyCloses: number[] = [];
    for (let i = 4; i < closes.length; i += 5) weeklyCloses.push(closes[i]);
    const weeklyRSI = parseFloat(calcRSI(weeklyCloses, 9).toFixed(1));

    // 직전 5거래일 수익률 — Regret Asymmetry Filter용
    const close5dAgo = closes.length > 5 ? closes[closes.length - 6] : closes[0];
    const return5d = close5dAgo > 0 ? ((price - close5dAgo) / close5dAgo) * 100 : 0;

    // 직전 20거래일 수익률 — Gate 24 상대강도(vs KOSPI 20d) 입력
    const close20dAgo = closes.length > 20 ? closes[closes.length - 21] : closes[0];
    const return20d = close20dAgo > 0 ? ((price - close20dAgo) / close20dAgo) * 100 : 0;

    // ── Compression Score 구성 요소 ──────────────────────────────────────────────

    // BB 폭 계산: (4σ / SMA) at a given bar index
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

    // 거래량 5일/20일 평균
    const vol5dAvg = volumes.length >= 5
      ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : volume;
    const vol20dAvg = volumes.length >= 20
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : avgVolume;

    // ATR 5일
    const atr5d = trueRanges.length >= 5
      ? trueRanges.slice(-5).reduce((a, b) => a + b, 0) / 5 : atr;

    // 거래량 마름 판단 (5일 평균 < 20일 평균의 70%)
    const dailyVolumeDrying = vol20dAvg > 0 && vol5dAvg < vol20dAvg * 0.7;

    // ── MTAS 구성 요소: 월봉/주봉 다운샘플링 ────────────────────────────────────

    // 주봉 다운샘플링 (5거래일 단위)
    const wCloses: number[] = [], wHighs: number[] = [], wLows: number[] = [];
    for (let i = 0; i < closes.length; i += 5) {
      const end = Math.min(i + 5, closes.length);
      wCloses.push(closes[end - 1]);
      wHighs.push(Math.max(...highs.slice(i, end)));
      wLows.push(Math.min(...lows.slice(i, end)));
    }

    // 월봉 다운샘플링 (~21거래일 단위)
    const mCloses: number[] = [];
    for (let i = 0; i < closes.length; i += 21) {
      const end = Math.min(i + 21, closes.length);
      mCloses.push(closes[end - 1]);
    }

    // 월봉: 주가 > 12개월 EMA이고 EMA 우상향
    let monthlyAboveEMA12 = false, monthlyEMARising = false;
    if (mCloses.length >= 13) {
      const mEma12 = calcEMAArr(mCloses, 12);
      const lastEma = mEma12[mEma12.length - 1];
      const prevEma = mEma12.length >= 2 ? mEma12[mEma12.length - 2] : lastEma;
      monthlyAboveEMA12 = price > lastEma;
      monthlyEMARising = lastEma > prevEma;
    }

    // 주봉: 일목균형표 구름대 위 + 후행스팬 상향
    // 52주(약 1년)로 완화 — Yahoo Finance 한국 종목 히스토리 부족 대응 (기존 78주)
    let weeklyAboveCloud = false, weeklyLaggingSpanUp = false;
    if (wCloses.length >= 52) {
      const wn = wCloses.length;
      const refBar = wn - 27; // 구름대는 26봉 전 데이터로 형성
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

    // ── 위험 종목 감지 ─────────────────────────────────────────────────────────
    // 거래중지: 최근 5일 거래량 전부 0이면 거래중지 상태로 판단
    // 관리종목/투자위험: 최근 10일 중 8일 이상 거래량 0 (유동성 사실상 고갈)
    const recent5Vol = volumes.slice(-5);
    const zeroVolDays5 = recent5Vol.filter(v => v === 0).length;
    const recent10Vol = volumes.slice(-10);
    const zeroVolDays10 = recent10Vol.filter(v => v === 0).length;
    const isHighRisk = zeroVolDays5 >= 5 || zeroVolDays10 >= 8;

    const quote: YahooQuoteExtended = {
      price: Math.round(price), changePercent, volume, avgVolume,
      dayOpen: Math.round(dayOpen),
      prevClose: Math.round(prevClose),
      ma5, ma20, ma60, high5d, high20d, high60d, atr, atr20avg, per,
      rsi14: parseFloat(rsi14.toFixed(1)),
      macd:  parseFloat(macd.toFixed(2)),
      macdSignal: parseFloat(macdSignal.toFixed(2)),
      macdHistogram: parseFloat(macdHistogram.toFixed(2)),
      rsi5dAgo, weeklyRSI, ma60TrendUp, macd5dHistAgo,
      return5d: parseFloat(return5d.toFixed(2)),
      return20d: parseFloat(return20d.toFixed(2)),
      recentCloses10d:  closes.slice(-10),
      recentHighs10d:   highs.slice(-10),
      recentLows10d:    lows.slice(-10),
      recentVolumes10d: volumes.slice(-10),
      // Compression Score 구성 요소
      bbWidthCurrent: parseFloat(bbWidthCurrent.toFixed(6)),
      bbWidth20dAvg:  parseFloat(bbWidth20dAvg.toFixed(6)),
      vol5dAvg: Math.round(vol5dAvg),
      vol20dAvg: Math.round(vol20dAvg),
      atr5d: parseFloat(atr5d.toFixed(2)),
      // MTAS 구성 요소
      monthlyAboveEMA12,
      monthlyEMARising,
      weeklyAboveCloud,
      weeklyLaggingSpanUp,
      dailyVolumeDrying,
      isHighRisk,
    };
    _yahooQuoteCache.set(symbol, { data: quote, ts: Date.now() });
    return quote;
  } catch (e) {
    console.error(`[fetchYahooQuote] ${symbol}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
