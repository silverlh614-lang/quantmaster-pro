// @responsibility koreanQuoteBridge 외부 클라이언트 모듈
/**
 * koreanQuoteBridge.ts — KRX 인증 API ↔ Yahoo Finance 이중화 브릿지.
 *
 * 목적:
 *   - 기존 야후 파이낸스로 제공하던 한국 주식/지수의 "일별 스냅샷" 데이터를,
 *     공식 KRX OpenAPI(인증)를 1차 소스로 사용하고, 실패·인증 미설정·서킷 OPEN 시
 *     Yahoo 로 자동 폴백한다.
 *   - 호출자는 소스가 무엇인지 신경쓰지 않고 `{ close, ... }` 를 받는다.
 *   - 동시에 `source` 필드에 어디서 왔는지 기록해 관측성을 보장한다.
 *
 * 왜 이중화인가?
 *   KRX API 는 승인·인증·일 10,000회 쿼터 제한이 있는 민감한 소스다.
 *   쿼터 소진·인증키 만료·KRX 점검 등으로 단절될 수 있으므로
 *   기존 Yahoo 경로를 "회로 차단기와 맞물린 대체 경로"로 남겨두어야 한다.
 *
 * 주요 함수:
 *   - fetchKoreanDailyQuote(code) — 6자리 종목코드의 최신 일봉 스냅샷.
 *   - fetchKoreanIndexDailyQuote(alias) — 'KOSPI' | 'KOSDAQ' 지수 일봉.
 */

import {
  fetchKospiDailyTrade,
  fetchKosdaqDailyTrade,
  fetchKospiIndexDaily,
  fetchKosdaqIndexDaily,
  isKrxOpenApiHealthy,
  type KrxStockDailyRow,
} from './krxOpenApi.js';
import { guardedFetch } from '../utils/egressGuard.js';

export type QuoteSource = 'krx-openapi' | 'yahoo' | 'none';

export interface KoreanDailyQuote {
  code: string;           // 6자리 종목코드 (지수는 지수명)
  name: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  change: number;
  changePct: number;
  baseDate: string;       // YYYYMMDD (KRX) 또는 빈 문자열(Yahoo meta 에는 없을 수 있음)
  source: QuoteSource;
  fetchedAt: string;      // ISO
}

const YAHOO_TIMEOUT_MS = 8_000;

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function isoNow(): string { return new Date().toISOString(); }

function emptyQuote(code: string): KoreanDailyQuote {
  return {
    code, name: '', close: 0, open: 0, high: 0, low: 0,
    volume: 0, change: 0, changePct: 0,
    baseDate: '', source: 'none', fetchedAt: isoNow(),
  };
}

// ── 주식 ─────────────────────────────────────────────────────────────────────

/**
 * 단일 종목의 최신 일봉 스냅샷.
 *
 *   1. KRX OpenAPI healthy → KOSPI/KOSDAQ 일별매매정보에서 code 매칭.
 *      (KRX는 마켓 전체 리스트라 한 번 호출 후 in-memory 인덱스)
 *   2. KRX 실패/없음 → Yahoo `chart` 엔드포인트 폴백.
 *   3. 전부 실패 → source: 'none' 스냅샷.
 */
export async function fetchKoreanDailyQuote(code: string): Promise<KoreanDailyQuote> {
  const cleanCode = String(code || '').trim().replace(/^[A-Z]/, '').slice(0, 6);
  if (!/^\d{6}$/.test(cleanCode)) return emptyQuote(code);

  if (isKrxOpenApiHealthy()) {
    const krxQuote = await fetchFromKrx(cleanCode);
    if (krxQuote) return krxQuote;
  }

  // 폴백: Yahoo. 한국 주식은 .KS(유가증권)·.KQ(코스닥) 접미사 둘 다 시도.
  const yahooQuote = await fetchFromYahoo(cleanCode);
  if (yahooQuote) return yahooQuote;

  return emptyQuote(cleanCode);
}

