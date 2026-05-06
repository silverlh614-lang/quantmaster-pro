import { resolveTradingContext } from '../marketTruthLayer';

describe('MarketTruthLayer: resolveTradingContext', () => {
  // Mocking Asia/Seoul timezone for consistency
  // In a real Jest setup, this would be in jest.config.js
  beforeAll(() => {
    process.env.TZ = 'Asia/Seoul';
  });

  it('should correctly identify a weekday during trading hours', async () => {
    // 2026-05-04 is a Monday
    const now = new Date('2026-05-04T10:00:00.000+09:00');
    const context = await resolveTradingContext({ now });

    expect(context.isTradingDay).toBe(true);
    expect(context.sessionState).toBe('OPEN');
    expect(context.dataMode).toBe('LIVE');
    expect(context.permissions.allowSignalGeneration).toBe(true);
    expect(context.effectiveTradingDate).toBe('2026-04-30'); // 장중에는 전일 기준
  });

  it('should correctly identify a weekday after trading hours', async () => {
    const now = new Date('2026-05-04T16:00:00.000+09:00');
    const context = await resolveTradingContext({ now });

    expect(context.isTradingDay).toBe(true);
    expect(context.sessionState).toBe('CLOSED');
    expect(context.dataMode).toBe('EOD_CONFIRMED');
    expect(context.permissions.allowBackfill).toBe(true);
    expect(context.effectiveTradingDate).toBe('2026-05-04'); // 장마감 후에는 당일 기준
  });

  it('should correctly identify a weekend', async () => {
    // 2026-05-09 is a Saturday
    const now = new Date('2026-05-09T11:00:00.000+09:00');
    const context = await resolveTradingContext({ now });

    expect(context.isTradingDay).toBe(false);
    expect(context.sessionState).toBe('WEEKEND');
    expect(context.dataMode).toBe('HOLIDAY_SNAPSHOT');
    expect(context.permissions.allowSignalGeneration).toBe(false);
    expect(context.permissions.allowShadowLearning).toBe(true);
  });

  it('should correctly identify a holiday and handle date calculations', async () => {
    // 2026-05-05 is a holiday (Tuesday)
    // 2026-05-04 is a trading day (Monday)
    // 2026-04-30 is the trading day before that (Thursday, as May 1st is also a holiday in some years)
    const now = new Date('2026-05-05T11:00:00.000+09:00');
    const context = await resolveTradingContext({ now });

    expect(context.isTradingDay).toBe(false);
    expect(context.sessionState).toBe('HOLIDAY');
    expect(context.dataMode).toBe('HOLIDAY_SNAPSHOT');
    expect(context.permissions.allowSignalGeneration).toBe(false);

    // 휴장일이므로, 분석 기준일은 마지막 거래일인 5월 4일이 되어야 함.
    // (내부 로직: 5/5의 직전 거래일은 5/4)
    expect(context.effectiveTradingDate).toBe('2026-05-04');

    // 비교 기준일은 effectiveTradingDate의 직전 거래일이어야 함.
    // (내부 로직: 5/4의 직전 거래일은 4/30)
    expect(context.previousTradingDate).toBe('2026-04-30');

    // 다음 거래일은 5월 6일
    expect(context.nextTradingDate).toBe('2026-05-06');
  });

  it('should correctly identify the day after a long weekend', async () => {
    // 2026-05-06 is a Wednesday, following a holiday on Tuesday
    const now = new Date('2026-05-06T17:00:00.000+09:00'); // 장마감 후
    const context = await resolveTradingContext({ now });

    expect(context.isTradingDay).toBe(true);
    expect(context.sessionState).toBe('CLOSED');
    expect(context.effectiveTradingDate).toBe('2026-05-06');

    // 5/6의 직전 거래일은 5/5(휴일)가 아닌 5/4이어야 함.
    expect(context.previousTradingDate).toBe('2026-05-04');
  });
});