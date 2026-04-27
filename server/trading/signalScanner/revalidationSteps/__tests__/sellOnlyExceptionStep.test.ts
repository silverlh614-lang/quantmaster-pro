// @responsibility sellOnlyExceptionStep 회귀 테스트 — allow off / liveGate 차단 / MTAS 차단 / 통과 4 분기

import { describe, expect, it } from 'vitest';
import { sellOnlyExceptionStep } from '../sellOnlyExceptionStep.js';

describe('sellOnlyExceptionStep', () => {
  it('sellOnlyExc.allow=false — 게이트 비활성, 항상 통과', () => {
    const result = sellOnlyExceptionStep({
      stockName: '삼성전자',
      sellOnlyExc: { allow: false, minLiveGate: 8, minMtas: 5 },
      liveGateScore: 1,
      mtas: 0,
    });
    expect(result.proceed).toBe(true);
  });

  it('liveGate 미달 — 차단', () => {
    const result = sellOnlyExceptionStep({
      stockName: '삼성전자',
      sellOnlyExc: { allow: true, minLiveGate: 8, minMtas: 5 },
      liveGateScore: 7.5,
      mtas: 6,
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.logMessage).toBe('[AutoTrade/SellOnlyExc] 삼성전자 liveGate 7.50 < 8 — 예외 진입 차단');
  });

  it('liveGate 통과 + MTAS 미달 — 차단', () => {
    const result = sellOnlyExceptionStep({
      stockName: '삼성전자',
      sellOnlyExc: { allow: true, minLiveGate: 8, minMtas: 5 },
      liveGateScore: 8.5,
      mtas: 4.5,
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.logMessage).toBe('[AutoTrade/SellOnlyExc] 삼성전자 MTAS 4.5 < 5 — 예외 진입 차단');
  });

  it('liveGate + MTAS 모두 통과 — proceed=true', () => {
    const result = sellOnlyExceptionStep({
      stockName: '삼성전자',
      sellOnlyExc: { allow: true, minLiveGate: 8, minMtas: 5 },
      liveGateScore: 9,
      mtas: 6,
    });
    expect(result.proceed).toBe(true);
  });
});
