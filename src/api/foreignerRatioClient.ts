// @responsibility ADR-0152 외인 추세 클라이언트 SDK — 절대 규칙 #3 (서버↔클라 import 금지) 준수 동기 사본

/**
 * ADR-0152: ADR-0140 ForeignerRatioTrend 와 동기 사본 (서버 직접 import 금지).
 *
 * 변경 시 의무 — `server/persistence/foreignerRatioRepo.ts:24-30` 의 ForeignerRatioTrend
 * 와 동시 갱신. 회귀 테스트 (`enrichment.foreignerTrend.test.ts`) 가 schema 정합 검증.
 */
export interface ForeignerRatioTrend {
  current: number | null;
  changePct5d: number | null;     // %p (퍼센트 포인트)
  changePct20d: number | null;    // %p
  sampleSize: number;
  latestDate: string | null;
}

const FOREIGNER_TREND_TIMEOUT_MS = 4000;

/**
 * 종목별 Naver 외인 보유율 추세 fetch.
 *
 * - 영속 부재: { current: null, sampleSize: 0, ... } 반환 (404 아님)
 * - timeout (4초): null 반환 (호출자 fallback)
 * - 4xx/5xx: null 반환 (silent — 호출자가 stock.checklist 보존)
 */
export async function fetchForeignerRatioTrend(code: string): Promise<ForeignerRatioTrend | null> {
  const baseCode = (code || '').split('.')[0];
  if (!/^\d{1,6}$/.test(baseCode)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FOREIGNER_TREND_TIMEOUT_MS);
  try {
    const url = `/api/foreigner-ratio/trend?code=${encodeURIComponent(baseCode)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as ForeignerRatioTrend;
    if (typeof json !== 'object' || json === null) return null;
    return json;
  } catch {
    // SDS-ignore: 네트워크 실패 시 null fallback (호출자가 stock.checklist 보존)
    return null;
  } finally {
    clearTimeout(timer);
  }
}
