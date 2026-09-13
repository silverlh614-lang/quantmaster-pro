// @responsibility 레짐 설정 제거 후 코스피 수집·거래일·시각 보존과 공급자 실패 처리를 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketRefreshComputed } from './types.js';

const mocks = vi.hoisted(() => ({ quote: vi.fn(), warn: vi.fn() }));
vi.mock('../../clients/kisClient.js', () => ({ fetchKospiCompositeIntradayQuote: mocks.quote }));
vi.mock('../../observability/operationalWarn.js', () => ({
  defaultWarnTtlSec: () => 300,
  emitOperationalWarn: mocks.warn,
}));
import { applyKospiTriggerProvenance } from './kospiIntradayRefresh.js';

const now = new Date('2026-06-09T02:00:00.000Z');
const dailyBar = { ts: Date.parse('2026-06-08T06:30:00.000Z') / 1000, close: 2700 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.quote.mockReset();
  mocks.warn.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('코스피 데이터 수집은 레짐 설정과 독립', () => {
  it.each([undefined, 'false', 'true'])('폐기 변수 %s에서도 거래일·시세·등락 종목 수를 갱신한다', async (value) => {
    vi.stubEnv('R6_KOSPI_INTRADAY_QUOTE_ENABLED', value);
    mocks.quote.mockResolvedValue({ current: 2800, changePct: 3.2, tradeDate: '2026-06-09', advanceCount: 650, declineCount: 210 });
    const computed: MarketRefreshComputed = {};
    await applyKospiTriggerProvenance(computed, dailyBar);
    expect(mocks.quote).toHaveBeenCalledTimes(1);
    expect(computed).toEqual({
      kospiTriggerSourceTradeDate: '2026-06-08',
      kospiIntradayReturn: 3.2,
      kospiIntradaySourceTradeDate: '2026-06-09',
      kospiIntradayFetchedAt: now.toISOString(),
      kospiAdvanceCount: 650,
      kospiDeclineCount: 210,
      kospiBreadthFetchedAt: now.toISOString(),
    });
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it.each(['empty', 'failure'])('공급자 %s 시 기존 데이터와 시각을 유지하고 장애를 기록한다', async (caseName) => {
    if (caseName === 'failure') mocks.quote.mockRejectedValue(new Error('provider unavailable'));
    else mocks.quote.mockResolvedValue(null);
    const previous = { kospiIntradayReturn: 1.5, kospiIntradaySourceTradeDate: '2026-06-08', kospiIntradayFetchedAt: '2026-06-08T05:00:00.000Z' };
    const computed: MarketRefreshComputed = { ...previous };
    await applyKospiTriggerProvenance(computed, dailyBar);
    expect(computed).toEqual({ ...previous, kospiTriggerSourceTradeDate: '2026-06-08' });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ providerIssue: true, marketSignal: false, carryForward: true }),
    }));
  });
});
