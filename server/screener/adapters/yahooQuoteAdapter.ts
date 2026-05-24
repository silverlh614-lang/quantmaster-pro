// @responsibility Yahoo Finance OHLCV+지표 시세 페칭 어댑터 단일 통로
/**
 * adapters/yahooQuoteAdapter.ts — Yahoo 시세 + 기술적 지표 페칭 (ADR-0029).
 *
 * 5분 in-memory cache + guardedFetch (egressGuard) + range=2y / interval=1d.
 * MTAS(월봉/주봉) 계산에 충분한 데이터 확보 + Phase 2 가속도 지표 + Compression Score
 * + 위험 종목 감지(거래중지/관리종목) 까지 한 번에 산출.
 */

import { guardedFetch } from '../../utils/egressGuard.js';
import { safePctChange, safePctChangeDetailed, type PriceBase, type PriceSource } from '../../utils/safePctChange.js';
import { calcRSI, calcRSI14, calcEMAArr, calcMACD } from './_indicators.js';
import { fetchKisIntraday } from './kisQuoteAdapter.js';
import { previousKrxTradingDay } from '../../calendar/krxTradingCalendar.js';
import { msUntilKstMarketCloseOrMin } from '../../utils/preopenDiscoveryGuards.js';

/**
 * ADR-0028 §모순 보강: Yahoo 응답의 가격 필드 검증 SSOT.
 *
 * 기존 `meta.regularMarketPrice ?? closes[-1] ?? 0` 패턴의 함정:
 *   - `??` (nullish coalescing) 은 *null/undefined 만* fallback. 0 은 통과.
 *   - Yahoo 가 일부 KRX 종목 (예: 신규상장/거래정지) 에 `regularMarketPrice=0`
 *     으로 응답하면 0 이 그대로 price 로 사용됨 → safePctChange 가 -100% 산출
 *     → sanity 위반 누적 (2026-04-28 12:00 KST Railway 로그 222160.KQ 시나리오).
 *
 * `validPrice(v)` 는 0/NaN/Infinity/음수/null/undefined/non-numeric 모두 null 반환.
 * 호출자가 chain 으로 `validPrice(a) ?? validPrice(b) ?? validPrice(c)` 처럼 묶어
 * 첫 *유효 양수 가격* 만 채택하도록 강제.
 */
function validPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 아이디어 5: 확장된 Yahoo 시세 인터페이스 (MA/고가/ATR/RSI/MACD + 가속도 포함)
export interface YahooQuoteExtended {
  price: number;
  currentPrice?: number;
  close?: number;
  dayOpen: number;         // 당일 시가
  prevClose: number;       // 전일 종가
  changePercent: number;
  volume: number;
  avgVolume: number;
  avgVolume20d?: number;
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
  /**
   * ADR-0028 §PR-D3-B: 가격 출처+시점 메타.
   * `price` 필드의 출처 (YAHOO_INTRADAY / Yahoo regularMarketTime 시점) 를 기록.
   * 호출자가 PriceBase 로 safePctChange 에 전달하면 stale 검증 자동 적용 (PR-D3-D).
   * 옵셔널 — 기존 호출자 후방호환.
   */
  priceMetadata?: PriceBase;
  entryPriceAgeSec?: number;
  priceAsOf?: string;
  entryPriceSource?: string;
  rawEntryPrice?: number;
  adjustedEntryPrice?: number;
  driftPct?: number;
  rrr?: number;
  targetPrice?: number;
  stopLossPrice?: number;
  falseBreakoutRisk?: string;
  priceFreshness?: string;
  /**
   * ADR-0091 PR-Z4 + ADR-0411/0502 — price data quality marker.
   * KIS fresh current price is primary. Yahoo can still be fetched for diagnostics,
   * but Yahoo divergence/staleness must not degrade Gate/Stage when KIS is fresh.
   */
  dataQuality?:
    | 'OK'
    | 'STALE_BASE'
    | 'KIS_PRIMARY'
    | 'KIS_PRIMARY_YAHOO_DIAGNOSTIC_STALE'
    | 'KIS_PRIMARY_YAHOO_STALE_DETECTED'
    | 'YAHOO_FALLBACK_KIS_MISSING'
    | 'CACHE_FALLBACK_PRICE_MISSING';
  /** dataQuality=STALE_BASE 시 어느 필드가 위반했는지 진단 — 운영 로그 추적용. */
  dataQualityIssues?: Array<'changePercent' | 'return5d' | 'return20d'>;
  /**
   * ADR-0411 — Yahoo 시계열 파생 지표 (MA/RSI/MACD/ATR/return5d/20d/BB폭/MTAS) 신뢰성 marker.
   * `false` 면 시계열 의존 evaluator (momentum/ma_alignment/vcp/volume_breakout/turtle_high/
   * relative_strength/breakout_momentum/volume_surge/rsi_zone/macd_bull/pullback/ma60_rising/
   * weekly_rsi_zone/trend_acceleration) 가 registry 단계에서 자동 PROVIDER_DEGRADED 강등.
   *
   * KIS primary rows keep this true because Yahoo is diagnostic-only. Yahoo-only
   * `STALE_BASE` keeps this false so legacy indicator paths can still degrade.
   */
  yahooDerivedIndicatorsReliable?: boolean;
  /** ADR-0502: Yahoo may be fetched for logging only when KIS official price is fresh. */
  yahooDiagnosticOnly?: boolean;
  /** ADR-0502: prevent Yahoo diagnostic divergence from degrading Gate/Stage evaluators. */
  noProviderDegrade?: boolean;
  priceProvider?: 'KIS_PRICE' | 'YAHOO' | 'CACHE';
  /**
   * ADR-0411 — KIS recovery 진단 메타.
   * KIS price recovery 적용 시 `{ source: 'KIS_REALTIME', divergencePct, recoveredAt }` 영속.
   * UI/`/health` /운영자 진단용. 미설정 (정상 흐름) 시 undefined.
   */
  yahooKisRecovery?: {
    readonly originalYahooPrice: number;
    readonly recoveredKisPrice: number;
    readonly divergencePct: number;
    readonly recoveredAt: string; // ISO
  };
}

// 스크리너·시그널·리포트가 같은 분 안에 동일 심볼을 여러 번 조회하므로
// 5분 TTL로만 묶어도 호출 수가 대폭 줄어든다. null 은 캐싱하지 않는다(일시 실패 재시도 허용).
const YAHOO_QUOTE_CACHE_TTL_MS = 5 * 60 * 1000;

const YAHOO_STALE_QUARANTINE_MIN_TTL_MS = 6 * 60 * 60 * 1000;
const YAHOO_STALE_QUARANTINE_DAYS = 5;
const _yahooStaleQuarantine = new Map<string, { until: number; lastClose: string; staleDays: number; suffix: string }>();

function normalizeYahooQuarantineCode(symbolOrCode: string): string {
  const m = (symbolOrCode ?? '').match(/^(\d{6})(?:\.K[SQ])?$/);
  return m ? m[1] : symbolOrCode;
}

function yahooSuffix(symbol: string): string {
  return symbol.endsWith('.KQ') ? 'KQ' : symbol.endsWith('.KS') ? 'KS' : '';
}

export function isYahooStaleQuarantined(symbolOrCode: string): boolean {
  const key = normalizeYahooQuarantineCode(symbolOrCode);
  const record = _yahooStaleQuarantine.get(key);
  if (!record) return false;
  if (Date.now() >= record.until) {
    _yahooStaleQuarantine.delete(key);
    return false;
  }
  return true;
}

export function getYahooStaleQuarantineRemainingMs(symbolOrCode: string): number {
  const key = normalizeYahooQuarantineCode(symbolOrCode);
  const record = _yahooStaleQuarantine.get(key);
  if (!record) return 0;
  const remaining = record.until - Date.now();
  if (remaining <= 0) {
    _yahooStaleQuarantine.delete(key);
    return 0;
  }
  return remaining;
}

