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

  it('counterfactual learning persists under SELL_ONLY', () => {
    const result = deriveGateDecisionRouterResult({ riskFlags: { sellOnly: true } });
    expect(result.severity).toBe('SELL_ONLY');
    expect(result.counterfactualLearningAllowed).toBe(true);
    expect(result.lanes?.learning).toBe(true);
    expect(result.executionImpact).toBe('NONE');
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
