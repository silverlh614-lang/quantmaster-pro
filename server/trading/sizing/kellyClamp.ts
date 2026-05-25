/**
 * @responsibility ADR-0168 매수비중 clamp SSOT — 레짐별 매수비중 산출 결과 안전 범위 강제 진입점
 *
 * audit-PR-520 §M3 직접 수리 — 두 위치 (signalScanner.ts:413 + preflight.ts:357) 의
 * `Math.min(1.5, Math.max(KELLY_FLOOR, rawKelly))` byte-equivalent 패턴이 매직 넘버 (1.5)
 * 와 inline 상수 (KELLY_FLOOR=0.15) 를 양쪽에 중복 보유해 drift 위험. 본 SSOT 가 단일
 * 진입점으로 흡수.
 *
 * 정책:
 * - KELLY_CAP = 1.5 (최대 매수비중 상한)
 * - KELLY_FLOOR = 0.15 (매수비중 하한선)
 * - applyKellyClamp(raw) → Math.min(KELLY_CAP, Math.max(KELLY_FLOOR, raw))
 *
 * 호출자 책임 (LIVE 매매 본체 동작 byte-equivalent 보존):
 * - 레짐별 매수비중 (regimeConfig.kellyMultiplier) 은 호출자 그대로 유지
 * - 진단 로그 형식 (`raw ×N → floor ×0.15 → 유효 ×N`) 도 호출자 그대로 유지
 * - 본 SSOT 는 *clamp 수치 정책* 만 단일화
 */

/** 매수비중 상한 캡 */
export const KELLY_CAP = 1.5;

/** 매수비중 하한선 — 정책 차단 외 경우 포지션이 의미 없이 작아지는 것을 방지 */
export const KELLY_FLOOR = 0.15;

/**
 * 레짐별 매수비중 산출 결과를 안전 범위로 강제. NaN/Infinity 입력은 KELLY_FLOOR 로 안전 fallback.
 *
 * @param rawKelly — 매수비중 산출 결과 (clamp 전)
 * @returns clamped 매수비중 (KELLY_FLOOR ≤ x ≤ KELLY_CAP)
 */
export function applyKellyClamp(rawKelly: number): number {
  if (!Number.isFinite(rawKelly)) {
    return KELLY_FLOOR;
  }
  return Math.min(KELLY_CAP, Math.max(KELLY_FLOOR, rawKelly));
}
