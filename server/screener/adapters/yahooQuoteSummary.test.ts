// @responsibility yahooQuoteSummary 어댑터 회귀 — ADR-0536 C18 Phase 1 ENV/캐시/스키마/폴백/실패-soft
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../utils/egressGuard.js', () => ({
  guardedFetch: vi.fn(),
}));

const { guardedFetch } = await import('../../utils/egressGuard.js');
const { fetchYahooQuoteSummary, __resetYahooQuoteSummaryCacheForTest } =
  await import('./yahooQuoteSummary.js');

const ORIGINAL_ENV = process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED;

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeFundamentalsBody(opts: { trailingPE?: number; priceToBook?: number; trailingEps?: number; forwardPE?: number }) {
  return {
    quoteSummary: {
      result: [{
        summaryDetail: opts.trailingPE != null ? { trailingPE: { raw: opts.trailingPE } } : {},
        defaultKeyStatistics: {
          ...(opts.forwardPE != null ? { forwardPE: { raw: opts.forwardPE } } : {}),
          ...(opts.priceToBook != null ? { priceToBook: { raw: opts.priceToBook } } : {}),
          ...(opts.trailingEps != null ? { trailingEps: { raw: opts.trailingEps } } : {}),
        },
      }],
      error: null,
    },
  };
}

describe('fetchYahooQuoteSummary (ADR-0536 C18 Phase 1)', () => {
  beforeEach(() => {
    __resetYahooQuoteSummaryCacheForTest();
    (guardedFetch as any).mockReset();
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED;
    else process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = ORIGINAL_ENV;
  });

  it('ENV 미설정(default OFF) — 외부 호출 0건 + null', async () => {
    delete process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED;
    const r = await fetchYahooQuoteSummary('005930');
    expect(r).toBeNull();
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it('ENV=false — 외부 호출 0건 + null (byte-equivalent OFF)', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'false';
    const r = await fetchYahooQuoteSummary('005930');
    expect(r).toBeNull();
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it('형식 위반(6자리 숫자 아님) — null + 외부 호출 0건', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    expect(await fetchYahooQuoteSummary('5930')).toBeNull();
    expect(await fetchYahooQuoteSummary('AAPL')).toBeNull();
    expect(await fetchYahooQuoteSummary('')).toBeNull();
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it('ENV ON + .KS 성공 — trailingPE/priceToBook/trailingEps 매핑 + source=YAHOO_QUOTE_SUMMARY', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any).mockResolvedValueOnce(makeResponse(makeFundamentalsBody({
      trailingPE: 12.5, priceToBook: 1.8, trailingEps: 4321.5,
    })));
    const r = await fetchYahooQuoteSummary('005930');
    expect(r).toEqual({ per: 12.5, pbr: 1.8, eps: 4321.5, source: 'YAHOO_QUOTE_SUMMARY' });
    expect(guardedFetch).toHaveBeenCalledTimes(1);
    expect((guardedFetch as any).mock.calls[0][0]).toContain('005930.KS');
    expect((guardedFetch as any).mock.calls[0][2]).toBe('HISTORICAL'); // IntentTag
  });

  it('.KS 실패 → .KQ 폴백 성공', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any)
      .mockResolvedValueOnce(makeResponse({ quoteSummary: { result: [] } })) // .KS 빈 결과
      .mockResolvedValueOnce(makeResponse(makeFundamentalsBody({ trailingPE: 8.2, priceToBook: 0.9 })));
    const r = await fetchYahooQuoteSummary('196170');
    expect(r).toEqual({ per: 8.2, pbr: 0.9, eps: null, source: 'YAHOO_QUOTE_SUMMARY' });
    expect(guardedFetch).toHaveBeenCalledTimes(2);
    expect((guardedFetch as any).mock.calls[1][0]).toContain('196170.KQ');
  });

  it('non-OK 응답 — null + negative cache (재호출시 외부 호출 0건)', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any).mockResolvedValue(new Response('', { status: 503 }));
    expect(await fetchYahooQuoteSummary('999999')).toBeNull();
    expect(guardedFetch).toHaveBeenCalledTimes(2); // .KS + .KQ
    expect(await fetchYahooQuoteSummary('999999')).toBeNull();
    expect(guardedFetch).toHaveBeenCalledTimes(2); // negative cache hit
  });

  it('fetch throw — null (fail-soft)', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any).mockRejectedValue(new Error('network down'));
    const r = await fetchYahooQuoteSummary('005930');
    expect(r).toBeNull();
  });

  it('positive cache — 동일 코드 재호출 시 외부 호출 0건', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any).mockResolvedValueOnce(makeResponse(makeFundamentalsBody({ trailingPE: 10 })));
    await fetchYahooQuoteSummary('005930');
    await fetchYahooQuoteSummary('005930');
    expect(guardedFetch).toHaveBeenCalledTimes(1);
  });

  it('PER 폴백 우선순위: trailingPE(summaryDetail) > trailingPE(keyStats) > forwardPE(keyStats)', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    // trailingPE(summaryDetail) 만 제공 → 그 값 채택
    (guardedFetch as any).mockResolvedValueOnce(makeResponse({
      quoteSummary: { result: [{
        summaryDetail: { trailingPE: { raw: 15 } },
        defaultKeyStatistics: { trailingPE: { raw: 99 }, forwardPE: { raw: 77 } },
      }] },
    }));
    const r = await fetchYahooQuoteSummary('005930');
    expect(r?.per).toBe(15);
  });

  it('PER fallback: summaryDetail 부재 → keyStats.trailingPE → keyStats.forwardPE', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any).mockResolvedValueOnce(makeResponse({
      quoteSummary: { result: [{
        summaryDetail: {},
        defaultKeyStatistics: { forwardPE: { raw: 7 } }, // trailingPE 없음 → forwardPE 채택
      }] },
    }));
    __resetYahooQuoteSummaryCacheForTest();
    const r = await fetchYahooQuoteSummary('005930');
    expect(r?.per).toBe(7);
  });

  it('모든 필드 0/음수/부재 — null (per/pbr/eps 모두 null 이면 어댑터가 null 반환)', async () => {
    process.env.YAHOO_QUOTE_SUMMARY_PER_ENABLED = 'true';
    (guardedFetch as any).mockResolvedValue(makeResponse({
      quoteSummary: { result: [{ summaryDetail: { trailingPE: { raw: 0 } }, defaultKeyStatistics: { priceToBook: { raw: -1 } } }] },
    }));
    const r = await fetchYahooQuoteSummary('005930');
    expect(r).toBeNull();
  });
});
