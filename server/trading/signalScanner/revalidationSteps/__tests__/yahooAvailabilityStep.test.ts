// @responsibility yahooAvailabilityStep 회귀 테스트

import { describe, expect, it } from 'vitest';
import { yahooAvailabilityStep } from '../yahooAvailabilityStep.js';

describe('yahooAvailabilityStep', () => {
  it('reCheckGate 객체 존재 — proceed=true', () => {
    const result = yahooAvailabilityStep({
      stockName: '삼성전자',
      reCheckGate: { gateScore: 8 },
    });
    expect(result.proceed).toBe(true);
  });

  it('reCheckGate=null — Yahoo 조회 실패 차단', () => {
    const result = yahooAvailabilityStep({ stockName: '삼성전자', reCheckGate: null });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.logMessage).toBe('[AutoTrade] 삼성전자 Yahoo 조회 실패 — 재검증 불가, 진입 보류');
    expect(result.failReasons).toEqual(['yahoo_unavailable']);
    expect(result.stageLogValue).toBe('FAIL(yahoo_unavailable)');
  });
});
