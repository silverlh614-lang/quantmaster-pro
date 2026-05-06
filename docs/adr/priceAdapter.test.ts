import { fetchPrice } from '../priceAdapter';
import { resolveTradingContext } from '../../context/marketTruthLayer';
import { TradingContext } from '../../context/tradingContext';

describe('PriceAdapter: fetchPrice', () => {
  let tradingDayContext: TradingContext;
  let holidayContext: TradingContext;

  beforeAll(async () => {
    // 시나리오 1: 거래일 장 마감 후 컨텍스트
    tradingDayContext = await resolveTradingContext({
      now: new Date('2026-05-04T17:00:00.000+09:00'),
    });
    // 시나리오 2: 휴장일 컨텍스트
    holidayContext = await resolveTradingContext({
      now: new Date('2026-05-05T11:00:00.000+09:00'),
    });
  });

  it('휴장일에는 API를 호출하지 않고 "HOLIDAY_NO_DATA" 사유로 MISSING을 반환해야 한다', async () => {
    const result = await fetchPrice('005930', holidayContext);

    expect(result.status).toBe('MISSING');
    // Type guard를 통해 안전하게 reason에 접근
    if (result.status === 'MISSING') {
      expect(result.reason).toBe('HOLIDAY_NO_DATA');
    }
  });

  it('거래일에 API 호출 성공 시, OK 상태와 가격 데이터를 반환해야 한다', async () => {
    const result = await fetchPrice('005930', tradingDayContext);

    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.value).toBe(75000);
      expect(result.source).toBe('KIS');
      expect(result.quality).toBe('HIGH');
      // 데이터의 기준일이 컨텍스트의 유효 거래일과 일치하는지 검증
      expect(result.asOfDate).toBe(tradingDayContext.effectiveTradingDate);
    }
  });

  it('API가 빈 값을 반환하면 "API_EMPTY" 사유로 MISSING을 반환해야 한다', async () => {
    const result = await fetchPrice('000660', tradingDayContext);

    expect(result.status).toBe('MISSING');
    if (result.status === 'MISSING') {
      expect(result.reason).toBe('API_EMPTY');
    }
  });

  it('API 호출 자체가 실패하면 "SOURCE_UNAVAILABLE" 사유로 MISSING을 반환해야 한다', async () => {
    const result = await fetchPrice('999999', tradingDayContext); // Mock에서 실패하도록 설정된 종목 코드

    expect(result.status).toBe('MISSING');
    if (result.status === 'MISSING') {
      expect(result.reason).toBe('SOURCE_UNAVAILABLE');
    }
  });

  it('MetricValue 소비자는 status를 확인하여 안전하게 값을 사용해야 한다', async () => {
    const priceMetric = await fetchPrice('005930', tradingDayContext);
    let finalPrice = -1; // 기본값

    // 안전한 소비 패턴
    if (priceMetric.status === 'OK') {
      finalPrice = priceMetric.value;
    } else {
      // 데이터가 없을 때의 로직 (e.g., 로깅, 기본값 사용 안 함)
      console.log(
        `[Consumer] Price data is missing. Reason: ${priceMetric.reason}`,
      );
    }

    expect(finalPrice).toBe(75000);
  });
});