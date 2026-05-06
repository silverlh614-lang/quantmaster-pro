import { TradingContext } from '../context/tradingContext';
import { MetricValue } from '../types/metricValue';

// --- Mock: 실제 프로젝트에서는 @/server/lib/kis/api 같은 모듈이 됩니다. ---
const mockKisApiClient = {
  fetchPrice: async (
    stockCode: string,
  ): Promise<{ closePrice: number; date: string } | null> => {
    // 삼성전자(005930)는 성공 응답 시뮬레이션
    if (stockCode === '005930') {
      return Promise.resolve({ closePrice: 75000, date: '2026-05-04' });
    }
    // SK하이닉스(000660)는 API는 성공했으나 데이터가 없는 경우 시뮬레이션
    if (stockCode === '000660') {
      return Promise.resolve(null);
    }
    // 그 외 종목은 API 호출 실패 시뮬레이션
    return Promise.reject(new Error('API request failed: Invalid stock code'));
  },
};
// --- Mock End ---

/**
 * 특정 종목의 가격 정보를 `MetricValue` 계약에 맞춰 가져오는 데이터 어댑터입니다.
 * 이 어댑터는 TradingContext를 인식하여 시스템 상태에 따라 동작을 달리합니다.
 *
 * @param stockCode 조회할 종목 코드
 * @param context 현재 시스템의 시간축과 상태를 담은 TradingContext
 * @returns 가격 정보를 담은 MetricValue 객체를 반환하는 Promise
 */
export async function fetchPrice(
  stockCode: string,
  context: TradingContext,
): Promise<MetricValue<number>> {
  // 1. 컨텍스트 우선 원칙: 휴장일에는 API를 호출하지 않고 즉시 '데이터 없음'을 반환합니다.
  if (context.dataMode === 'HOLIDAY_SNAPSHOT') {
    return {
      status: 'MISSING',
      value: null,
      reason: 'HOLIDAY_NO_DATA',
      source: 'KIS', // 호출하려 했던 소스를 명시
    };
  }

  try {
    // 2. 실제 데이터 소스(API)를 호출합니다.
    const response = await mockKisApiClient.fetchPrice(stockCode);

    // 3. API 응답은 성공했으나 데이터가 없는 경우를 처리합니다. (e.g., null, [])
    if (!response) {
      return {
        status: 'MISSING',
        value: null,
        reason: 'API_EMPTY',
        source: 'KIS',
      };
    }

    // 4. 성공 시, 데이터를 `MetricValue` 'OK' 상태로 래핑하여 반환합니다.
    return {
      status: 'OK',
      value: response.closePrice,
      asOfDate: context.effectiveTradingDate, // 기준일은 컨텍스트에서 보장
      source: 'KIS',
      quality: 'HIGH', // EOD 확정 데이터는 신뢰도 'HIGH'
    };
  } catch (error) {
    // 5. API 호출 자체가 실패한 경우(네트워크 에러 등)를 처리합니다.
    return {
      status: 'MISSING',
      value: null,
      reason: 'SOURCE_UNAVAILABLE',
      source: 'KIS',
    };
  }
}