/**
 * 캐시 계층 설정 — 데이터 반감기(Half-life) 기반 TTL + KRX 장 시간 인식
 *
 * 계층별 TTL:
 *   분기급 (quarterly)  — 24시간: BOK 금리, 매크로 레짐 등
 *   주간급 (weekly)     — 12시간: 신용스프레드, 공급망, 섹터, FSI
 *   일간급 (daily)      —  6시간: 수급, 수출모멘텀, 상관관계
 *   실시간급 (realtime) —  2시간: 지정학 리스크, FOMC 센티먼트
 *
 * 장외 시간(15:30~09:00, 주말)에는 staleTime = Infinity → API 호출 0.
 */

const HOUR = 60 * 60 * 1000;

// ── Tiered TTL (장중 기준) ──────────────────────────────────────
export const CacheTTL = {
  QUARTERLY: 24 * HOUR,
  WEEKLY:    12 * HOUR,
  DAILY:      6 * HOUR,
  REALTIME:   2 * HOUR,
} as const;

// ── queryKey → 계층 매핑 ────────────────────────────────────────
const QUARTERLY_KEYS = ['macro-environment', 'extended-regime'];
const WEEKLY_KEYS    = ['economic-regime', 'credit-spreads', 'supply-chain', 'sector-orders', 'financial-stress'];
const DAILY_KEYS     = ['smart-money', 'export-momentum', 'global-correlation'];
const REALTIME_KEYS  = ['geo-risk', 'fomc-sentiment'];

function getTierTTL(queryKey: string): number {
  if (QUARTERLY_KEYS.includes(queryKey)) return CacheTTL.QUARTERLY;
  if (WEEKLY_KEYS.includes(queryKey))    return CacheTTL.WEEKLY;
  if (DAILY_KEYS.includes(queryKey))     return CacheTTL.DAILY;
  if (REALTIME_KEYS.includes(queryKey))  return CacheTTL.REALTIME;
  return CacheTTL.DAILY; // fallback
}

// ── KRX 장 시간 판별 ────────────────────────────────────────────
export function isKRXOpen(): boolean {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const h = kst.getHours();
  const day = kst.getDay(); // 0=일, 6=토
  // 평일 09:00 ~ 15:59 (장 마감 15:30이지만 여유 포함)
  return day >= 1 && day <= 5 && h >= 9 && h < 16;
}

// ── 최종 staleTime 계산 ─────────────────────────────────────────
/**
 * 장중이면 계층별 TTL 적용, 장외이면 Infinity(다음 장 시작까지 캐시 유지).
 */
export function getStaleTime(queryKey: string): number {
  if (!isKRXOpen()) return Infinity;
  return getTierTTL(queryKey);
}

// ── gcTime: persister가 localStorage에서 복원할 수 있는 최대 시간 ─
// 모든 쿼리에 대해 24시간 유지 (localStorage 복원 가능 범위)
export const PERSIST_GC_TIME = 24 * HOUR;
