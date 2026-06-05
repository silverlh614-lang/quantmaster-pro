import { describe, expect, it } from 'vitest';
import { deriveGateDecisionRouterResult, formatGateDecisionRouterSection } from './gateDecisionRouter.js';

describe('ADR-0462 GateDecisionRouter semantics', () => {
  it('counterfactual learning persists under HARD_BLOCK', () => {
    const result = deriveGateDecisionRouterResult({ riskFlags: { vixBlock: true } });
    expect(result.severity).toBe('MACRO_LIVE_BLOCK');
    expect(result.shadowAllowed).toBe(true);
    expect(result.watchAllowed).toBe(true);
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.lanes?.counterfactual).toBe(true);
    expect(result.executionImpact).toBe('NONE');
  });

  // always-on rollback: legacy SELL_ONLY 는 forensic-only (gateDecisionRouter L185) — severity 는
  // SELL_ONLY 가 아니라 WATCH_ONLY(UNKNOWN) 로 분류된다. 본 테스트의 핵심 의도("counterfactual
  // learning 은 SELL_ONLY 시점에도 살아있다")는 그대로 보존: counterfactualLearningAllowed=true.
  // UNKNOWN 분기는 lanes/executionImpact 구조체를 채우지 않으나, formatter 는 fallback 으로
  // executionImpact NONE 를 표시한다 (아래 'formatted router output' 테스트가 별도 검증).
  it('counterfactual learning persists under legacy SELL_ONLY (forensic-only → WATCH_ONLY)', () => {
    const result = deriveGateDecisionRouterResult({ riskFlags: { sellOnly: true } });
    expect(result.severity).toBe('WATCH_ONLY');
    expect(result.liveAllowed).toBe(false);
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(formatGateDecisionRouterSection(result) ?? '').toContain('executionImpact: NONE');
  });

  it('SectorEnergy DEGRADED does not become execution HARD_BLOCK and learning lane stays true', () => {
    const result = deriveGateDecisionRouterResult({
      sectorEnergyDiagnostic: {
        dataQuality: 'DEGRADED', reasons: ['INDEX_CODE_COVERAGE_LOW'], validSectorCount: 10, expectedSectorCount: 12, indexCodeCoverage: 0.275, missingIndexCodeCount: 66, totalSectorRows: 91, fallbackUsed: 'STOCK_DAILY', symmetryValidationPassed: false, shouldBlockLeadershipConfidence: true, operatorMessage: 'degraded',
      },
    });
    expect(result.severity).toBe('SOFT_DEGRADE');
    expect(result.liveAllowed).toBe(false);
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.executionImpact).toBe('NONE');
  });

  it('formatted router output shows distinct lanes and executionImpact', () => {
    const result = deriveGateDecisionRouterResult({ riskFlags: { sellOnly: true } });
    const text = formatGateDecisionRouterSection(result) ?? '';
    expect(text).toContain('counterfactual=✅');
    expect(text).toContain('executionImpact: NONE');
  });
});
