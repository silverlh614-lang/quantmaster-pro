// @responsibility ADR-0543 — KIS daily-short-sale 시장-프록시 ETF 비중(L1)을 shortSelling fallback 으로 취득. kisClient 단일통로.

/**
 * ADR-0543 — KIS 공식 daily-short-sale(FHPST04830000) 시장-프록시 ETF 비중(ssts_tr_pbmn_rlim)을
 * L1 fallback 으로 취득. KIS 에 "코스피 전체 공매도 비중" 단일 엔드포인트 부재 → 코스피200 추종
 * 대표 ETF(069500)를 프록시로 사용(값은 KIS 공식 체결=L1, 프록시 1종은 coverage 한계).
 * 069500 미반환/null 시 005930(삼성전자)로 1회 재시도(런타임 견고화). 모든 KIS 호출은
 * kisClient 단일통로(fetchKisDailyShortSale, 재사용·수정 0줄) 경유 — raw KIS 직접 호출 0건(불변식 #9).
 *
 * 069500 응답 shape(ETF 가 ssts_tr_pbmn_rlim 를 반환한다는 전제)은 런타임 확증 대상이며,
 * 005930 fallback 으로 위험을 완화한다.
 */
const KIS_SHORT_PROXY_CODES = ['069500', '005930'] as const;

/** 폴백 실패는 null 반환(throw 금지) — 상위 carryForward 정책 유지(불변식 #1/#2). */
export async function tryKrxShortViaKisProxy(): Promise<number | null> {
  try {
    const { fetchKisDailyShortSale } = await import('../clients/kisClient.js');
    for (const code of KIS_SHORT_PROXY_CODES) {
      const daily = await fetchKisDailyShortSale(code, 'LOW').catch(() => null);
      const ratio = daily?.shortSaleRatio;
      if (ratio != null && Number.isFinite(ratio) && ratio >= 0 && ratio <= 100) {
        if (code !== KIS_SHORT_PROXY_CODES[0]) {
          console.log(`[MarketRefresh] KIS 프록시 069500 미반환 → ${code} 재시도 성공`);
        }
        return ratio;
      }
    }
    return null;
  } catch {
    return null;
  }
}
