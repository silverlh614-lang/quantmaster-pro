// @responsibility KIS 실시간 dayOpen/prevClose 보정 — RevalidationStep mutating step

import { fetchKisIntraday } from '../../../screener/stockScreener.js';
import { reconcileDayOpen } from '../../entryEngine.js';

export interface KisIntradayCorrectionInput {
  stockCode: string;
  reCheckQuote: { dayOpen?: number; prevClose?: number } | null;
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
  return { applied, logMessages };
}
