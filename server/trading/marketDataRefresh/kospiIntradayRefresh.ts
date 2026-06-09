// @responsibility ADR-0592 — KOSPI 트리거 봉 거래일 영속 + flag-gated KIS intraday quote fetch(carry-forward 경고). marketDataRefresh 순증 격리.
/**
 * kospiIntradayRefresh.ts — ADR-0592 D2 marketDataRefresh 위임 helper.
 *
 * refreshKospiSection 끝에서 호출되어 다음 두 가지를 담당한다(본체 import/줄수 격리):
 *  (a) 트리거 봉 거래일(KRX, YYYY-MM-DD KST) 영속 — kospiTriggerSourceTradeDate (결함 A 입력).
 *  (b) flag ON 시 KIS 종합지수(0001) intraday quote fetch → kospiIntradayReturn /
 *      kospiIntradaySourceTradeDate / kospiIntradayFetchedAt 채움 (결함 B 입력).
 *      실패 시 carry-forward(신규 필드 미기록) + 운영자 경고(불변식 #6: provider 이슈 ≠ market signal).
 *
 * 거래일 SSOT = krxTradingCalendar(toKstDateKey, ADR-0559). KIS quote = kisClient 단일 통로.
 */

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
 * ADR-0592: 트리거 봉 거래일 영속 + (flag ON 시) 오늘 intraday KOSPI quote 공급.
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

  // (b) flag OFF → KIS quote 호출 0, 신규 intraday 필드 미설정(baseline byte-equivalent).
  if (process.env.R6_KOSPI_INTRADAY_QUOTE_ENABLED !== 'true') return;

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
    // OFF/미설정/응답 결손 → 신규 필드 미기록 → recovery 평가는 기존 close-return 경로(byte-equivalent).
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
    '[R6_INTRADAY_REBOUND_OBSERVE] ' +
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
      '[REGIME_RISK_ON_FAST_UPGRADE_OBSERVE] ' +
        `kospiAdvanceCount=${quote.advanceCount} kospiDeclineCount=${quote.declineCount} ` +
        `breadthAdvanceRatio=${ratio.toFixed(3)} ` +
        'source=KIS_COMPOSITE_0001 executionImpact=NONE',
    );
  } else {
    // breadth 결손 — intraday 값은 채우되 breadth 는 미설정(불변식 #6: 결손≠signal). fast-upgrade 미발동.
    emitKospiIntradayWarn('KOSPI_BREADTH_ABSENT', {
      reason: 'KIS 종합지수 응답 등락종목수(ascn/down_issu_cnt) 부재 — breadth 미설정(fast-upgrade 보수 미발동)',
      advanceCountPresent: quote.advanceCount !== undefined,
      declineCountPresent: quote.declineCount !== undefined,
    });
  }
}
