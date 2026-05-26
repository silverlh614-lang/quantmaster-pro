import { describe, expect, it } from 'vitest';
import { buildGate0RegimeView } from './gate0RegimeView.js';
import type { ResolvedRegimeSnapshot } from './effectiveRegimeSnapshot.js';

function snapshot(overrides: Partial<ResolvedRegimeSnapshot> & { diagnostics?: { effectiveRegime?: string } }): ResolvedRegimeSnapshot {
  return {
    detectedRegime: 'R3_EARLY',
    effectiveRegime: 'R3_EARLY',
    displayRegime: 'SHADOW_ONLY',
    riskOverride: 'SHADOW_ONLY',
    providerIssue: false,
    marketSignal: false,
    diagnostics: { effectiveRegime: 'R3_EARLY' },
    ...overrides,
  } as unknown as ResolvedRegimeSnapshot;
}

describe('ADR-0531 buildGate0RegimeView — Gate0 정본 어댑터', () => {
  it('정본 effectiveRegime 을 그대로 매핑하고 source=REGIME_RESOLVER_SNAPSHOT', () => {
    const view = buildGate0RegimeView(snapshot({ effectiveRegime: 'R3_EARLY' }));
    expect(view.source).toBe('REGIME_RESOLVER_SNAPSHOT');
    expect(view.effectiveRegime).toBe('R3_EARLY');
    expect(view.marketSignal).toBe(false);
  });

  it('legacy transitionState 가 정본과 다르면 deprecated/notUsedForDecision 라벨로만 노출', () => {
    const view = buildGate0RegimeView(snapshot({
      effectiveRegime: 'R3_EARLY',
      diagnostics: { effectiveRegime: 'R5_CAUTION' } as ResolvedRegimeSnapshot['diagnostics'],
    }));
    expect(view.effectiveRegime).toBe('R3_EARLY');
    expect(view.legacy).toBeDefined();
    expect(view.legacy?.legacyEffective).toBe('R5_CAUTION');
    expect(view.legacy?.deprecated).toBe(true);
    expect(view.legacy?.notUsedForDecision).toBe(true);
    expect(view.legacy?.source).toBe('REGIME_BRIDGE_TRANSITION_STATE');
  });

  it('legacy 가 정본과 같으면 legacy 라벨 생략', () => {
    const view = buildGate0RegimeView(snapshot({
      effectiveRegime: 'R3_EARLY',
      diagnostics: { effectiveRegime: 'R3_EARLY' } as ResolvedRegimeSnapshot['diagnostics'],
    }));
    expect(view.legacy).toBeUndefined();
  });
});
