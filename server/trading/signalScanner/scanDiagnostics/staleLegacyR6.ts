// @responsibility Single SSOT for the stale legacy-R6 leak-block decision shared by regime resolvers.

/**
 * 폐기된 legacy R6-recovery transition machine 의 effectiveRegime 이 stale 하게 R6_DEFENSE 로
 * 끼어 있는데 표시/실행 regime 은 R6 가 아닐 때, scoring/진단 effective 를 raw 로 되돌려 누출을
 * 차단하는 단일 결정. ADR-0531(macroRegimeEffective 폐기) 정합.
 *
 * 본 모듈은 `resolveScoringEffectiveRegime`(gate0MacroPermissionDecision) 와
 * `buildCanonicalRegimeDiagnostics`(state/scanEvaluationState) 에 중복돼 있던 동일 ternary 의
 * SSOT 다. 각 호출자는 입력(rawRegime/legacyEffectiveRegime/displayRegime) 을 자기 방식대로
 * 도출한 뒤(요청 override·riskOverride fallback 등 차이는 호출자 고유) 본 결정만 공유한다 —
 * 결정 규칙 drift 를 방지한다. 입력 도출은 통합하지 않는다(호출자별로 의도적으로 다름).
 */
export interface StaleLegacyR6Input {
  /** legacy(폐기) R6-recovery transition 의 effective regime 후보. */
  legacyEffectiveRegime: string;
  /** 표시 regime(정본 sanitize 계열). */
  displayRegime: string;
  /** 실행 regime(macroGateState.regime, sanitize 정본). */
  regime: string | undefined;
  /** raw 감지 regime — stale 판정 시 복귀 대상. */
  rawRegime: string;
}

export interface StaleLegacyR6Result {
  /** 누출 차단 적용 후 canonical effective regime. */
  effectiveRegime: string;
  /** legacy R6 가 표시/실행 정본과 어긋나(stale 의심) raw 로 되돌렸는지. */
  staleLegacyR6: boolean;
}

export function resolveStaleLegacyR6(input: StaleLegacyR6Input): StaleLegacyR6Result {
  const staleLegacyR6 =
    input.legacyEffectiveRegime === 'R6_DEFENSE' &&
    input.displayRegime !== 'R6_DEFENSE' &&
    input.regime !== 'R6_DEFENSE';
  return {
    effectiveRegime: staleLegacyR6 ? input.rawRegime : input.legacyEffectiveRegime,
    staleLegacyR6,
  };
}