async function fetchFromKrx(code: string): Promise<KoreanDailyQuote | null> {
  // 두 시장을 병렬 조회 후 첫 hit 사용.
  const [kospi, kosdaq] = await Promise.all([
    fetchKospiDailyTrade().catch(() => [] as KrxStockDailyRow[]),
    fetchKosdaqDailyTrade().catch(() => [] as KrxStockDailyRow[]),
  ]);
  const row = kospi.find((r) => r.code === code) ?? kosdaq.find((r) => r.code === code);
  if (!row || row.close <= 0) return null;

  return {
    code: row.code,
    name: row.name,
    close: row.close,
    open: row.open,
    high: row.high,
    low: row.low,
    volume: row.volume,
    change: row.change,
    changePct: row.changePct,
    baseDate: row.baseDate,
    source: 'krx-openapi',
    fetchedAt: isoNow(),
  };
}

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        regularMarketPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        symbol?: string;
        longName?: string;
        shortName?: string;
      };
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
  };
}

async function fetchFromYahoo(code: string): Promise<KoreanDailyQuote | null> {
  for (const suffix of ['.KS', '.KQ']) {
    const symbol = `${code}${suffix}`;
    const quote = await fetchYahooSymbol(symbol);
    if (quote) return { ...quote, code };
  }
  return null;
}

async function fetchYahooSymbol(symbol: string): Promise<KoreanDailyQuote | null> {
  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
      const res = await guardedFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as YahooChart;
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const meta = result.meta ?? {};
      const q = result.indicators?.quote?.[0] ?? {};
      const lastIdx = (q.close ?? []).length - 1;
      const close =
        (typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null) ??
        (lastIdx >= 0 ? (q.close?.[lastIdx] ?? null) : null);
      if (close == null || close <= 0) continue;

      const prev =
        meta.regularMarketPreviousClose ??
        meta.previousClose ??
        null;

      return {
        code: symbol.replace(/\.[A-Z]+$/, ''),
        name: String(meta.shortName ?? meta.longName ?? ''),
        close,
        open: lastIdx >= 0 ? (q.open?.[lastIdx] ?? 0) : 0,
        high: meta.regularMarketDayHigh ?? (lastIdx >= 0 ? (q.high?.[lastIdx] ?? 0) : 0),
        low: meta.regularMarketDayLow ?? (lastIdx >= 0 ? (q.low?.[lastIdx] ?? 0) : 0),
        volume: meta.regularMarketVolume ?? (lastIdx >= 0 ? (q.volume?.[lastIdx] ?? 0) : 0),
        change: prev != null ? parseFloat((close - prev).toFixed(4)) : 0,
        changePct: prev != null && prev !== 0 ? parseFloat((((close - prev) / prev) * 100).toFixed(4)) : 0,
        baseDate: '',
        source: 'yahoo',
        fetchedAt: isoNow(),
      };
    } catch {
      /* try next host */
    }
  }
  return null;
}

// ── 지수 ─────────────────────────────────────────────────────────────────────

export type KoreanIndexAlias = 'KOSPI' | 'KOSDAQ';

/**
 * 대표 지수(KOSPI / KOSDAQ) 일봉 스냅샷.
 * KRX는 지수명(IDX_NM)이 '코스피' / '코스닥' 으로 들어있으므로 alias 매핑.
 */
export async function fetchKoreanIndexDailyQuote(alias: KoreanIndexAlias): Promise<KoreanDailyQuote> {
  if (isKrxOpenApiHealthy()) {
    const rows =
      alias === 'KOSPI'
        ? await fetchKospiIndexDaily().catch(() => [])
        : await fetchKosdaqIndexDaily().catch(() => []);
    const targetKo = alias === 'KOSPI' ? '코스피' : '코스닥';
    const row =
      rows.find((r) => r.indexName === targetKo) ??
      rows.find((r) => r.indexName.trim() === targetKo) ??
      rows[0];
    if (row && row.close > 0) {
      return {
        code: row.indexCode || alias,
        name: row.indexName || alias,
        close: row.close,
        open: row.open,
        high: row.high,
        low: row.low,
        volume: row.volume,
        change: row.change,
        changePct: row.changePct,
        baseDate: row.baseDate,
        source: 'krx-openapi',
        fetchedAt: isoNow(),
      };
    }
  }

  // Yahoo 폴백: ^KS11 (KOSPI), ^KQ11 (KOSDAQ).
  const symbol = alias === 'KOSPI' ? '^KS11' : '^KQ11';
  const q = await fetchYahooSymbol(symbol);
  if (q) return { ...q, code: alias, name: q.name || alias };
  return emptyQuote(alias);
}
