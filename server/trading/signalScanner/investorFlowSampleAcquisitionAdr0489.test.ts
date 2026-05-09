// @responsibility ADR-0489 investor-flow sample acquisition probe smoke tests.
import { describe, expect, it } from 'vitest';
import { buildInvestorFlowSampleAcquisitionReportAdr0489 } from './investorFlowSampleAcquisitionAdr0489.js';

describe('ADR-0489 investor-flow sample acquisition probe', () => {
  it('builds sanitized diagnostic-only sample report', () => {
    const report = buildInvestorFlowSampleAcquisitionReportAdr0489([{ code: '005930', provider: 'NAVER', status: 'OK', signal: 'UNKNOWN', confidence: 'LOW', coverageRatio: 0.5 }]);
    expect(report.status).toBe('SAMPLED');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });
});
