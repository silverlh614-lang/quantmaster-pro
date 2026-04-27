// @responsibility format 유틸 함수 모듈
/**
 * 숫자 렌더링 안전 유틸 — 트레이딩/거래내역 카드에서 `.toLocaleString()` /
 * `.toFixed()` 를 unchecked 호출해 TypeError 로 카드 전체가 사라지던 이슈를
 * 막기 위한 최소 래퍼. undefined · null · NaN 은 `placeholder` 로 떨어진다.
 */

const DASH = '—';

/** 원화 금액 포맷. 기본값 '—'. `suffix` 로 단위를 붙일 수 있다. */
export function fmtKrw(value: unknown, opts?: { suffix?: string; placeholder?: string }): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return opts?.placeholder ?? DASH;
  return `${Math.round(n).toLocaleString()}${opts?.suffix ?? ''}`;
}

/** 주식 수량 포맷. */
export function fmtQty(value: unknown, opts?: { placeholder?: string }): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return opts?.placeholder ?? DASH;
  return `${Math.floor(n).toLocaleString()}주`;
}

/** 가격(종목 현재가·평단 등). 단위는 호출부에서 붙일 것. */
export function fmtPrice(value: unknown, opts?: { placeholder?: string }): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return opts?.placeholder ?? DASH;
  return n.toLocaleString();
}

/** 퍼센트 포맷. 기본 소수 2자리, 부호 포함. */
export function fmtPct(value: unknown, digits = 2, opts?: { placeholder?: string }): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return opts?.placeholder ?? DASH;
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
