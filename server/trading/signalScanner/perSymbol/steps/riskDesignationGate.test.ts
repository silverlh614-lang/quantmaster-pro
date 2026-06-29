// @responsibility ADR-0658 위험·경고 지정 진입 게이트 테스트.

import { describe, it, expect, afterEach } from 'vitest';
import { evaluateRiskDesignationGate } from './riskDesignationGate.js';
import type { ScanCounters } from '../../scanDiagnostics.js';

function makeCounters(): ScanCounters {
  return { perStageDropoff: {} } as unknown as ScanCounters;
}

const ORIG = process.env.RISK_DESIGNATION_EXCLUSION_ENABLED;
afterEach(() => {
  if (ORIG === undefined) delete process.env.RISK_DESIGNATION_EXCLUSION_ENABLED;
  else process.env.RISK_DESIGNATION_EXCLUSION_ENABLED = ORIG;
});

describe('evaluateRiskDesignationGate (ADR-0658)', () => {
  it('위험 지정 quote(투자경고 02) → EXCLUDE + RISK_DESIGNATION_EXCLUDED + perStageDropoff BLOCKED', () => {
    delete process.env.RISK_DESIGNATION_EXCLUSION_ENABLED; // default ON
    const counters = makeCounters();
    const result = evaluateRiskDesignationGate({
      stockCode: '079650',
      stockName: '서산',
      reCheckQuote: { kisOfficialQuote: { designation: { marketWarnCode: '02' } } as never },
      scanCounters: counters,
    });
    expect(result.decision).toBe('EXCLUDE');
    expect(result.blockReason).toContain('RISK_DESIGNATION_EXCLUDED');
    expect(result.blockReason).toContain('투자경고');
    expect(counters.perStageDropoff.LIVE_ORDER_BLOCKED?.BLOCKED).toBe(1);
  });

  it('정상 종목 → PROCEED', () => {
    delete process.env.RISK_DESIGNATION_EXCLUSION_ENABLED;
    const result = evaluateRiskDesignationGate({
      stockCode: '005930',
      stockName: '삼성전자',
      reCheckQuote: { kisOfficialQuote: { designation: { marketWarnCode: '00' } } as never },
      scanCounters: makeCounters(),
    });
    expect(result.decision).toBe('PROCEED');
  });

  it('designation 결손 → PROCEED (graceful)', () => {
    delete process.env.RISK_DESIGNATION_EXCLUSION_ENABLED;
    const result = evaluateRiskDesignationGate({
      stockCode: '005930',
      stockName: '삼성전자',
      reCheckQuote: { kisOfficialQuote: {} as never },
      scanCounters: makeCounters(),
    });
    expect(result.decision).toBe('PROCEED');
  });

  it('flag =false → PROCEED (byte-identical, 위험 지정이어도 제외 미적용)', () => {
    process.env.RISK_DESIGNATION_EXCLUSION_ENABLED = 'false';
    const counters = makeCounters();
    const result = evaluateRiskDesignationGate({
      stockCode: '079650',
      stockName: '서산',
      reCheckQuote: { kisOfficialQuote: { designation: { marketWarnCode: '02' } } as never },
      scanCounters: counters,
    });
    expect(result.decision).toBe('PROCEED');
    expect(counters.perStageDropoff.LIVE_ORDER_BLOCKED).toBeUndefined();
  });
});
