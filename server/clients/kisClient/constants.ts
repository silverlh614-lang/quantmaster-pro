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
export const BUY_TR_ID   = KIS_IS_REAL ? 'TTTC0802U' : 'VTTC0802U';
export const SELL_TR_ID  = KIS_IS_REAL ? 'TTTC0801U' : 'VTTC0801U';
export const CCLD_TR_ID  = KIS_IS_REAL ? 'TTTC8001R' : 'VTTC8001R';

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
