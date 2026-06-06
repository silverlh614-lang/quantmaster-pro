// @responsibility 시가총액 숫자(경로별 혼재 단위)를 표시 문자열로 — raw-won/억 크기 자동 판별.

/**
 * stock.marketCap 단위는 경로별로 혼재한다 — snapshot/aiUniverse(Naver)=원,
 * 일부 레거시/AI 경로=억. 크기로 정규화한다: 1e8(=1억 원) 이상이면 원으로 간주
 * (원→조 = /1e12), 미만이면 억 단위(억→조 = /1e4). 실제 상장 시총 범위
 * (수십억~수백조)에서 두 단위 표현이 겹치지 않아 안전하다.
 *
 * 배경: parseMarketCapWon(naverFinanceClient) 픽스로 snapshot marketCap 이 0→원 단위로
 * 채워지면서, 억 단위를 가정하던 표시부(/10000·/1e8)가 1e8 배 과대표시하던 결함을 해소.
 * @returns 조(兆) 단위 숫자, 값이 없으면 null.
 */
export function marketCapToJo(marketCap: number | undefined | null): number | null {
  if (typeof marketCap !== 'number' || !Number.isFinite(marketCap) || marketCap <= 0) return null;
  return marketCap >= 1e8 ? marketCap / 1e12 : marketCap / 1e4;
}

/** "131.2조원" (값 부재 → 'N/A'). */
export function formatMarketCapJoWon(marketCap: number | undefined | null): string {
  const jo = marketCapToJo(marketCap);
  return jo == null ? 'N/A' : `${jo.toFixed(1)}조원`;
}

/** "131.2T KRW" (값 부재 → 'N/A'). */
export function formatMarketCapTKrw(marketCap: number | undefined | null): string {
  const jo = marketCapToJo(marketCap);
  return jo == null ? 'N/A' : `${jo.toFixed(1)}T KRW`;
}
