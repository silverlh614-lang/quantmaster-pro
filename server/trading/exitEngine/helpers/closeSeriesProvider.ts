// @responsibility exit 경로 국내 종가배열 출처 라우터 — flag OFF=Yahoo fetchCloses byte-equal, flag ON=KIS 일봉
/**
 * exitEngine/helpers/closeSeriesProvider.ts — exit 경로 종가배열 출처 라우터 (ADR-0561 grandfather burn-down).
 *
 * exitEngine 의 ma60/RSI 청산 결정에 공급되는 60/120일 종가배열의 출처를 flag-gate 한다.
 * R1 라우터(technicalQuoteRouter.fetchTechnicalQuoteByCode) 와 동형:
 *   - flag OFF(KIS_OHLCV_PRIMARY_ENABLED==='false' 명시 롤백): 기존 `fetchCloses(sym, range)` Yahoo funnel
 *     그대로 위임·반환 → byte-equal(호출수·심볼후보순서·반환형 number[]|null 동일, 청산결정 불변).
 *   - flag ON(default — 미설정 포함): KIS 일봉(FHKST03010100, fetchKisDailyCandles) 종가배열(과거→최신,
 *     Yahoo 동형) 1차. KIS 불가(빈 배열/throw) 시 Yahoo funnel 로 graceful fallback(불변식 #6 — provider 장애≠약세).
 *
 * 신규 종가 계산·청산 산식 0줄 — 데이터 소스 경로만 분기. 2026-06-10: flag 해석을 kisPrimaryFlag SSOT
 * (미설정=ON, `!== 'false'`)로 통일(ADR-0561 정합 정정 patch) — 미설정 환경 default 가 OFF→ON 으로 전환.
 */

import { fetchCloses } from '../../marketDataRefresh.js';
import { fetchKisDailyCandles } from '../../../screener/kisChartDataFetcher.js';
// ENV 글로벌 토글 — kisPrimaryFlag SSOT(미설정=ON, 'false' 만 명시 롤백). R1(ADR-0547)과 동일 flag.
import { isKisOhlcvPrimaryEnabled } from '../../../clients/kisPrimaryFlag.js';

/** Yahoo range('60d'/'120d') → KIS calendarDays 환산 (주말·휴장 여유 포함, R1 220일 패턴 동형). */
function rangeToCalendarDays(range: string): number {
  const m = /^(\d+)d$/.exec(range.trim());
  const tradingDays = m ? parseInt(m[1], 10) : 120;
  // 거래일 → 캘린더일 보정(주말/휴장 ~1.55배) + 안전 여유. KIS 한 호출 ~100봉 한계는
  // fetchKisDailyCandles 가 다중 페이지로 처리(R1 동일).
  return Math.max(60, Math.ceil(tradingDays * 1.6) + 30);
}

/**
 * 종가배열 출처 라우터 (code-진입).
 *
 * @param stockCode 6자리 국내 종목코드(미패딩 허용 — fetchKisDailyCandles 가 padStart).
 * @param symbol    flag OFF Yahoo funnel 에 전달할 심볼 후보(`${c}.KS`/`${c}.KQ`).
 * @param range     Yahoo range 문자열('60d'/'120d') — flag OFF 시 그대로 전달.
 * @returns 종가 number[] (과거→최신) 또는 null. flag OFF 는 fetchCloses 반환 그대로(byte-equal).
 */
export async function fetchCloseSeries(
  stockCode: string,
  symbol: string,
  range: string,
): Promise<number[] | null> {
  if (!isKisOhlcvPrimaryEnabled()) {
    // flag OFF — 기존 Yahoo funnel 그대로 위임(byte-equal: 호출수 1·반환형·실패 null 동일).
    return fetchCloses(symbol, range);
  }

  // flag ON — KIS 일봉(L1) 종가배열 1차. 빈 배열/throw 는 약세 신호가 아니다(불변식 #6).
  try {
    const candles = await fetchKisDailyCandles(stockCode, rangeToCalendarDays(range));
    if (candles.length > 0) {
      // KIS 캔들은 과거→최신 — Yahoo fetchCloses(number[] 오름차순)와 동형.
      return candles.map((c) => c.close);
    }
  } catch (e) {
    // graceful 강등 — Yahoo funnel fallback (provider 장애 흡수, 로그 남김).
    console.warn(
      `[closeSeriesProvider] ${stockCode} KIS-first 종가 실패 → Yahoo fallback:`,
      e instanceof Error ? e.message : e,
    );
  }

  // KIS 불가 → Yahoo funnel fallback(회귀 0).
  return fetchCloses(symbol, range);
}