function maybeQuarantineYahooStale(input: {
  symbol: string;
  lastCloseIso: string;
  staleDays: number;
}): void {
  if (input.staleDays < YAHOO_STALE_QUARANTINE_DAYS) return;
  const code = normalizeYahooQuarantineCode(input.symbol);
  if (!/^\d{6}$/.test(code)) return;
  const ttlMs = msUntilKstMarketCloseOrMin(YAHOO_STALE_QUARANTINE_MIN_TTL_MS);
  const existing = _yahooStaleQuarantine.get(code);
  const until = Date.now() + ttlMs;
  if (!existing || existing.until < until) {
    _yahooStaleQuarantine.set(code, {
      until,
      lastClose: input.lastCloseIso,
      staleDays: input.staleDays,
      suffix: yahooSuffix(input.symbol),
    });
    console.warn(
      `[YAHOO_STALE_QUARANTINED]\n`
      + `symbol=${code}\n`
      + `suffix=${yahooSuffix(input.symbol)}\n`
      + `lastClose=${input.lastCloseIso}\n`
      + `staleDays=${input.staleDays}\n`
      + `ttlMs=${ttlMs}\n`
      + `executionImpact=NONE\n`
      + `marketSignal=false\n`
      + `providerIssue=true`,
    );
  }
}

const _yahooQuoteCache = new Map<string, { data: YahooQuoteExtended; ts: number }>();

function buildKisPrimaryQuoteFromIntraday(
  symbol: string,
  kis: {
    price: number;
    dayOpen: number;
    prevClose: number;
    volume: number;
    high?: number | null;
    low?: number | null;
    changePercent?: number | null;
    tradingValue?: number | null;
    asOf?: string | null;
    providerStatus?: string;
    dataConfidence?: string;
    marketDivCode?: string | null;
    kisOfficialQuote?: unknown;
  },
): YahooQuoteExtended {
  const changePercent = kis.prevClose > 0 ? ((kis.price - kis.prevClose) / kis.prevClose) * 100 : 0;
  const quote: YahooQuoteExtended & Record<string, unknown> = {
    price: Math.round(kis.price),
    dayOpen: Math.round(kis.dayOpen > 0 ? kis.dayOpen : kis.price),
    prevClose: Math.round(kis.prevClose > 0 ? kis.prevClose : kis.price),
    changePercent: parseFloat(changePercent.toFixed(2)),
    volume: kis.volume,
    avgVolume: kis.volume,
    ma5: 0,
    ma20: 0,
    ma60: 0,
    high5d: kis.price,
    high20d: kis.price,
    high60d: kis.price,
    atr: 0,
    atr20avg: 0,
    per: 0,
    rsi14: 50,
    macd: 0,
    macdSignal: 0,
    macdHistogram: 0,
    rsi5dAgo: 50,
    weeklyRSI: 50,
    ma60TrendUp: false,
    macd5dHistAgo: 0,
    return5d: 0,
    return20d: 0,
    recentCloses10d: [kis.price],
    recentHighs10d: [kis.price],
    recentLows10d: [kis.price],
    recentVolumes10d: [kis.volume],
    bbWidthCurrent: 0,
    bbWidth20dAvg: 0,
    vol5dAvg: kis.volume,
    vol20dAvg: kis.volume,
    atr5d: 0,
    monthlyAboveEMA12: false,
    monthlyEMARising: false,
    weeklyAboveCloud: false,
    weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false,
    isHighRisk: false,
    priceMetadata: {
      value: kis.price,
      asOf: kis.asOf ?? new Date().toISOString(),
      source: 'KIS_REALTIME',
    },
    dataQuality: 'KIS_PRIMARY',
    yahooDerivedIndicatorsReliable: true,
    yahooDiagnosticOnly: true,
    noProviderDegrade: true,
    priceProvider: 'KIS_PRICE',
  };
  quote.currentPrice = kis.price;
  quote.open = kis.dayOpen;
  if (kis.high != null) {
    quote.high = kis.high;
    quote.dayHigh = kis.high;
  }
  if (kis.low != null) {
    quote.low = kis.low;
    quote.dayLow = kis.low;
  }
  if (kis.tradingValue != null) quote.tradingValue = kis.tradingValue;
  quote.provider = 'KIS_OFFICIAL';
  quote.quoteProvider = 'KIS_OFFICIAL';
  quote.providerStatus = kis.providerStatus;
  quote.dataConfidence = kis.dataConfidence;
  quote.marketDivCode = kis.marketDivCode ?? 'J';
  quote.symbol = normalizeYahooQuarantineCode(symbol);
  quote.kisOfficialQuote = kis.kisOfficialQuote;
  quote.kisOfficialEndpoint = '/uapi/domestic-stock/v1/quotations/inquire-price';
  quote.kisOfficialTrId = 'FHKST01010100';
  if (kis.asOf != null) quote.asOf = kis.asOf;
  _yahooQuoteCache.set(symbol, { data: quote, ts: Date.now() });
  return quote;
}

