/**
 * dxyIntradayClient.ts — DXY 인트라데이 가격 조회 (P3-7 구현)
 *
 * 사용자 P3-7 의견:
 *   "Forex API (Alpha Vantage, OANDA, Fixer.io) WebSocket 또는 1분 폴링"
 *   "DXY ±0.4% 인트라데이 변화 감지 시 즉시 선행 경보"
 *
 * 데이터 소스 우선순위:
 *   1) Yahoo Finance — DX-Y.NYB?interval=5m (무료, 키 불필요, 5분 봉)
 *   2) Alpha Vantage  — 합성 DXY (USD/EUR + USD/JPY + GBP/USD + USD/CAD + USD/SEK + USD/CHF)
 *      ALPHA_VANTAGE_API_KEY 필요. 5 calls/min, 500/day (free tier).
 *
 * Yahoo 가 살아 있으면 Alpha Vantage 는 호출 안 함 — 쿼터 절약.
 *
 * DXY 합성 공식 (1973년 ICE 표준):
 *   DXY = 50.14348112 ×
 *         (EUR/USD)^-0.576 ×
 *         (USD/JPY)^0.136  ×
 *         (GBP/USD)^-0.119 ×
 *         (USD/CAD)^0.091  ×
 *         (USD/SEK)^0.042  ×
 *         (USD/CHF)^0.036
 */

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

export interface IntradayBar {
  /** Unix epoch ms */
  ts: number;
  close: number;
}

// ── Yahoo intraday ───────────────────────────────────────────────────────────

/**
 * Yahoo Finance 인트라데이 봉 (DXY 또는 임의 심볼).
 * interval 은 '1m'/'2m'/'5m'/'15m'/'30m'/'60m', range 는 '1d'/'5d'/'1mo'.
 * 야간 시간대(미국 장 휴장)에 호출하면 직전 영업일 데이터가 반환된다.
 */
export async function fetchYahooIntradayBars(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '30m' | '60m' = '5m',
  range: '1d' | '5d' | '1mo' = '1d',
): Promise<IntradayBar[] | null> {
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(url, { headers: YF_HEADERS, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json() as {
        chart?: { result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }> }
      };
      const result = data?.chart?.result?.[0];
      const ts = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const bars: IntradayBar[] = [];
      for (let i = 0; i < closes.length; i++) {
        const c = closes[i];
        const t = ts[i];
        if (c != null && Number.isFinite(c) && typeof t === 'number') {
          bars.push({ ts: t * 1000, close: c });
        }
      }
      if (bars.length > 0) return bars;
    } catch { /* try next */ }
  }
  return null;
}

// ── Alpha Vantage 합성 DXY (fallback) ────────────────────────────────────────

const AV_BASE = 'https://www.alphavantage.co/query';

interface AvRateResponse {
  'Realtime Currency Exchange Rate'?: {
    '5. Exchange Rate'?: string;
    '6. Last Refreshed'?: string;
  };
  'Note'?: string;
  'Information'?: string;
}

/** Alpha Vantage 단일 환율 조회 — 5xx/429/Note 메시지를 모두 null 로 처리. */
async function fetchAvRate(from: string, to: string): Promise<number | null> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!apiKey) return null;
  const url = `${AV_BASE}?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${apiKey}`;
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json() as AvRateResponse;
    if (data.Note || data.Information) {
      // free tier rate-limit 안내가 들어오면 즉시 포기
      console.warn(`[DxyIntraday/AlphaVantage] rate-limit hit: ${data.Note ?? data.Information}`);
      return null;
    }
    const rateStr = data['Realtime Currency Exchange Rate']?.['5. Exchange Rate'];
    const rate = rateStr ? parseFloat(rateStr) : NaN;
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * Alpha Vantage 의 6 환율을 동시 조회해 ICE 표준 공식으로 DXY 합성.
 * 6번의 호출이 필요하므로 free tier (5/min) 에서 실패 가능 — 호출자는 null 처리.
 */
export async function fetchAvSyntheticDxy(): Promise<number | null> {
  // EUR/USD 와 GBP/USD 는 base 가 EUR/GBP. 다른 4개는 base USD.
  const [eurUsd, usdJpy, gbpUsd, usdCad, usdSek, usdChf] = await Promise.all([
    fetchAvRate('EUR', 'USD'),
    fetchAvRate('USD', 'JPY'),
    fetchAvRate('GBP', 'USD'),
    fetchAvRate('USD', 'CAD'),
    fetchAvRate('USD', 'SEK'),
    fetchAvRate('USD', 'CHF'),
  ]);
  if (eurUsd == null || usdJpy == null || gbpUsd == null || usdCad == null || usdSek == null || usdChf == null) {
    return null;
  }
  // ICE DXY 공식
  const dxy = 50.14348112
    * Math.pow(eurUsd, -0.576)
    * Math.pow(usdJpy,  0.136)
    * Math.pow(gbpUsd, -0.119)
    * Math.pow(usdCad,  0.091)
    * Math.pow(usdSek,  0.042)
    * Math.pow(usdChf,  0.036);
  return Number.isFinite(dxy) && dxy > 0 ? Number(dxy.toFixed(3)) : null;
}

// ── 인트라데이 변화율 계산 ──────────────────────────────────────────────────

export interface DxyIntradayReading {
  source: 'YAHOO' | 'ALPHA_VANTAGE' | 'NONE';
  asOf:   string;       // ISO timestamp
  last:   number;
  /** 직전 N분 대비 변화율(%). N 은 호출 시점에 옵션. */
  changeWindowPct: number;
  /** 비교 기준 시각 (windowMinutes 전) */
  windowStartedAt: string;
  /** 사용된 비교 윈도우(분) */
  windowMinutes: number;
}

/**
 * Yahoo 우선, 실패 시 Alpha Vantage 합성으로 DXY 인트라데이 리딩 1건 반환.
 * Yahoo 는 N 분 윈도우 이전 봉과 직접 비교.
 * Alpha Vantage 는 단일 스냅샷이라 변화율은 0 (호출자가 외부 캐시로 비교).
 */
export async function getDxyIntradayReading(windowMinutes = 30): Promise<DxyIntradayReading | null> {
  // 1) Yahoo 5분봉 — windowMinutes 분 만큼 이전 봉과 비교
  const yahoo = await fetchYahooIntradayBars('DX-Y.NYB', '5m', '1d').catch(() => null);
  if (yahoo && yahoo.length >= 2) {
    const last = yahoo[yahoo.length - 1];
    const targetTs = last.ts - windowMinutes * 60_000;
    // 가장 가까운 과거 봉 (>= targetTs 이전 중 최신)
    let basis = yahoo[0];
    for (const bar of yahoo) {
      if (bar.ts <= targetTs) basis = bar;
      else break;
    }
    const change = basis.close > 0 ? ((last.close - basis.close) / basis.close) * 100 : 0;
    return {
      source: 'YAHOO',
      asOf: new Date(last.ts).toISOString(),
      last: Number(last.close.toFixed(3)),
      changeWindowPct: Number(change.toFixed(3)),
      windowStartedAt: new Date(basis.ts).toISOString(),
      windowMinutes,
    };
  }
  // 2) Alpha Vantage fallback — 단일 스냅샷
  const av = await fetchAvSyntheticDxy();
  if (av != null) {
    const now = new Date().toISOString();
    return {
      source: 'ALPHA_VANTAGE',
      asOf: now,
      last: av,
      changeWindowPct: 0,
      windowStartedAt: now,
      windowMinutes,
    };
  }
  return null;
}
