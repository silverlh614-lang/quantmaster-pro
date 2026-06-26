/**
 * @responsibility KIS API 엔드포인트·TR_ID·실계좌 client 가용성 상수 SSOT
 *
 * ADR-0135 (PR-Refactor-3) — kisClient.ts 분해 시 상수 격리.
 * 의존 0 — process.env 외 외부 import 없음.
 */

export const KIS_IS_REAL = process.env.KIS_IS_REAL === 'true';
export const KIS_BASE    = KIS_IS_REAL
  ? 'https://openapi.koreainvestment.com:9443'
  : 'https://openapivts.koreainvestment.com:29443';
// ─── 국내 주문 TR_ID 스킴 (ADR-0653) ──────────────────────────────────────────
// 구 스킴 = KRX 전용(하위호환 동작). 신 스킴 = KRX+NXT 통합(2025 Nextrade 도입).
// flag default OFF → 구 스킴 = byte-equivalent. ON 활성화는 VTS(모의) 회귀 + 운영자 승인 후.
export const KIS_ORDER_TR_NXT_SCHEME_ENABLED =
  process.env.KIS_ORDER_TR_NXT_SCHEME_ENABLED === 'true';

// ⚠️ swap 함정 동결: 신스킴 매수=...12U / 매도=...11U
//    (구스킴 매수=...02U / 매도=...01U 와 끝자리가 반대 — 끝자리 직관 유추 시 매수↔매도 오라우팅).
//    출처: 공식 order_cash.py:104-107 (sell→TTTC0011U, buy→TTTC0012U). patch-history #189 재확인.
export const KIS_NXT_ORDER_TR_IDS = {
  buyReal: 'TTTC0012U', buyDemo: 'VTTC0012U',
  sellReal: 'TTTC0011U', sellDemo: 'VTTC0011U',
  cancelReal: 'TTTC0013U', cancelDemo: 'VTTC0013U',
  ccldReal: 'TTTC0081R', ccldDemo: 'VTTC0081R',
} as const;
export const KIS_LEGACY_ORDER_TR_IDS = {
  buyReal: 'TTTC0802U', buyDemo: 'VTTC0802U',
  sellReal: 'TTTC0801U', sellDemo: 'VTTC0801U',
  cancelReal: 'TTTC0803U', cancelDemo: 'VTTC0803U',
  ccldReal: 'TTTC8001R', ccldDemo: 'VTTC8001R',
} as const;

const ORDER_TR_SCHEME = KIS_ORDER_TR_NXT_SCHEME_ENABLED
  ? KIS_NXT_ORDER_TR_IDS
  : KIS_LEGACY_ORDER_TR_IDS;

export const BUY_TR_ID      = KIS_IS_REAL ? ORDER_TR_SCHEME.buyReal    : ORDER_TR_SCHEME.buyDemo;
export const SELL_TR_ID     = KIS_IS_REAL ? ORDER_TR_SCHEME.sellReal   : ORDER_TR_SCHEME.sellDemo;
export const CCLD_TR_ID     = KIS_IS_REAL ? ORDER_TR_SCHEME.ccldReal   : ORDER_TR_SCHEME.ccldDemo;
export const RVSECNCL_TR_ID = KIS_IS_REAL ? ORDER_TR_SCHEME.cancelReal : ORDER_TR_SCHEME.cancelDemo;

/** 취소·체결 어댑터의 input.isReal 경로 보존용 — 스킴 + isReal 동시 반영 (순수). */
export function selectCancelOrderTrId(isReal: boolean): string {
  return isReal ? ORDER_TR_SCHEME.cancelReal : ORDER_TR_SCHEME.cancelDemo;
}
export function selectCcldTrId(isReal: boolean): string {
  return isReal ? ORDER_TR_SCHEME.ccldReal : ORDER_TR_SCHEME.ccldDemo;
}

/** 신스킴 order-cash 신규 필수 param. OFF 시 {} → 주문 body byte-equivalent. */
export function nxtOrderCashParams(side: 'BUY' | 'SELL'): Record<string, string> {
  if (!KIS_ORDER_TR_NXT_SCHEME_ENABLED) return {};
  return {
    EXCG_ID_DVSN_CD: process.env.KIS_ORDER_EXCG_ID_DVSN_CD ?? 'KRX',
    SLL_TYPE: side === 'SELL' ? '01' : '', // 01:일반매도 / 매수는 공란 (공식 default)
    CNDT_PRIC: '',                          // 조건가격 — 스탑지정가 전용, 일반주문 공란
  };
}
/** 신스킴 order-rvsecncl 신규 필수 param. OFF 시 {} → byte-equivalent. */
export function nxtCancelParams(): Record<string, string> {
  if (!KIS_ORDER_TR_NXT_SCHEME_ENABLED) return {};
  return { EXCG_ID_DVSN_CD: process.env.KIS_ORDER_EXCG_ID_DVSN_CD ?? 'KRX' };
}

// ─── 실계좌 데이터 전용 클라이언트 설정 ───────────────────────────────────────
// 모의계좌 앱키 → 자동매매 주문 집행 (안전한 테스트)
// 실계좌 앱키   → 시장 데이터 조회만 (거래량 순위, 현재가, 투자자 수급 등)
// 주문은 모의계좌로, 데이터는 실계좌 키로 가져오는 하이브리드 구조

export const REAL_DATA_BASE = 'https://openapi.koreainvestment.com:9443';

/** 실계좌 데이터 전용 키가 설정되어 있는지 여부 */
export const HAS_REAL_DATA_CLIENT =
  !!(process.env.KIS_REAL_DATA_APP_KEY && process.env.KIS_REAL_DATA_APP_SECRET);

/** KIS 기본 URL 반환 (기존 server/ 호환) */
export function getKisBase(): string { return KIS_BASE; }