export async function fetchYahooQuote(symbol: string): Promise<YahooQuoteExtended | null> {
  const cached = _yahooQuoteCache.get(symbol);
  if (cached && Date.now() - cached.ts < YAHOO_QUOTE_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const krMatch = symbol.match(/^(\d{6})\.K[SQ]$/);
    const krCode = krMatch ? krMatch[1] : null;
    const kisSnap = krCode ? await fetchKisIntraday(krCode).catch(() => null) : null;
    const kisPriceFresh = !!(kisSnap && kisSnap.price > 0);

    // ADR-0082 — Yahoo range 전역 ≤1y 정책. 1y = 252영업일은 MA60+5일전MA60(65일) /
    // ATR14 / BB20 / 주봉 RSI(9, 45영업일) / 60일 최고가 / 5일·20일 수익률 모두 충분.
    // 13개월 월봉은 12개월로 graceful (KIS MTAS 보강 별도). 사용자 명시 "2y 금지".
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;
    const res = await guardedFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }, 'HISTORICAL');
    if (!res.ok) return kisPriceFresh ? buildKisPrimaryQuoteFromIntraday(symbol, kisSnap!) : null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return kisPriceFresh ? buildKisPrimaryQuoteFromIntraday(symbol, kisSnap!) : null;

    const meta = result.meta;

    // ADR-0234: Yahoo 응답 self-identification 검증 — meta.symbol 이 요청 symbol 과
    // 일치하지 않으면 응답 폐기. Yahoo 측 심볼 매핑 결함 (예: 신규상장/병합/폐지
    // 후 다른 종목 데이터 반환) 자동 차단. 호출자는 null 받아 fallback 트리거.
    const respondedSymbol = (meta as { symbol?: string } | undefined)?.symbol;
    if (respondedSymbol && respondedSymbol !== symbol) {
      console.warn(
        `[yahooQuoteAdapter] 심볼 불일치 — 요청=${symbol} 응답=${respondedSymbol}. ` +
        `Yahoo 측 심볼 매핑 결함 의심 — 응답 폐기 (ADR-0234).`,
      );
      return kisPriceFresh ? buildKisPrimaryQuoteFromIntraday(symbol, kisSnap!) : null;
    }

    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const rawHighs: (number | null)[]  = result.indicators?.quote?.[0]?.high ?? [];
    const rawLows: (number | null)[]   = result.indicators?.quote?.[0]?.low ?? [];
    const rawVolumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];
    // ADR-0028 §PR-D3-D: Yahoo timestamps[] (Unix sec) — close 인덱스와 1:1 매칭.
    // null close 와 같이 필터링해 closes 와 closeTimestamps 의 인덱스 정합 보장.
    const rawTimestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];

    // null 값 제거한 유효 데이터 — closes 외 배열은 기존 독립 필터 유지 (회귀 위험 격리).
    // closes 와 closeTimestamps 만 함께 필터링해 인덱스 정합 보장 (PR-D3-D PriceBase asOf 산출용).
    const closes: number[] = [];
    const closeTimestamps: number[] = [];
    for (let i = 0; i < rawCloses.length; i += 1) {
      const c = rawCloses[i];
      if (c == null || c <= 0) continue;
      closes.push(c);
      // timestamp 부재 시 0 placeholder — PriceBase 생성 시 0 → fetch 시점 fallback
      closeTimestamps.push(typeof rawTimestamps[i] === 'number' && Number.isFinite(rawTimestamps[i])
        ? rawTimestamps[i]
        : 0);
    }
    const highs   = rawHighs.filter((v): v is number => v != null && v > 0);
    const lows    = rawLows.filter((v): v is number => v != null && v > 0);
    const volumes = rawVolumes.filter((v): v is number => v != null && v > 0);

    // ADR-0028 §PR-D3-D: PriceBase asOf 산출 헬퍼 — closeTimestamps 정의 직후 노출.
    // changePercent / return5d / return20d 모두 사용. 0 placeholder 시 fetch 시점 fallback.
    const fetchTime = new Date().toISOString();
    const isoFromCloseIdx = (idx: number): string => {
      const ts = closeTimestamps[idx];
      return typeof ts === 'number' && ts > 0
        ? new Date(ts * 1000).toISOString()
        : fetchTime;
    };

    if (closes.length < 5) return null;
    const lastCloseIdx = closes.length - 1;
    const lastCloseIso = isoFromCloseIdx(lastCloseIdx);
    const staleDays = Math.floor((Date.now() - new Date(lastCloseIso).getTime()) / 86_400_000);
    if (Number.isFinite(staleDays)) {
      maybeQuarantineYahooStale({ symbol, lastCloseIso, staleDays });
    }

    // ADR-0235: closeTimestamps 최신성 검증 — 마지막 close 가 7일 이상 stale 이면
    // 응답 폐기. Yahoo 가 거래정지/상장폐지/장기 휴장 종목에 *과거 시계열* 을
    // 그대로 반환하는 케이스 (사용자 보고 "5개월 stale" 패턴) 자동 차단.
    // 호출자는 null 받아 fallback 트리거 (KIS quote / 양쪽 시도).
    const lastTimestamp = closeTimestamps[closeTimestamps.length - 1];
    if (lastTimestamp > 0) {
      const lastDataAge = Date.now() - lastTimestamp * 1000;
      const MAX_DATA_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7일
      if (lastDataAge > MAX_DATA_AGE_MS) {
        console.warn(
          `[yahooQuoteAdapter] ${symbol} 시계열 stale — ` +
          `마지막 close = ${new Date(lastTimestamp * 1000).toISOString()} ` +
          `(${(lastDataAge / 86400_000).toFixed(0)}일 전). 응답 폐기 (ADR-0235).`,
        );
        return null;
      }
    }

    // ADR-0028 §모순 보강: Yahoo 가 KRX 종목 일부에 regularMarketPrice=0 응답하는
    // 케이스 차단. validPrice chain 이 0/NaN/음수 모두 null → 다음 fallback 시도.
    // 모두 실패하면 함수 자체 null 반환 (호출자에게 PRICE_MISSING 신호).
    // ADR-0411: `let` 으로 변경 — Yahoo↔KIS 50% 초과 괴리 시 KIS 가격 채택 (recovery).
    let price = validPrice(meta.regularMarketPrice)
      ?? validPrice(closes[closes.length - 1]);
    if (price === null) {
      console.warn(
        `[yahooQuoteAdapter] ${symbol} price=null — Yahoo regularMarketPrice ` +
        `(raw=${meta.regularMarketPrice}) 누락 + closes 부재. PRICE_MISSING.`,
      );
      return null;
    }

    // ADR-0221: prevClose 출처 위계 재정립 — KIS 1차 / Yahoo 2차 fallback.
    // 휴장 클러스터 직후 (5/1·5/5·추석 등) Yahoo meta 의 prevClose 가 calendar
    // gap stale base 를 반환해 STALE_BASE 누적 위반 / +121% 같은 잘못된
    // changePercent 산출 결함 차단. KIS API 는 KRX 거래일 캘린더 기반이므로
    // 직전 거래일 종가가 정확. KIS 실패 시에만 Yahoo fallback.
    const yahooMetaPrev = validPrice(meta.regularMarketPreviousClose);
    const yahooClosesPrev = validPrice(closes[closes.length - 2]);
    const yahooChartPrev = validPrice((meta as { chartPreviousClose?: number }).chartPreviousClose);

    let prevClose: number | null = null;
    let prevCloseAsOf = '';
    let prevCloseSource: PriceSource = 'YAHOO_HISTORICAL';

    // ADR-0263 (원안) → ADR-0411 (개정): KIS vs Yahoo *현재가* 50% 초과 괴리 처리 정책 변경.
    // 기존 `return null` (마스터 매핑 결함 의심 → 응답 폐기) 은 Yahoo 가 분할/증자/정정 직후
    // stale price 를 반환하는 *데이터 품질* 케이스에서도 universe 에서 종목을 통째로 제거 →
    // 정상 종목 손실 + dataQuality marker 도 부재 → 운영자가 사라진 이유 추적 불가.
    //
    // ADR-0411 정책: divergence > 50% 시 KIS 현재가 채택 (recovery) + dataQuality marker
    // (`KIS_PRIMARY_YAHOO_STALE_DETECTED`) + `yahooDerivedIndicatorsReliable=false` →
    // registry.run 이 시계열 의존 evaluator (momentum/MA/VCP/...) 자동 PROVIDER_DEGRADED 강등 →
    // 호출자(perSymbolEvaluation)가 WATCHLIST_HOLD 정책으로 보유만 / 신규 진입 차단.
    //
    // ENV `YAHOO_KIS_PRICE_DIVERGENCE_DISABLED=true` 우회 (default OFF, ADR-0157 정합) — 기존 동작.
    // ENV `ADR_0411_KIS_RECOVERY_DISABLED=true` 시 ADR-0263 원안 동작 (return null) 복원 — 회귀 안전장치.
    let yahooKisDiverged = false;
    let yahooKisRecoveryMeta: YahooQuoteExtended['yahooKisRecovery'] = undefined;
    let priceSource: PriceSource = 'YAHOO_INTRADAY';
    let yahooDiagnosticOnly = false;
    let noProviderDegrade = false;
    if (kisPriceFresh) {
      const divergence = Math.abs(price - kisSnap!.price) / kisSnap!.price;
      const originalYahooPrice = price;
      const divergencePct = divergence * 100;
      price = kisSnap!.price;
      priceSource = 'KIS_REALTIME';
      yahooDiagnosticOnly = true;
      noProviderDegrade = true;
      if (divergence > 0.5) {
        console.warn(
          `[yahooQuoteAdapter] ${symbol} Yahoo/KIS ${divergencePct.toFixed(1)}% divergence ` +
          `(Yahoo=${originalYahooPrice}, KIS=${kisSnap!.price}) -> KIS official price primary; ` +
          `yahooDiagnosticOnly=true; noProviderDegrade=true.`,
        );
        yahooKisDiverged = true;
        yahooKisRecoveryMeta = {
          originalYahooPrice,
          recoveredKisPrice: kisSnap!.price,
          divergencePct,
          recoveredAt: new Date().toISOString(),
        };
      } else if (process.env.DEBUG_PRICE_DIVERGENCE === 'true') {
        console.info(
          `[yahooQuoteAdapter] ${symbol} KIS official price primary; ` +
          `Yahoo diagnostic divergence=${divergencePct.toFixed(1)}%; noProviderDegrade=true.`,
        );
      }
    }
    if (kisSnap && kisSnap.prevClose > 0) {
      // KIS 채택 — KRX 거래일 캘린더 기반 직전 거래일 종가 (장 마감 15:30 KST).
      prevClose = kisSnap.prevClose;
      prevCloseAsOf = `${previousKrxTradingDay(new Date())}T15:30:00+09:00`;
      prevCloseSource = 'KIS_REALTIME';

      // Yahoo 값과 비교 — 5% 초과 괴리 시 진단 로그 (영속 변경 0, 진단만).
      if (yahooMetaPrev && Math.abs((yahooMetaPrev - kisSnap.prevClose) / kisSnap.prevClose) > 0.05) {
        console.warn(
          `[yahooQuoteAdapter] ${symbol} KIS prevClose=${kisSnap.prevClose} ` +
          `vs Yahoo meta=${yahooMetaPrev} 괴리 5%↑ — KIS 채택 ` +
          `(휴장 클러스터 고립 거래일 추정, ADR-0221)`,
        );
      }
    } else {
      // KIS 실패/미연동/비KR 종목 → Yahoo fallback (기존 chain).
      prevClose = yahooMetaPrev ?? yahooClosesPrev ?? yahooChartPrev;
      prevCloseAsOf = closes.length >= 2
        ? isoFromCloseIdx(closes.length - 2)
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      prevCloseSource = 'YAHOO_HISTORICAL';
    }

    const dayOpen = kisPriceFresh
      ? (kisSnap!.dayOpen > 0 ? kisSnap!.dayOpen : price)
      : validPrice(meta.regularMarketOpen) ?? price;

    // ADR-0028: prevClose 가 null 이면 changePercent 계산 자체 미수행 — 0 fallback 차단.
    // safePctChange 가 -100% 패턴을 만들지 못하도록 입력 단계에서 차단.
    //
    // PR-D3-D-2: prevClose 도 PriceBase 로 전달 — DAILY 모드 (50% 임계) + stale 자동 차단.
    // 사용자 보고 +121.36% / +217.24% 같은 changePercent 위반 패턴 (전일 +30% 상한가
    // 초과 = 상한가+갭 조합도 50% 안) 자동 차단.
    //
    // ADR-0091 PR-Z4: safePctChangeDetailed 로 전환 — `?? 0` silent fallback 제거.
    // valid=false 시 dataQualityIssues 에 'changePercent' 누적 + 후속 KIS 폴백 wiring.
    //
    // ADR-0221: source 동적화 — KIS_REALTIME / YAHOO_HISTORICAL 분기.
    const dataQualityIssues: Array<'changePercent' | 'return5d' | 'return20d'> = [];
    let changePercent = 0;
    if (prevClose !== null) {
      const result = safePctChangeDetailed(price, {
        value: prevClose,
        asOf: prevCloseAsOf,
        source: prevCloseSource,
      }, {
        label: `yahooQuoteAdapter.changePercent:${symbol}`,
        mode: 'DAILY',
      });
      if (result.valid) {
        changePercent = result.value;
      } else {
        dataQualityIssues.push('changePercent');
      }
    }
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

    // ADR-0028 §PR-D3-D: PriceBase 객체로 base 전달 — stale 자동 차단.
    // 사용자 보고 +443% 시나리오 (close20dAgo 가 *6개월 전* 가격) → asOf 가
    // 30일 임계 (RECOMMENDATION_RETURN) 초과 시 STALE_BASE null 반환.

    // 직전 5거래일 수익률 — Regret Asymmetry Filter용
    // ADR-0028 §모드: 5일 수익률은 *테마주 폭등* (예: 광무, 이수페타시스) 에서 정상
    // +100~+200% 가능 → RECOMMENDATION_RETURN 300% 임계 + PriceBase stale 차단 결합.
    // ADR-0091 PR-Z4: detailed 결과 valid=false 시 dataQualityIssues 누적.
    const close5dAgoIdx = closes.length > 5 ? closes.length - 6 : 0;
    const close5dAgo = closes[close5dAgoIdx];
    const return5dResult = safePctChangeDetailed(price, {
      value: close5dAgo,
      asOf: isoFromCloseIdx(close5dAgoIdx),
      source: 'YAHOO_HISTORICAL',
    }, {
      label: `yahooQuoteAdapter.return5d:${symbol}`,
      mode: 'RECOMMENDATION_RETURN',
    });
    const return5d = return5dResult.valid ? return5dResult.value : 0;
    if (!return5dResult.valid) dataQualityIssues.push('return5d');

    // 직전 20거래일 수익률 — Gate 24 상대강도(vs KOSPI 20d) 입력
    // PR-D3-D: 사용자 보고 +443% 시나리오는 base.asOf 가 30일 초과 → STALE_BASE 차단.
    const close20dAgoIdx = closes.length > 20 ? closes.length - 21 : 0;
    const close20dAgo = closes[close20dAgoIdx];
    const return20dResult = safePctChangeDetailed(price, {
      value: close20dAgo,
      asOf: isoFromCloseIdx(close20dAgoIdx),
      source: 'YAHOO_HISTORICAL',
    }, {
      label: `yahooQuoteAdapter.return20d:${symbol}`,
      mode: 'RECOMMENDATION_RETURN',
    });
    const return20d = return20dResult.valid ? return20dResult.value : 0;
    if (!return20dResult.valid) dataQualityIssues.push('return20d');

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

    const quote: YahooQuoteExtended & Record<string, unknown> = {
      price: Math.round(price), changePercent, volume, avgVolume,
      dayOpen: Math.round(dayOpen),
      // prevClose 가 null 이면 0 표기 (changePercent 는 이미 0). UI/메시지 표시용 안전 fallback.
      prevClose: prevClose !== null ? Math.round(prevClose) : 0,
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
      // ADR-0028 §PR-D3-B: 가격 출처+시점 메타 — Yahoo regularMarketTime 우선, 없으면 fetch 시점.
      // ADR-0411: priceSource 동적화 — KIS recovery 시 KIS_REALTIME, 그 외 YAHOO_INTRADAY.
      priceMetadata: {
        value: price,
        asOf: yahooKisDiverged
          ? new Date().toISOString() // KIS recovery 시 fetch 시점 사용 (Yahoo regularMarketTime 신뢰성 손상)
          : (typeof meta.regularMarketTime === 'number' && Number.isFinite(meta.regularMarketTime)
            ? new Date(meta.regularMarketTime * 1000).toISOString()
            : new Date().toISOString()),
        source: priceSource,
      },
      // ADR-0091 PR-Z4 + ADR-0411: dataQuality 우선순위 SSOT —
      // (1) KIS recovery 적용 → 'KIS_PRIMARY_YAHOO_STALE_DETECTED' (최우선, base price 자체가 KIS 라
      //     Yahoo 시계열 derived 지표 모두 신뢰성 손상).
      // (2) Yahoo 변화율 sanity 위반 → 'STALE_BASE' (base 는 Yahoo 인데 changePercent/return5d/20d 위반).
      // (3) 정상 → 'OK'.
      dataQuality: kisPriceFresh
        ? (yahooKisDiverged
          ? 'KIS_PRIMARY_YAHOO_STALE_DETECTED'
          : dataQualityIssues.length > 0
            ? 'KIS_PRIMARY_YAHOO_DIAGNOSTIC_STALE'
            : 'KIS_PRIMARY')
        : (dataQualityIssues.length > 0
          ? 'STALE_BASE'
          : krCode ? 'YAHOO_FALLBACK_KIS_MISSING' : 'OK'),
      dataQualityIssues: dataQualityIssues.length > 0 ? dataQualityIssues : undefined,
      // ADR-0411: Yahoo 시계열 파생 지표 (MA/RSI/MACD/ATR/return5d/20d/BB폭/MTAS) 신뢰성.
      // KIS recovery 또는 STALE_BASE 시 false → registry 가 시계열 의존 evaluator 자동 강등.
      yahooDerivedIndicatorsReliable: kisPriceFresh ? true : dataQualityIssues.length === 0,
      yahooDiagnosticOnly,
      noProviderDegrade,
      priceProvider: kisPriceFresh ? 'KIS_PRICE' : 'YAHOO',
      // ADR-0411: KIS recovery 진단 메타 — 미적용 시 undefined.
      yahooKisRecovery: yahooKisRecoveryMeta,
    };
    if (kisPriceFresh && kisSnap) {
      quote.currentPrice = kisSnap.price;
      quote.open = kisSnap.dayOpen;
      if (kisSnap.high != null) {
        quote.high = kisSnap.high;
        quote.dayHigh = kisSnap.high;
      }
      if (kisSnap.low != null) {
        quote.low = kisSnap.low;
        quote.dayLow = kisSnap.low;
      }
      if (kisSnap.tradingValue != null) quote.tradingValue = kisSnap.tradingValue;
      quote.provider = 'KIS_OFFICIAL';
      quote.quoteProvider = 'KIS_OFFICIAL';
      quote.providerStatus = kisSnap.providerStatus;
      quote.dataConfidence = kisSnap.dataConfidence;
      quote.marketDivCode = kisSnap.marketDivCode ?? 'J';
      quote.symbol = normalizeYahooQuarantineCode(symbol);
      quote.kisOfficialQuote = kisSnap.kisOfficialQuote;
      quote.kisOfficialEndpoint = '/uapi/domestic-stock/v1/quotations/inquire-price';
      quote.kisOfficialTrId = 'FHKST01010100';
      if (kisSnap.asOf != null) quote.asOf = kisSnap.asOf;
    }
    _yahooQuoteCache.set(symbol, { data: quote, ts: Date.now() });
    return quote;
  } catch (e) {
    console.error(`[fetchYahooQuote] ${symbol}:`, e instanceof Error ? e.message : e);
    return null;
  }
}
