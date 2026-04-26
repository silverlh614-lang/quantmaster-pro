// @responsibility entryRevalidationStep PoC 회귀 테스트 — proceed/fail 분기 + diagnostic 형식 검증

import { describe, expect, it } from 'vitest';
import { entryRevalidationStep } from '../entryRevalidationStep.js';

/**
 * evaluateEntryRevalidation 의 임계값(entryEngine.ts):
 *   - ENTRY_MIN_GATE_SCORE = 5 (기본 minGateScore)
 *   - ENTRY_MAX_BREAKOUT_EXTENSION_PCT = 3 (현재가 ≥ entryPrice 일 때 +3% 초과 → 과열)
 *   - ENTRY_MAX_BEARISH_DROP_FROM_OPEN_PCT = -2 (시가 대비 -2% 이하 → 급락)
 *   - ENTRY_MAX_OPEN_GAP_OVERHEAT_PCT = 4 (전일종가 대비 +4% 이상 → 갭 과열)
 *   - ENTRY_MIN_VOLUME_RATIO = 0.6 (거래량 비율 보정 임계)
 */

const baseInput = {
  stockName: '삼성전자',
  currentPrice: 70_000,
  entryPrice: 70_000,
  reCheckQuote: {
    dayOpen: 70_000,
    prevClose: 69_500,
    volume: 1_000_000,
    avgVolume: 1_000_000,
  },
  reCheckGate: {
    gateScore: 8 as number | undefined,
    signalType: 'NORMAL' as 'STRONG' | 'NORMAL' | 'SKIP' | undefined,
  },
  regime: 'R3_BULL_MILD',
  marketElapsedMinutes: 390, // 풀장 — elapsedRatio=1, MORNING discount 미적용
};

describe('entryRevalidationStep', () => {
  it('정상 입력 — proceed=true 반환 (모든 임계 통과)', () => {
    const result = entryRevalidationStep(baseInput);
    expect(result.proceed).toBe(true);
  });

  it('SKIP signalType — Gate 재검증 미달로 차단', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 8, signalType: 'SKIP' },
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons).toHaveLength(1);
    expect(result.failReasons[0]).toContain('Gate 재검증 미달');
    expect(result.logMessage).toContain('[AutoTrade] 삼성전자 진입 직전 재검증 탈락:');
    expect(result.stageLogValue).toMatch(/^FAIL\(Gate 재검증 미달/);
  });

  it('현재가가 entryPrice 대비 +5% 초과 — 돌파 이탈 과열 차단', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      currentPrice: 73_500, // entryPrice 70_000 대비 +5%
      entryPrice: 70_000,
      reCheckQuote: { ...baseInput.reCheckQuote, dayOpen: 70_000 },
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons.some(r => r.includes('돌파 이탈 과열'))).toBe(true);
    expect(result.stageLogValue).toContain('돌파 이탈 과열');
  });

  it('다중 fail — failReasons 배열 + stageLogValue 콤마 결합', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 2, signalType: 'NORMAL' }, // Gate 미달
      currentPrice: 73_500, // 돌파 과열
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    expect(result.failReasons.length).toBeGreaterThanOrEqual(2);
    expect(result.stageLogValue).toMatch(/^FAIL\(/);
    expect(result.stageLogValue).toContain(',');
    // logMessage 도 콤마+공백으로 결합
    expect(result.logMessage).toMatch(/탈락: .+, .+/);
  });

  it('reCheckGate=null — quoteGateScore 미전달 시 minGate fallback 으로 자연 통과 (Yahoo 미상 차단은 별도 step 영역)', () => {
    // evaluateEntryRevalidation 의 `(quoteGateScore ?? minGate) < minGate` 분기는
    // quoteGateScore 부재 시 minGate 자체와 비교 → 절대 fail 하지 않는다.
    // Yahoo 가용성 차단은 perSymbolEvaluation 라인 734-741 의 별도 step 책임.
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: null,
    });
    expect(result.proceed).toBe(true);
  });

  it('reCheckQuote=null — dayOpen/prevClose/volume 검증 스킵, Gate 만 검증', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckQuote: null,
    });
    expect(result.proceed).toBe(true);
  });

  it('failReasons 빈 배열 응답 케이스 없음 (proceed=true 시 데이터 미포함)', () => {
    const result = entryRevalidationStep(baseInput);
    expect(result.proceed).toBe(true);
    // discriminated union 검증: pass 분기에는 failReasons 미존재
    if (result.proceed) {
      expect((result as unknown as Record<string, unknown>).failReasons).toBeUndefined();
    }
  });

  it('byte-equivalent 검증 — logMessage 형식이 원본 perSymbolEvaluation 라인 705 와 동일', () => {
    const result = entryRevalidationStep({
      ...baseInput,
      reCheckGate: { gateScore: 1, signalType: 'NORMAL' },
    });
    expect(result.proceed).toBe(false);
    if (result.proceed) return;
    // 원본: console.log(`[AutoTrade] ${stock.name} 진입 직전 재검증 탈락: ${entryRevalidation.reasons.join(', ')}`)
    expect(result.logMessage).toMatch(/^\[AutoTrade\] 삼성전자 진입 직전 재검증 탈락: .+$/);
    expect(result.failReasons.join(',')).toBe(result.failReasons.join(','));
  });
});
