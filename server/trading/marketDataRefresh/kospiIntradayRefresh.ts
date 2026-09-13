// @responsibility 코스피 거래일과 장중 시세·등락 종목 수를 레짐 설정 없이 수집하고 조회 시각을 보존한다.
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { fetchKospiCompositeIntradayQuote } from '../../clients/kisClient.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../../observability/operationalWarn.js';
import type { MarketRefreshComputed, DailyBar } from './types.js';

function emitKospiIntradayWarn(reason: string, details: Record<string, unknown> = {}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: `[MarketRefresh] ${reason}`,
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `market-refresh-provider:${reason}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: { providerIssue: true, marketSignal: false, ...details },
  });
}

/**
 * 코스피 봉 거래일과 장중 시세를 수집한다. 레짐 스위치와 무관하게 실행한다.
 *
 * @param computed  marketDataRefresh 가 MERGE 저장할 partial — 본 helper 가 신규 필드를 채운다.
 * @param latestBar refreshKospiSection 의 마지막 완성 일봉(거래일 도출용). 부재 시 (a) skip.
 */
export async function applyKospiTriggerProvenance(
  computed: MarketRefreshComputed,
  latestBar: DailyBar | undefined,
): Promise<void> {
  // (a) 트리거 봉 거래일 영속 — Yahoo ts(epoch seconds) → KST date-key. (결함 A: trade-date 게이트 입력)
  if (latestBar?.ts !== undefined && Number.isFinite(latestBar.ts)) {
    const tradeDate = toKstDateKey(new Date(latestBar.ts * 1000));
    if (tradeDate) computed.kospiTriggerSourceTradeDate = tradeDate;
  }

  let quote: { current: number; changePct: number; tradeDate: string; advanceCount?: number; declineCount?: number } | null = null;
  try {
    quote = await fetchKospiCompositeIntradayQuote();
  } catch (err) {
    // KIS 통로 내부 예외 — carry-forward + 경고(silent 금지). 불변식 #6.
    emitKospiIntradayWarn('KOSPI_INTRADAY_CARRY_FORWARD', {
      reason: 'KIS 종합지수 intraday quote fetch 예외 — 기존 값 유지(carry-forward)',
      carryForward: true,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!quote) {
    // 응답 결손 시 기존 시세와 조회 시각을 유지하여 오래된 값을 새 시세로 기록하지 않는다.
    emitKospiIntradayWarn('KOSPI_INTRADAY_CARRY_FORWARD', {
      reason: 'KIS 종합지수 intraday quote 미수집(null) — 기존 값 유지(carry-forward)',
      carryForward: true,
    });
    return;
  }

  computed.kospiIntradayReturn = quote.changePct;
  computed.kospiIntradaySourceTradeDate = quote.tradeDate;
  computed.kospiIntradayFetchedAt = new Date().toISOString();
  console.info(
    '[KOSPI_INTRADAY_OBSERVE] ' +
      `kospiIntradayReturn=${quote.changePct.toFixed(2)}% ` +
      `current=${quote.current.toFixed(2)} ` +
      `sourceTradeDate=${quote.tradeDate} ` +
      'source=KIS_COMPOSITE_0001 executionImpact=NONE',
  );

  // ADR-0593: breadth(등락종목수)는 동일 D2 응답의 부산물 — KIS 콜 0 추가. 부재 시 미설정(보수).
  if (quote.advanceCount !== undefined && quote.declineCount !== undefined) {
    computed.kospiAdvanceCount = quote.advanceCount;
    computed.kospiDeclineCount = quote.declineCount;
    computed.kospiBreadthFetchedAt = computed.kospiIntradayFetchedAt;
    const total = quote.advanceCount + quote.declineCount;
    const ratio = total > 0 ? quote.advanceCount / total : 0;
    console.info(
      '[KOSPI_BREADTH_OBSERVE] ' +
        `kospiAdvanceCount=${quote.advanceCount} kospiDeclineCount=${quote.declineCount} ` +
        `breadthAdvanceRatio=${ratio.toFixed(3)} ` +
        'source=KIS_COMPOSITE_0001 executionImpact=NONE',
    );
  } else {
    // 등락 종목 수 결손은 관측 결손으로 남긴다(불변식 #6: 결손≠signal).
    emitKospiIntradayWarn('KOSPI_BREADTH_ABSENT', {
      reason: 'KIS 종합지수 응답 등락종목수(ascn/down_issu_cnt) 부재 — breadth 미설정',
      advanceCountPresent: quote.advanceCount !== undefined,
      declineCountPresent: quote.declineCount !== undefined,
    });
  }
}
