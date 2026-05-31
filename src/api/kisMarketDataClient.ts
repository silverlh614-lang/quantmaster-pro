// @responsibility KIS 공식 read-only 시세조회(수급·공매도) 클라이언트 — detail 모달 단위 단일 종목용
/**
 * KIS 공식 API read-only 시세조회 클라이언트 (대시보드 detail 모달 전용).
 *
 * - 외국인/기관 순매수: `inquire-investor` (TR FHKST01010900)
 * - 공매도 일별추이:    `daily-short-sale`  (TR FHPST04830000)
 *
 * 모두 `/api/kis/proxy` 화이트리스트(read-only quotation) 경유 — 자동매매 주문 경로와
 * 무관(절대 규칙 #4 미저촉). bulk 스크리너가 아닌 **단일 종목**(모달 open) 에서만 호출해
 * KIS 쿼터 영향을 최소화한다 (ADR-0011 bulk 제거 배경 준수).
 *
 * 모든 실패(미설정·장외·파싱오류)는 null 로 흡수 — 호출자는 기존 표시(미연동/placeholder)
 * 를 유지한다(회귀 0). 파싱 로직(normalize*)은 순수 함수로 분리해 단위 테스트로 검증한다.
 */

export interface KisSupplyDetail {
  foreignNet: number;
  institutionNet: number;
  individualNet: number;
  foreignConsecutive: number;
  isPassiveAndActive: boolean;
  dataSource: 'KIS';
}

export interface KisShortDetail {
  ratio: number;
  trend: 'INCREASING' | 'DECREASING';
  implication: string;
}

function toInt(value: unknown): number {
  const n = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(value: unknown): number {
  const n = parseFloat(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * KIS `inquire-investor`(FHKST01010900) 응답을 5거래일 누적 순매수로 정규화.
 * output[] 일별 row: frgn_ntby_qty(외국인)·orgn_ntby_qty(기관계)·prsn_ntby_qty(개인) 순매수 수량.
 * row 는 최신순 가정 — 합계는 순서 무관, 연속일은 최신부터 카운트.
 */
export function normalizeKisInvestorSupply(body: any): KisSupplyDetail | null {
  const rows: any[] | null = Array.isArray(body?.output) ? body.output : null;
  if (!rows || rows.length === 0) return null;
  const recent = rows.slice(0, 5);
  let foreignNet = 0;
  let institutionNet = 0;
  let individualNet = 0;
  for (const r of recent) {
    foreignNet += toInt(r?.frgn_ntby_qty);
    institutionNet += toInt(r?.orgn_ntby_qty);
    individualNet += toInt(r?.prsn_ntby_qty);
  }
  let foreignConsecutive = 0;
  for (const r of recent) {
    if (toInt(r?.frgn_ntby_qty) > 0) foreignConsecutive += 1;
    else break;
  }
  return {
    foreignNet,
    institutionNet,
    individualNet,
    foreignConsecutive,
    isPassiveAndActive: foreignNet > 0 && institutionNet > 0,
    dataSource: 'KIS',
  };
}

/**
 * KIS `daily-short-sale`(FHPST04830000) 응답을 최신 공매도 비중 + 추세로 정규화.
 * output2[] 일별 row: ssts_vol_rlim(공매도 거래량 비중 %). row 최신순 가정.
 */
export function normalizeKisShortSale(body: any): KisShortDetail | null {
  const rows: any[] | null = Array.isArray(body?.output2) ? body.output2 : null;
  if (!rows || rows.length === 0) return null;
  const ratio = toFloat(rows[0]?.ssts_vol_rlim);
  if (!(ratio > 0)) return null;
  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const recentAvg = avg(rows.slice(0, 3).map((r) => toFloat(r?.ssts_vol_rlim)));
  const prevSlice = rows.slice(3, 6).map((r) => toFloat(r?.ssts_vol_rlim));
  const prevAvg = avg(prevSlice);
  const trend: KisShortDetail['trend'] =
    prevSlice.length > 0 && recentAvg >= prevAvg ? 'INCREASING' : 'DECREASING';
  const rounded = Math.round(ratio * 100) / 100;
  const implication =
    trend === 'INCREASING'
      ? `공매도 비중 ${rounded}% — 최근 증가 추세, 하방 압력에 유의`
      : `공매도 비중 ${rounded}% — 최근 감소 추세, 매도 압력 완화`;
  return { ratio: rounded, trend, implication };
}

async function kisProxyGet(path: string, trId: string, params: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch('/api/kis/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method: 'GET', headers: { tr_id: trId, custtype: 'P' }, params }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function baseCodeOf(code: string): string | null {
  const base = String(code).split('.')[0];
  return /^\d{6}$/.test(base) ? base : null;
}

/** 외국인/기관 5일 순매수 (KIS read-only). 실패 시 null. */
export async function fetchKisInvestorSupply(code: string): Promise<KisSupplyDetail | null> {
  const base = baseCodeOf(code);
  if (!base) return null;
  const body = await kisProxyGet(
    '/uapi/domestic-stock/v1/quotations/inquire-investor',
    'FHKST01010900',
    { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: base },
  );
  return body ? normalizeKisInvestorSupply(body) : null;
}

/** 공매도 비중 추이 (KIS read-only). 실패 시 null. */
export async function fetchKisShortSelling(code: string): Promise<KisShortDetail | null> {
  const base = baseCodeOf(code);
  if (!base) return null;
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const body = await kisProxyGet(
    '/uapi/domestic-stock/v1/quotations/daily-short-sale',
    'FHPST04830000',
    { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: base, FID_INPUT_DATE_1: fmt(start), FID_INPUT_DATE_2: fmt(end) },
  );
  return body ? normalizeKisShortSale(body) : null;
}
