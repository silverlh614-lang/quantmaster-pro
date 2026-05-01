// @responsibility ADR-0155 KRX 기관 순매수 클라이언트 SDK — 절대 규칙 #3 동기 사본 + ADR-0011 정합

/**
 * ADR-0155 KrxInvestorTrend — 종목별 N영업일 누적 외인/기관/개인 순매수.
 *
 * 변경 시 의무 — `server/routes/krxInvestorRouter.ts` 응답 schema 와 동시 갱신.
 */
export interface KrxInvestorTrend {
  code: string;
  foreignNet5d: number;       // 5영업일 누적 외인 순매수 (주)
  institutionNet5d: number;   // 5영업일 누적 기관 순매수 (주)
  individualNet5d: number;    // 5영업일 누적 개인 순매수 (주)
  sampleSize: number;         // 실제 fetch 성공 일수 (0 ~ 5)
  latestDate: string | null;  // YYYY-MM-DD
}

const KRX_INVESTOR_TIMEOUT_MS = 12000;  // KRX 5 호출 = 5초 cache miss 대비 12초

/**
 * 종목별 KRX 5영업일 기관 순매수 fetch.
 *
 * - 영속 부재 / sampleSize=0: 정상 응답 (404 아님), 호출자 fallback
 * - timeout (12초) / 4xx / 5xx / 네트워크 실패: null 반환 (호출자 stock.checklist 보존)
 *
 * KIS quota 0 침범 (KRX 공개 endpoint).
 */
export async function fetchKrxInvestorTrend(code: string): Promise<KrxInvestorTrend | null> {
  const baseCode = (code || '').split('.')[0];
  if (!/^\d{1,6}$/.test(baseCode)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KRX_INVESTOR_TIMEOUT_MS);
  try {
    const url = `/api/krx-investor/trend?code=${encodeURIComponent(baseCode)}&days=5`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as KrxInvestorTrend;
    if (typeof json !== 'object' || json === null) return null;
    return json;
  } catch {
    // SDS-ignore: 네트워크 실패 시 null fallback (호출자가 stock.checklist 보존)
    return null;
  } finally {
    clearTimeout(timer);
  }
}
