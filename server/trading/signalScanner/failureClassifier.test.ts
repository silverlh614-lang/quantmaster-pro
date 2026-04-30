// @responsibility ADR-0115 failureClassifier SSOT 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyFailureSeverity,
  isDriftInvalidUniverseExcludeEnabled,
  isEntryPriceAutoCorrectDisabled,
  isExecutionRelaxationEnabled,
  isPreBreakoutFailCountDisabled,
  shouldIncrementFailCount,
} from './failureClassifier.js';

const ORIGINAL_ENV = {
  PRE_BREAKOUT_FAILCOUNT_DISABLED: process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED,
  ENTRY_PRICE_AUTO_CORRECT_DISABLED: process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED,
  EXECUTION_RELAXATION_ENABLED: process.env.EXECUTION_RELAXATION_ENABLED,
  DRIFT_INVALID_UNIVERSE_EXCLUDE: process.env.DRIFT_INVALID_UNIVERSE_EXCLUDE,
};

beforeEach(() => {
  delete process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED;
  delete process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED;
  delete process.env.EXECUTION_RELAXATION_ENABLED;
  delete process.env.DRIFT_INVALID_UNIVERSE_EXCLUDE;
});

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('classifyFailureSeverity — Critical/Non-Critical 분류 SSOT', () => {
  describe('CRITICAL — 종목 자체 데이터·상태 문제', () => {
    it('SPLIT_ANOMALY → CRITICAL', () => {
      expect(classifyFailureSeverity('SPLIT_ANOMALY')).toBe('CRITICAL');
    });
    it('KIS_MISMATCH → CRITICAL', () => {
      expect(classifyFailureSeverity('KIS_MISMATCH')).toBe('CRITICAL');
    });
    it('STALE_BASE → CRITICAL', () => {
      expect(classifyFailureSeverity('STALE_BASE')).toBe('CRITICAL');
    });
    it('TRADING_HALT → CRITICAL', () => {
      expect(classifyFailureSeverity('TRADING_HALT')).toBe('CRITICAL');
    });
    it('CORPORATE_ACTION → CRITICAL', () => {
      expect(classifyFailureSeverity('CORPORATE_ACTION')).toBe('CRITICAL');
    });
  });

  describe('NON_CRITICAL — 일시적 조건 미충족', () => {
    it('PRE_BREAKOUT_MISS → NON_CRITICAL', () => {
      expect(classifyFailureSeverity('PRE_BREAKOUT_MISS')).toBe('NON_CRITICAL');
    });
    it('VOLUME_DECREASE → NON_CRITICAL', () => {
      expect(classifyFailureSeverity('VOLUME_DECREASE')).toBe('NON_CRITICAL');
    });
    it('GATE_REVALIDATION_FAIL → NON_CRITICAL', () => {
      expect(classifyFailureSeverity('GATE_REVALIDATION_FAIL')).toBe('NON_CRITICAL');
    });
    it('DRIFT_WARN → NON_CRITICAL', () => {
      expect(classifyFailureSeverity('DRIFT_WARN')).toBe('NON_CRITICAL');
    });
    it('ENTRY_PRICE_DEVIATION → NON_CRITICAL', () => {
      expect(classifyFailureSeverity('ENTRY_PRICE_DEVIATION')).toBe('NON_CRITICAL');
    });
  });
});

describe('shouldIncrementFailCount — failCount 증가 결정 SSOT', () => {
  it('Default (ADR-0115 정책) — CRITICAL 만 증가', () => {
    expect(shouldIncrementFailCount('STALE_BASE')).toBe(true);
    expect(shouldIncrementFailCount('CORPORATE_ACTION')).toBe(true);
    expect(shouldIncrementFailCount('PRE_BREAKOUT_MISS')).toBe(false);
    expect(shouldIncrementFailCount('VOLUME_DECREASE')).toBe(false);
    expect(shouldIncrementFailCount('GATE_REVALIDATION_FAIL')).toBe(false);
    expect(shouldIncrementFailCount('ENTRY_PRICE_DEVIATION')).toBe(false);
  });

  it('ENV PRE_BREAKOUT_FAILCOUNT_DISABLED=false → 레거시 (모든 사유 증가)', () => {
    process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED = 'false';
    expect(shouldIncrementFailCount('PRE_BREAKOUT_MISS')).toBe(true);
    expect(shouldIncrementFailCount('VOLUME_DECREASE')).toBe(true);
    expect(shouldIncrementFailCount('STALE_BASE')).toBe(true);
  });

  it('ENV "true" 명시 → 정책 적용 (기본과 동일)', () => {
    process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED = 'true';
    expect(shouldIncrementFailCount('PRE_BREAKOUT_MISS')).toBe(false);
    expect(shouldIncrementFailCount('STALE_BASE')).toBe(true);
  });
});

