// @responsibility Maximum Drawdown 단일 SSOT — additive vs compound 수학 통합 + 부호 정합 강제
/**
 * mddCalculator.ts — ADR-0129 MDD SSOT 통합
 *
 * 사용자 4/30 보고 — `recommendationTracker` 가 additive sum 으로 음수 반환,
 * `walkForwardFramework` 가 compound equity 로 양수 반환. 동일 입력 다른 결과
 * → 운영자 의사결정 신뢰 손상. 본 모듈이 수학 + 부호 단일 SSOT.
 *
 * 규약:
 * - **NEGATIVE 반환** (예: -9.12 = peak 대비 9.12% 하락). 사용자 보고 메시지
 *   `MDD: -17.80%` 부호 일관 + Math.min 누적 자연 정합.
 * - 기본 모드: **'compound'** (재무적으로 정확). 'additive' 는 후방호환용.
 * - NaN/Infinity 입력은 0 으로 치환 후 계산 (안전 fallback).
 * - 빈 배열/단일 원소 → 0 (drawdown 측정 불가).
 *
 * ENV 우회:
 * - `MDD_SSOT_MODE=additive` — default mode 오버라이드.
 * - `MDD_SSOT_LEGACY_SIGN_DISABLED=true` — walkForwardFramework 호환을 위해
 *   computeMaxDrawdownLegacyPositive() 가 양수 반환 (기존 동작 복원).
 */

export type MddMode = 'compound' | 'additive';

export const MDD_SSOT_CONSTANTS = {
  DEFAULT_MODE: 'compound' as MddMode,
} as const;

/**
 * Maximum Drawdown 계산 SSOT.
 *
 * @param returnsPct trade 단위 수익률 (%). 예: [+5, -3, +2, -10, +1]
 * @param mode       'compound' (default, 복리) | 'additive' (단순 가산)
 * @returns NEGATIVE 백분율. 빈 배열/안전 fallback 시 0.
 */
export function computeMaxDrawdown(
  returnsPct: number[],
  mode: MddMode = resolveDefaultMode(),
): number {
  if (!Array.isArray(returnsPct) || returnsPct.length === 0) return 0;

  // NaN/Infinity 안전 치환
  const safe = returnsPct.map((r) => (Number.isFinite(r) ? r : 0));

  if (mode === 'additive') {
    // 단순 가산 — peak 대비 누적값 차이
    let peak = 0;
    let cumulative = 0;
    let maxDd = 0;
    for (const r of safe) {
      cumulative += r;
      if (cumulative > peak) peak = cumulative;
      const dd = cumulative - peak; // 항상 ≤ 0
      if (dd < maxDd) maxDd = dd;
    }
    return maxDd; // NEGATIVE
  }

  // compound — equity 시계열 (시작 1.0)
  let equity = 1;
  let peak = 1;
  let maxDdRatio = 0; // [0, 1] 범위
  for (const r of safe) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const ddRatio = (peak - equity) / peak; // 항상 ≥ 0
      if (ddRatio > maxDdRatio) maxDdRatio = ddRatio;
    }
  }
  // -0 → +0 정규화 (Object.is 동등성 보장)
  return maxDdRatio === 0 ? 0 : -maxDdRatio * 100;
}

/**
 * 후방호환 — walkForwardFramework 의 기존 양수 반환 유지용.
 * 신규 호출자는 사용 금지. ENV `MDD_SSOT_LEGACY_SIGN_DISABLED=true` 명시 시에만
 * 호출자가 직접 사용 (walkForwardFramework / shadowWalkForwardFramework).
 */
export function computeMaxDrawdownLegacyPositive(returnsPct: number[]): number {
  const negative = computeMaxDrawdown(returnsPct, 'compound');
  // -0 → +0 정규화
  return negative === 0 ? 0 : -negative;
}

/** ENV `MDD_SSOT_MODE` 가 'additive' 면 그 값, 그 외엔 default ('compound'). */
function resolveDefaultMode(): MddMode {
  const raw = process.env.MDD_SSOT_MODE;
  if (raw === 'additive') return 'additive';
  return MDD_SSOT_CONSTANTS.DEFAULT_MODE;
}

/** ENV 체크 헬퍼 — walkForwardFramework 가 부호 결정용. */
export function isMddLegacySignDisabled(): boolean {
  return process.env.MDD_SSOT_LEGACY_SIGN_DISABLED === 'true';
}
