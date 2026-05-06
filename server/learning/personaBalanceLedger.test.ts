// @responsibility ADR-0329 Phase 1 personaBalanceLedger 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyPersonaBalance,
  isPersonaBalanceLedgerDisabled,
  OVER_AGGRESSIVE_SELL_RATE,
  OVER_CONSERVATIVE_BUY_RATE,
  OVER_CONSERVATIVE_SELL_RATE,
  PERSONA_MIN_EVAL_SAMPLE,
} from './personaBalanceLedger.js';

const ORIGINAL_DISABLED = process.env.PERSONA_BALANCE_LEDGER_DISABLED;

beforeEach(() => {
  delete process.env.PERSONA_BALANCE_LEDGER_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.PERSONA_BALANCE_LEDGER_DISABLED;
  else process.env.PERSONA_BALANCE_LEDGER_DISABLED = ORIGINAL_DISABLED;
});

describe('SSOT 상수 (ADR-0329)', () => {
  it('PERSONA_MIN_EVAL_SAMPLE = 30', () => {
    expect(PERSONA_MIN_EVAL_SAMPLE).toBe(30);
  });
  it('OVER_CONSERVATIVE_BUY_RATE = 0.02', () => {
    expect(OVER_CONSERVATIVE_BUY_RATE).toBe(0.02);
  });
  it('OVER_CONSERVATIVE_SELL_RATE = 0.5', () => {
    expect(OVER_CONSERVATIVE_SELL_RATE).toBe(0.5);
  });
  it('OVER_AGGRESSIVE_SELL_RATE = 0.8', () => {
    expect(OVER_AGGRESSIVE_SELL_RATE).toBe(0.8);
  });
});

describe('isPersonaBalanceLedgerDisabled — ENV (ADR-0157)', () => {
  it('미설정 → false', () => {
    expect(isPersonaBalanceLedgerDisabled()).toBe(false);
  });
  it('"true" → true', () => {
    process.env.PERSONA_BALANCE_LEDGER_DISABLED = 'true';
    expect(isPersonaBalanceLedgerDisabled()).toBe(true);
  });
  it('"1" / "TRUE" → false (정확 비교)', () => {
    process.env.PERSONA_BALANCE_LEDGER_DISABLED = '1';
    expect(isPersonaBalanceLedgerDisabled()).toBe(false);
    process.env.PERSONA_BALANCE_LEDGER_DISABLED = 'TRUE';
    expect(isPersonaBalanceLedgerDisabled()).toBe(false);
  });
});

describe('classifyPersonaBalance', () => {
  it('ENV DISABLED → DISABLED', () => {
    process.env.PERSONA_BALANCE_LEDGER_DISABLED = 'true';
    const r = classifyPersonaBalance({
      buyEvaluations: 1000,
      buyExecuted: 100,
      sellEvaluations: 1000,
      sellExecuted: 200,
    });
    expect(r.verdict).toBe('DISABLED');
    expect(r.buyConversionRate).toBe(0);
  });

  it('표본 < 30 (buy 측) → INSUFFICIENT_SAMPLE', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 20,
      buyExecuted: 5,
      sellEvaluations: 100,
      sellExecuted: 50,
    });
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('표본 < 30 (sell 측) → INSUFFICIENT_SAMPLE', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: 10,
      sellEvaluations: 20,
      sellExecuted: 10,
    });
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('buy 0.01 + sell 0.6 → OVER_CONSERVATIVE_BUY (매수 거의 차단)', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 1000,
      buyExecuted: 10,    // 0.01 = 1%
      sellEvaluations: 100,
      sellExecuted: 60,   // 0.6 = 60%
    });
    expect(r.buyConversionRate).toBe(0.01);
    expect(r.sellConversionRate).toBe(0.6);
    expect(r.verdict).toBe('OVER_CONSERVATIVE_BUY');
  });

  it('boundary buy=0.02 정확 → HEALTHY (< 비교)', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: 2,     // 0.02
      sellEvaluations: 100,
      sellExecuted: 60,
    });
    expect(r.verdict).toBe('HEALTHY');
  });

  it('sell 0.85 → OVER_AGGRESSIVE_SELL', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: 10,
      sellEvaluations: 100,
      sellExecuted: 85,
    });
    expect(r.verdict).toBe('OVER_AGGRESSIVE_SELL');
  });

  it('boundary sell=0.8 정확 → HEALTHY (> 비교)', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: 10,
      sellEvaluations: 100,
      sellExecuted: 80,
    });
    expect(r.verdict).toBe('HEALTHY');
  });

  it('정상 매도 우세 (buy 0.05 + sell 0.4) → HEALTHY (페르소나 원칙 정상)', () => {
    // 페르소나 원칙은 매도 > 매수 가 정상. 본 ledger 는 *극단* 만 분류.
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: 5,
      sellEvaluations: 100,
      sellExecuted: 40,
    });
    expect(r.verdict).toBe('HEALTHY');
  });

  it('우선순위 — OVER_CONSERVATIVE_BUY 가 OVER_AGGRESSIVE_SELL 보다 먼저', () => {
    // sell=0.85 > 0.5 둘 다 충족하지만 buy=0.01 < 0.02 → OVER_CONSERVATIVE_BUY 우선
    const r = classifyPersonaBalance({
      buyEvaluations: 1000,
      buyExecuted: 10,
      sellEvaluations: 100,
      sellExecuted: 85,
    });
    expect(r.verdict).toBe('OVER_CONSERVATIVE_BUY');
  });

  it('buy=0 / sell=1.0 (극단) → OVER_CONSERVATIVE_BUY', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: 0,
      sellEvaluations: 100,
      sellExecuted: 100,
    });
    expect(r.verdict).toBe('OVER_CONSERVATIVE_BUY');
  });

  it('divide-by-zero 안전 — buyEvaluations=0', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 0,
      buyExecuted: 0,
      sellEvaluations: 100,
      sellExecuted: 50,
    });
    expect(r.buyConversionRate).toBe(0);
    expect(r.verdict).toBe('INSUFFICIENT_SAMPLE');
  });

  it('NaN 입력 안전 fallback', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: NaN,
      buyExecuted: NaN,
      sellEvaluations: 100,
      sellExecuted: 50,
    });
    expect(r.buyConversionRate).toBe(0);
  });

  it('음수 입력 안전 fallback', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: 100,
      buyExecuted: -5,    // 부정상
      sellEvaluations: 100,
      sellExecuted: 50,
    });
    expect(r.buyConversionRate).toBe(0);
  });

  it('Infinity 입력 안전 fallback', () => {
    const r = classifyPersonaBalance({
      buyEvaluations: Infinity,
      buyExecuted: 100,
      sellEvaluations: 100,
      sellExecuted: 50,
    });
    expect(r.buyConversionRate).toBe(0);
  });
});