describe('ENV 우회 헬퍼 default 동작', () => {
  it('isPreBreakoutFailCountDisabled — 미설정 default true', () => {
    expect(isPreBreakoutFailCountDisabled()).toBe(true);
  });
  it('isPreBreakoutFailCountDisabled — false 명시 → false', () => {
    process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED = 'false';
    expect(isPreBreakoutFailCountDisabled()).toBe(false);
  });

  it('isEntryPriceAutoCorrectDisabled — 미설정 default true (자동보정 차단)', () => {
    expect(isEntryPriceAutoCorrectDisabled()).toBe(true);
  });
  it('isEntryPriceAutoCorrectDisabled — false 명시 → ADR-0113 레거시 복원', () => {
    process.env.ENTRY_PRICE_AUTO_CORRECT_DISABLED = 'false';
    expect(isEntryPriceAutoCorrectDisabled()).toBe(false);
  });

  it('isExecutionRelaxationEnabled — 미설정 default false (Gate3 그대로)', () => {
    expect(isExecutionRelaxationEnabled()).toBe(false);
  });
  it('isExecutionRelaxationEnabled — true 명시 → 완화 활성', () => {
    process.env.EXECUTION_RELAXATION_ENABLED = 'true';
    expect(isExecutionRelaxationEnabled()).toBe(true);
  });

  it('isDriftInvalidUniverseExcludeEnabled — 미설정 default true (격리 활성)', () => {
    expect(isDriftInvalidUniverseExcludeEnabled()).toBe(true);
  });
  it('isDriftInvalidUniverseExcludeEnabled — false 명시 → 비활성', () => {
    process.env.DRIFT_INVALID_UNIVERSE_EXCLUDE = 'false';
    expect(isDriftInvalidUniverseExcludeEnabled()).toBe(false);
  });
});

describe('1차 로그 시뮬 — failCount 영향 분석', () => {
  it('pre-breakout 미도달 시나리오 — default 정책 → failCount 미증가', () => {
    const reasonsThisScan: Array<'PRE_BREAKOUT_MISS' | 'PRE_BREAKOUT_MISS' | 'PRE_BREAKOUT_MISS'> = [
      'PRE_BREAKOUT_MISS', 'PRE_BREAKOUT_MISS', 'PRE_BREAKOUT_MISS',
    ];
    let failCount = 0;
    for (const r of reasonsThisScan) {
      if (shouldIncrementFailCount(r)) failCount++;
    }
    expect(failCount).toBe(0);
  });

  it('STALE_BASE 시나리오 — Critical → failCount 증가', () => {
    let failCount = 0;
    if (shouldIncrementFailCount('STALE_BASE')) failCount++;
    if (shouldIncrementFailCount('CORPORATE_ACTION')) failCount++;
    expect(failCount).toBe(2);
  });

  it('Mixed 시나리오 — Critical 만 카운트', () => {
    const events: Array<Parameters<typeof shouldIncrementFailCount>[0]> = [
      'PRE_BREAKOUT_MISS',  // skip
      'GATE_REVALIDATION_FAIL', // skip
      'STALE_BASE',  // count
      'VOLUME_DECREASE', // skip
      'CORPORATE_ACTION', // count
    ];
    let failCount = 0;
    for (const r of events) {
      if (shouldIncrementFailCount(r)) failCount++;
    }
    expect(failCount).toBe(2);
  });

  it('레거시 ENV (PRE_BREAKOUT_FAILCOUNT_DISABLED=false) — 모든 사유 카운트', () => {
    process.env.PRE_BREAKOUT_FAILCOUNT_DISABLED = 'false';
    const events: Array<Parameters<typeof shouldIncrementFailCount>[0]> = [
      'PRE_BREAKOUT_MISS', 'GATE_REVALIDATION_FAIL', 'STALE_BASE',
      'VOLUME_DECREASE', 'CORPORATE_ACTION',
    ];
    let failCount = 0;
    for (const r of events) {
      if (shouldIncrementFailCount(r)) failCount++;
    }
    expect(failCount).toBe(5);
  });
});
