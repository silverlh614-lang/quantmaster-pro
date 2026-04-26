/**
 * @responsibility 외부 API(KIS·Yahoo) 응답 zod 스키마를 정의해 schemaSentinel 에 공급한다.
 *
 * Tier 2 #5 (PR-52 follow-up) — 스키마 정의는 본 모듈, 격리·차단·알림은 schemaSentinel.
 * KIS/Yahoo 응답 필드가 변경되면 본 모듈만 수정하면 된다.
 */

import { z } from 'zod';

// ─── KIS inquire-price (FHKST01010100) ──────────────────────────────────────────
//
// 실데이터/모의투자 공통. fetchCurrentPrice + fetchKisPrevClose + fetchStockName 가 사용.
// 핵심 필드: stck_prpr(현재가), stck_sdpr(전일종가), hts_kor_isnm(종목명).
// catchall(passthrough) 로 알 수 없는 필드는 보존하되, 핵심 필드만 검증.

export const kisInquirePriceSchema = z.object({
  output: z
    .object({
      stck_prpr: z.string().min(1),
      stck_sdpr: z.string().optional(),
      hts_kor_isnm: z.string().optional(),
    })
    .catchall(z.unknown()),
}).catchall(z.unknown());

export type KisInquirePriceResponse = z.infer<typeof kisInquirePriceSchema>;

// ─── Yahoo Finance v8 chart ─────────────────────────────────────────────────────
//
// `https://query2.finance.yahoo.com/v8/finance/chart/{symbol}?range=...&interval=...`
// fetchYahooQuote 가 사용. 정상 응답: chart.result[0].timestamp + indicators.quote[0]
// 에러 응답: chart.error 채워짐. error 케이스는 기존 코드가 별도 처리하므로 이 스키마는
// 정상 응답만 강제 — error 응답은 검증 통과 대상에서 제외 (기존 fetchYahooQuote 가
// `chart.error` 분기에서 null 반환하는 경로 보존).

const yahooQuoteSeriesSchema = z.object({
  open: z.array(z.number().nullable()),
  high: z.array(z.number().nullable()),
  low: z.array(z.number().nullable()),
  close: z.array(z.number().nullable()),
  volume: z.array(z.number().nullable()),
}).catchall(z.unknown());

// meta 는 Yahoo 공급 필드가 다양하고 변동이 잦아 record(string, unknown) 으로 보존.
// 호출자(stockScreener.fetchYahooQuote) 는 `regularMarketPrice` 등 일부 필드만 읽으므로
// 본 스키마는 형태만 보장하고 필드별 타입 강제는 호출자 책임으로 분리.
const yahooMetaSchema = z.record(z.string(), z.unknown()).optional();

export const yahooChartSchema = z.object({
  chart: z.object({
    result: z.array(
      z.object({
        timestamp: z.array(z.number()).optional(),
        indicators: z.object({
          quote: z.array(yahooQuoteSeriesSchema),
        }).catchall(z.unknown()),
        meta: yahooMetaSchema,
      }).catchall(z.unknown()),
    ).nullable(),
    error: z.unknown().nullable(),
  }).catchall(z.unknown()),
}).catchall(z.unknown());

export type YahooChartResponse = z.infer<typeof yahooChartSchema>;
