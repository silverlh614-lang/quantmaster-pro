/**
 * @responsibility Yahoo historical data 프록시 호출 — 204 OFFHOURS 식별 + nextOpenAt 노출
 *
 * 서버 marketDataRouter 가 KRX/NYSE 장외에는 캐시 hit 시 stale, miss 시 204 No Content
 * 를 반환한다. 이전 구현은 204 응답을 `response.json()` 으로 파싱하다가 빈 body 에서
 * 예외가 발생해 retry 후 null 반환만 하던 구조라, 호출자가 "데이터 못 불러옴" 인지
 * "장외 — 다음 개장까지 대기" 인지 구분 불가했다.
 *
 * 이 모듈은 204 를 OFFHOURS 결과로 명확히 분류하고 `X-Market-Next-Open` 헤더를 함께
 * 전파해 차트/UI 가 "장외 안내" 와 "데이터 오류" 를 구분 표시할 수 있게 한다.
 */
import { withRetry } from './aiClient';

/**
 * Historical data 결과의 메타데이터. 차트 컴포넌트가 OFFHOURS 응답을 받았을 때
 * "다음 개장 시각까지 갱신되지 않습니다" 안내를 표시하기 위해 reason 을 외부에 노출.
 */
export interface HistoricalDataMeta {
  /** 'OFFHOURS' 면 서버 게이트가 outbound 를 차단한 상태. data 는 null. */
  reason?: 'OFFHOURS' | 'NOT_FOUND' | 'ERROR';
  /** 다음 정규장 개장 시각(ISO). 서버가 X-Market-Next-Open 헤더로 제공한 경우만 채워진다. */
  nextOpenAt?: string;
}

/** OFFHOURS 식별을 위한 sentinel — null 과 구분되어야 하는 호출 경로에서 사용. */
export interface HistoricalDataResult {
  data: any;
  meta: HistoricalDataMeta;
}

/**
 * 단일 fetch — 204 No Content 를 OFFHOURS 로 명확히 분류한다.
 * 호출자가 retry 를 원치 않을 때(OFFHOURS) 즉시 종료하도록 sentinel error 를 던진다.
 */
async function fetchOnce(url: string): Promise<HistoricalDataResult> {
  const response = await fetch(url);

  // 204 OFFHOURS-SKIP — 서버 marketDataRouter 가 outbound 를 차단했다.
  if (response.status === 204) {
    const nextOpenAt = response.headers.get('X-Market-Next-Open') ?? undefined;
    return { data: null, meta: { reason: 'OFFHOURS', nextOpenAt } };
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  // body 가 빈 응답인 경우 (서버가 200 + Content-Length 0 으로 응답하는 케이스 방어)
  const ct = response.headers.get('Content-Type') ?? '';
  if (!ct.includes('json')) {
    const txt = await response.text();
    if (!txt.trim()) {
      const nextOpenAt = response.headers.get('X-Market-Next-Open') ?? undefined;
      return { data: null, meta: { reason: 'OFFHOURS', nextOpenAt } };
    }
    // JSON 이 아닌 200 응답은 비정상 — 호출자가 ERROR 로 처리.
    throw new Error('Unexpected non-JSON response');
  }

  const json = await response.json();
  if (!json.chart?.result?.[0]) {
    throw new Error('Invalid data format from Yahoo API');
  }
  return { data: json.chart.result[0], meta: {} };
}

/**
 * Historical data 조회 — 204 OFFHOURS 인식.
 *
 * @param withMeta true 면 OFFHOURS sentinel 을 포함한 풍부한 결과 반환. false (기본) 면
 *                 기존 호출자 호환을 위해 data 만 반환 (null 가능).
 */
export async function fetchHistoricalData(
  code: string,
  range?: string,
  interval?: string,
): Promise<any>;
export async function fetchHistoricalData(
  code: string,
  range: string | undefined,
  interval: string | undefined,
  options: { withMeta: true },
): Promise<HistoricalDataResult>;
export async function fetchHistoricalData(
  code: string,
  range: string = '1y',
  interval: string = '1d',
  options?: { withMeta?: boolean },
): Promise<any | HistoricalDataResult> {
  // KR 6자리 코드는 .KS → .KQ 순서로 시도. 그 외는 그대로 사용.
  const baseCodeMatch = code.match(/^(\d{6})(\.(KS|KQ))?$/);
  const baseCode = baseCodeMatch ? baseCodeMatch[1] : null;
  const symbols = baseCode ? [`${baseCode}.KS`, `${baseCode}.KQ`] : [code];

  let lastMeta: HistoricalDataMeta = {};
  for (const symbol of symbols) {
    const url = `/api/historical-data?symbol=${symbol}&range=${range}&interval=${interval}`;
    try {
      const result = await withRetry(async () => {
        return await fetchOnce(url);
      }, 2, 2000);

      if (result.meta.reason === 'OFFHOURS') {
        // OFFHOURS 는 다른 시장(.KS vs .KQ) 으로 retry 해도 동일 — 즉시 종료.
        lastMeta = result.meta;
        break;
      }
      if (result.data) {
        return options?.withMeta ? result : result.data;
      }
    } catch (error) {
      console.error(`Error fetching historical data for ${symbol}:`, error);
      lastMeta = { reason: 'ERROR' };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return options?.withMeta ? { data: null, meta: lastMeta } : null;
}
