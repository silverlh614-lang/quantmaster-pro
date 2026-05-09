import { describe, expect, it } from 'vitest';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';

describe('ADR-0477 investor flow provider router evidence for ADR-0480', () => {
  it('selectedProvider=NONE remains diagnostic action guidance only', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0477', sectionId: 'investor_flow_router', code: 'selectedProvider', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }] });
    expect(report.allActions[0].rootCause).toBe('INVESTOR_FLOW_PROVIDER_UNWIRED');
    expect(report.allActions[0].executionImpact).toBe('NONE');
    expect(report.allActions[0].liveExecutionAllowed).toBe(false);
  });
});
