// @responsibility KIS 공식 현재가 on-demand 클라이언트 — 개별 종목(검색/카드 상세)만 호출(quota 소량).
/**
 * `/api/kis/price`(FHKST01010100 현재가) 단건 조회. 장중 실시간(가장 신뢰) → 장외/실패/미설정 시 null
 * (호출자가 Naver 등으로 폴백). 대량 후보발굴에서는 호출하지 않는다(자동매매 KIS quota 보호, ADR-0011).
 */
export interface KisLivePrice {
  price: number;
  changeRate: number;
}

export async function fetchKisLivePrice(code: string): Promise<KisLivePrice | null> {
  const base = String(code).split('.')[0];
  if (!/^\d{6}$/.test(base)) return null;
  try {
    const res = await fetch(`/api/kis/price?code=${base}`);
    if (!res.ok) return null;
    const data = await res.json();
    // KIS inquire-price: output.stck_prpr(현재가, 문자열) · output.prdy_ctrt(전일대비율).
    const price = Number(data?.output?.stck_prpr);
    if (!Number.isFinite(price) || price <= 0) return null; // 장외 0/빈값 → null → 폴백
    const changeRate = Number(data?.output?.prdy_ctrt);
    return { price, changeRate: Number.isFinite(changeRate) ? changeRate : 0 };
  } catch {
    return null;
  }
}
