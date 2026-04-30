// @responsibility classifyExitOutcome SSOT 회귀 테스트 — ADR-0112
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyExitOutcome,
  classifyFillOutcome,
  EXIT_OUTCOME_THRESHOLDS,
  isBreakEvenClassificationDisabled,
} from './exitOutcomeClassifier.js';

const ORIGINAL_ENV = process.env.BE_CLASSIFICATION_DISABLED;

beforeEach(() => {
  delete process.env.BE_CLASSIFICATION_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.BE_CLASSIFICATION_DISABLED;
  else process.env.BE_CLASSIFICATION_DISABLED = ORIGINAL_ENV;
});

describe('EXIT_OUTCOME_THRESHOLDS SSOT', () => {
  it('WIN/LOSS/BE 임계값 정합', () => {
    expect(EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN).toBe(1.0);
    expect(EXIT_OUTCOME_THRESHOLDS.LOSS_PCT_MAX).toBe(-0.5);
    expect(EXIT_OUTCOME_THRESHOLDS.BE_PCT_MIN).toBe(-0.5);
    expect(EXIT_OUTCOME_THRESHOLDS.BE_PCT_MAX).toBe(0.5);
  });
  it('BE band 가 LOSS 와 겹치지 않음 (LOSS_PCT_MAX === BE_PCT_MIN)', () => {
    expect(EXIT_OUTCOME_THRESHOLDS.LOSS_PCT_MAX).toBe(EXIT_OUTCOME_THRESHOLDS.BE_PCT_MIN);
  });
});

describe('isBreakEvenClassificationDisabled — ENV 우회', () => {
  it('미설정 → false (기본 동작)', () => {
    expect(isBreakEvenClassificationDisabled()).toBe(false);
  });
  it('"true" → 우회 활성', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    expect(isBreakEvenClassificationDisabled()).toBe(true);
  });
  it('"false" → 우회 비활성', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'false';
    expect(isBreakEvenClassificationDisabled()).toBe(false);
  });
});

