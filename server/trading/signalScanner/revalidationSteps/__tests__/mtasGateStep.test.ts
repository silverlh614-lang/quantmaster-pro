// @responsibility mtasGateStep 회귀 테스트 — boundary 임계값(3) 검증

import { describe, expect, it } from 'vitest';
import { mtasGateStep } from '../mtasGateStep.js';

describe('mtasGateStep', () => {
  it('mtas > 3 — proceed=true', () => {
    const result = mtasGateStep({ stockName: '삼성전자', mtas: 5.5 });
    expect(result.proceed).toBe(true);
  });

  it('mtas = 3 — 차단 (boundary 정확 일치)', () => {
    const result = mtasGateStep({ stockName: '삼성전자', mtas: 3 });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.logMessage).toBe('[AutoTrade] 삼성전자 MTAS 3.0/10 진입 금지 — 타임프레임 불일치');
  });

  it('mtas = 0 — 차단 + failReasons 포함', () => {
    const result = mtasGateStep({ stockName: '삼성전자', mtas: 0 });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons).toEqual(['mtas_below_threshold(0.0)']);
    expect(result.stageLogValue).toBe('FAIL(mtas:0.0)');
  });

  it('mtas = 3.01 — 통과', () => {
    const result = mtasGateStep({ stockName: '삼성전자', mtas: 3.01 });
    expect(result.proceed).toBe(true);
  });
});
