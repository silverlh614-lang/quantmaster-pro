// @responsibility KIS 실시간 dayOpen/prevClose 보정 — RevalidationStep mutating step

import { fetchKisIntraday } from '../../../screener/stockScreener.js';
import { reconcileDayOpen } from '../../entryEngine.js';
import { isGate3EntryPriceRestampEnabled } from '../../gateConfig.js';

export interface KisIntradayCorrectionInput {
  stockCode: string;
  reCheckQuote: {
    dayOpen?: number;
    prevClose?: number;
    price?: number;
    currentPrice?: number;
    priceAsOf?: string;
  } | null;
}

export interface KisIntradayCorrectionResult {
  /** mutation 발생 여부 (dayOpen 또는 prevClose 둘 중 하나라도 변경됐으면 true). */
  applied: boolean;
  /** caller 가 console.log 로 출력할 한 줄 메시지 (보정 발생 시에만). */
  logMessages: string[];
}

/**
 * ADR-0031 PR-60 — 라인 655-681 의 KIS 실시간 보정 분기를 byte-equivalent 로 추출.
 *
 * Yahoo Finance의 regularMarketOpen 이 한국 장중 부정확한 경우가 빈번해 KIS
 * 현재가 API (FHKST01010100) 로 dayOpen·prevClose 를 보정한다. step 은 reCheckQuote
 * 객체를 직접 mutate 하며 (참조 전달), caller 는 반환된 logMessages 를 출력만 한다.
 *
 * 차단 분기 없음 — 항상 proceed (mutation 결과만 노출).
 */
export async function kisIntradayCorrectionStep(
  input: KisIntradayCorrectionInput,
): Promise<KisIntradayCorrectionResult> {
  const { stockCode, reCheckQuote } = input;
  const logMessages: string[] = [];

  if (!reCheckQuote) {
    return { applied: false, logMessages };
  }

  const kisSnap = await fetchKisIntraday(stockCode).catch(() => null);
  if (!kisSnap) {
    return { applied: false, logMessages };
  }

  let applied = false;
  const dayOpenDecision = reconcileDayOpen({
    yahooDayOpen: reCheckQuote.dayOpen,
    kisDayOpen: kisSnap.dayOpen,
  });
  if (
    dayOpenDecision.dayOpen &&
    reCheckQuote.dayOpen !== dayOpenDecision.dayOpen
  ) {
    const divergenceLabel = dayOpenDecision.divergencePct == null
      ? 'N/A'
      : `${dayOpenDecision.divergencePct.toFixed(1)}%`;
    logMessages.push(
      `[KisIntraday] ${stockCode} 시가 ${dayOpenDecision.acceptedKis ? '보정' : '유지'}: Yahoo=${reCheckQuote.dayOpen} / KIS=${kisSnap.dayOpen} / 사용=${dayOpenDecision.dayOpen} / 괴리=${divergenceLabel}`,
    );
    reCheckQuote.dayOpen = dayOpenDecision.dayOpen;
    applied = true;
  }
  if (kisSnap.prevClose > 0) {
    reCheckQuote.prevClose = kisSnap.prevClose;
    applied = true;
  }
  // ADR-0661 — 같은 콜(FHKST01010100)이 반환한 fresh 현재가·시각을 재검증 quote 에 각인한다.
  // 각인이 없으면 6h 일봉 캐시의 낡은 asOf 가 Gate3 entry price guard(>60s=STALE)에 들어가
  // 신선한 재검증조차 ENTRY_PRICE_STALE 로 오차단된다. 신규 fetch 0 · guard 임계 무변경.
  // 명시 age 필드(entryPriceAgeSec)는 각인하지 않는다 — 캐시 공유 객체에 고정 age 가 남으면
  // 이후 평가를 오염하므로 priceAsOf 타임스탬프만 각인해 평가 시점마다 나이를 재계산하게 한다.
  if (isGate3EntryPriceRestampEnabled() && kisSnap.price > 0) {
    reCheckQuote.price = kisSnap.price;
    reCheckQuote.currentPrice = kisSnap.price;
    reCheckQuote.priceAsOf = kisSnap.asOf ?? new Date().toISOString();
    applied = true;
  }
  return { applied, logMessages };
}
