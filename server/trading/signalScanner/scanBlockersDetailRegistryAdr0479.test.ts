import { describe, expect, it } from 'vitest';
import { buildOperatorActionQueueAdr0480, getOperatorActionDetailRegistryEntryAdr0480 } from './operatorActionRouterAdr0480.js';

describe('ADR-0479 detail registry exposure with ADR-0480', () => {
  it('registers operator_actions detail entry for /scan_blockers_detail and /adr_trace 0480', () => {
    const report = buildOperatorActionQueueAdr0480({ sources: [{ adr: '0477', sectionId: 'router', code: 'selectedProvider', diagnosticKey: 'selectedProvider', diagnosticValue: 'selectedProvider=NONE', severity: 'DATA_UNAVAILABLE' }] });
    const entry = getOperatorActionDetailRegistryEntryAdr0480(report);
    expect(entry.sectionId).toBe('operator_actions');
    expect(entry.scanBlockersDetailHint).toContain('/scan_blockers_detail');
    expect(entry.adrTraceHint).toBe('/adr_trace 0480');
    expect(entry.render()).toContain('INVESTOR_FLOW_PROVIDER_UNWIRED');
  });
});