describe('classifyExitOutcome — 우선순위 SSOT', () => {
  describe('명시 WIN 룰 (우선순위 3)', () => {
    it('TARGET_EXIT → WIN (returnPct 무관)', () => {
      expect(classifyExitOutcome(5.0, 'TARGET_EXIT')).toBe('WIN');
      expect(classifyExitOutcome(-3.0, 'TARGET_EXIT')).toBe('WIN');
    });
    it('EUPHORIA_PARTIAL → WIN', () => {
      expect(classifyExitOutcome(8.0, 'EUPHORIA_PARTIAL')).toBe('WIN');
    });
  });

  describe('PROFIT_PROTECTION BE 분기 (우선순위 4 — 1차 로그 시나리오)', () => {
    it('1차 로그 코스맥스 -0.30% PROFIT_PROTECTION → BE', () => {
      expect(classifyExitOutcome(-0.30, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('BE');
    });
    it('1차 로그 한국콜마 -0.18% PROFIT_PROTECTION → BE', () => {
      expect(classifyExitOutcome(-0.18, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('BE');
    });
    it('1차 로그 에코프로HN -0.45% PROFIT_PROTECTION → BE', () => {
      expect(classifyExitOutcome(-0.45, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('BE');
    });
    it('PROFIT_PROTECTION +0.4% (수익 영역) → BE', () => {
      expect(classifyExitOutcome(0.4, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('BE');
    });
    it('PROFIT_PROTECTION 경계값 정확히 -0.5% → BE', () => {
      expect(classifyExitOutcome(-0.5, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('BE');
    });
    it('PROFIT_PROTECTION 경계값 정확히 +0.5% → BE', () => {
      expect(classifyExitOutcome(0.5, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('BE');
    });
    it('PROFIT_PROTECTION -0.51% → LOSS (band 밖)', () => {
      expect(classifyExitOutcome(-0.51, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('LOSS');
    });
    it('PROFIT_PROTECTION +1.0% → WIN (band 위, 우선순위 6)', () => {
      expect(classifyExitOutcome(1.0, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('WIN');
    });
    it('INITIAL stopLossExitType 은 BE 분기 미적용 → LOSS', () => {
      expect(classifyExitOutcome(-0.30, 'HARD_STOP', 'INITIAL')).toBe('BE');
      // INITIAL 은 PROFIT_PROTECTION 이 아니므로 휴리스틱 BE band 폴백 (우선순위 7)
    });
    it('REGIME stopLossExitType 도 휴리스틱 BE band 적용', () => {
      expect(classifyExitOutcome(-0.30, 'HARD_STOP', 'REGIME')).toBe('BE');
    });
  });

  describe('ENTRY_CIRCUIT_BREAKER BE 분기 (우선순위 5)', () => {
    it('ENTRY_CIRCUIT_BREAKER -0.3% → BE', () => {
      expect(classifyExitOutcome(-0.3, 'ENTRY_CIRCUIT_BREAKER')).toBe('BE');
    });
    it('ENTRY_CIRCUIT_BREAKER -3% (band 밖) → LOSS', () => {
      expect(classifyExitOutcome(-3.0, 'ENTRY_CIRCUIT_BREAKER')).toBe('LOSS');
    });
  });

  describe('명백 WIN/LOSS (우선순위 6, 8)', () => {
    it('+1.0% 정확 → WIN', () => {
      expect(classifyExitOutcome(1.0, 'HARD_STOP')).toBe('WIN');
    });
    it('+5.0% → WIN', () => {
      expect(classifyExitOutcome(5.0, 'HARD_STOP')).toBe('WIN');
    });
    it('-3.0% → LOSS', () => {
      expect(classifyExitOutcome(-3.0, 'HARD_STOP')).toBe('LOSS');
    });
    it('-15.0% → LOSS', () => {
      expect(classifyExitOutcome(-15.0, 'CASCADE_HALF_SELL')).toBe('LOSS');
    });
  });

  describe('BE band 휴리스틱 (우선순위 7) — 룰 미명시', () => {
    it('-0.3% 룰 미명시 → BE', () => {
      expect(classifyExitOutcome(-0.3)).toBe('BE');
    });
    it('+0.4% 룰 미명시 → BE', () => {
      expect(classifyExitOutcome(0.4)).toBe('BE');
    });
    it('0.0% 정확 → BE', () => {
      expect(classifyExitOutcome(0.0)).toBe('BE');
    });
  });

  describe('보수적 fallback (우선순위 9) — +0.5 < returnPct < +1.0', () => {
    it('+0.7% → LOSS (보수적, 표본 미달)', () => {
      expect(classifyExitOutcome(0.7, 'HARD_STOP')).toBe('LOSS');
    });
    it('+0.99% → LOSS', () => {
      expect(classifyExitOutcome(0.99)).toBe('LOSS');
    });
  });

  describe('NaN/Infinity 안전 fallback (우선순위 2)', () => {
    it('NaN → LOSS', () => {
      expect(classifyExitOutcome(NaN, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('LOSS');
    });
    it('Infinity → LOSS', () => {
      expect(classifyExitOutcome(Infinity, 'HARD_STOP')).toBe('LOSS');
    });
    it('-Infinity → LOSS', () => {
      expect(classifyExitOutcome(-Infinity, 'HARD_STOP')).toBe('LOSS');
    });
  });

  describe('ENV 우회 (우선순위 1) — BE_CLASSIFICATION_DISABLED', () => {
    beforeEach(() => {
      process.env.BE_CLASSIFICATION_DISABLED = 'true';
    });
    it('PROFIT_PROTECTION -0.30% → LOSS (BE 분류 비활성)', () => {
      expect(classifyExitOutcome(-0.30, 'HARD_STOP', 'PROFIT_PROTECTION')).toBe('LOSS');
    });
    it('+1.0% → WIN', () => {
      expect(classifyExitOutcome(1.0, 'HARD_STOP')).toBe('WIN');
    });
    it('+0.5% → LOSS (이전 동작 — BE band 무시)', () => {
      expect(classifyExitOutcome(0.5, 'HARD_STOP')).toBe('LOSS');
    });
    it('NaN → LOSS', () => {
      expect(classifyExitOutcome(NaN, 'HARD_STOP')).toBe('LOSS');
    });
    it('TARGET_EXIT 도 returnPct 기준 적용 (ENV 우회 모드)', () => {
      expect(classifyExitOutcome(-3.0, 'TARGET_EXIT')).toBe('LOSS');
    });
  });
});

describe('classifyFillOutcome — fill 단위 휴리스틱', () => {
  it('+5% → WIN', () => {
    expect(classifyFillOutcome(5.0)).toBe('WIN');
  });
  it('+0.4% → BE', () => {
    expect(classifyFillOutcome(0.4)).toBe('BE');
  });
  it('+1.0% 정확 → WIN', () => {
    expect(classifyFillOutcome(1.0)).toBe('WIN');
  });
  it('-0.3% → BE', () => {
    expect(classifyFillOutcome(-0.3)).toBe('BE');
  });
  it('-5% → LOSS', () => {
    expect(classifyFillOutcome(-5.0)).toBe('LOSS');
  });
  it('NaN → LOSS', () => {
    expect(classifyFillOutcome(NaN)).toBe('LOSS');
  });
  it('ENV 우회 시 +0.4% → WIN (이전 동작 pnlPct > 0)', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    expect(classifyFillOutcome(0.4)).toBe('WIN');
  });
  it('ENV 우회 시 0% → BE', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    expect(classifyFillOutcome(0.0)).toBe('BE');
  });
});
