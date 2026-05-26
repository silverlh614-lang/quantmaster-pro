// @responsibility ADR-0531 Gate0 정본 어댑터 — ResolvedRegimeSnapshot → Gate0RegimeView (legacy transitionState는 표시 라벨로만).

import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';
import type { Gate0RegimeView } from '../../../src/types/gate0Regime.js';

/**
 * ADR-0531: Gate0 레짐 정본 단일 접근자.
 * 정본 = resolveRegimeSnapshot()의 effectiveRegime(sanitize 적용). legacy
 * regimeBridge transitionState.effectiveRegime(getLiveRegime)은 정본과 다를 때만
 * deprecated/notUsedForDecision 라벨로 노출한다(의사결정·표시 1차 출처 금지).
 */
export function buildGate0RegimeView(snapshot: ResolvedRegimeSnapshot): Gate0RegimeView {
  const legacyEffective = snapshot.diagnostics?.effectiveRegime;
  const legacyDiverges = typeof legacyEffective === 'string' && legacyEffective !== snapshot.effectiveRegime;
  return {
    source: 'REGIME_RESOLVER_SNAPSHOT',
    effectiveRegime: snapshot.effectiveRegime,
    displayRegime: snapshot.displayRegime,
    detectedRegime: snapshot.detectedRegime,
    riskOverride: snapshot.riskOverride,
    providerIssue: snapshot.providerIssue,
    marketSignal: false,
    ...(legacyDiverges
      ? {
          legacy: {
            legacyEffective,
            deprecated: true,
            notUsedForDecision: true,
            source: 'REGIME_BRIDGE_TRANSITION_STATE',
          },
        }
      : {}),
  };
}
