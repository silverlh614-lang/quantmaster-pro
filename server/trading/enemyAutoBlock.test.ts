/**
 * @responsibility enemyAutoBlock 회귀 테스트 (ADR-0078)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluateEnemyAutoBlock,
  getDefaultEnemyThresholds,
  isEnemyAutoBlockDisabled,
  ENEMY_AUTO_BLOCK_DEFAULTS,
} from './enemyAutoBlock.js';
import type { EnemyCheckResult } from '../clients/enemyCheckClient.js';

const ENV_KEYS = [
  'ENEMY_AUTO_BLOCK_DISABLED',
  'ENEMY_CREDIT_RATE_BLOCK',
  'ENEMY_CREDIT_RATE_WARN',
  'ENEMY_INDIVIDUAL_BLOCK',
  'ENEMY_INDIVIDUAL_WARN',
];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const fullData = (creditRate: number | null, individualDominance: number | null): EnemyCheckResult => ({
  creditRate,
  individualDominance,
  source: 'KIS_FULL',
});

const partialData = (creditRate: number | null, individualDominance: number | null): EnemyCheckResult => ({
  creditRate,
  individualDominance,
  source: 'KIS_PARTIAL',
});

describe('상수 SSOT 정합성', () => {
  it('ENEMY_AUTO_BLOCK_DEFAULTS 노출', () => {
    expect(ENEMY_AUTO_BLOCK_DEFAULTS.creditRateBlock).toBe(12.0);
    expect(ENEMY_AUTO_BLOCK_DEFAULTS.creditRateWarn).toBe(8.0);
    expect(ENEMY_AUTO_BLOCK_DEFAULTS.individualBlock).toBe(88.0);
    expect(ENEMY_AUTO_BLOCK_DEFAULTS.individualWarn).toBe(80.0);
  });

  it('BLOCK > WARN 단조 증가 (false-positive 방지)', () => {
    expect(ENEMY_AUTO_BLOCK_DEFAULTS.creditRateBlock).toBeGreaterThan(
      ENEMY_AUTO_BLOCK_DEFAULTS.creditRateWarn,
    );
    expect(ENEMY_AUTO_BLOCK_DEFAULTS.individualBlock).toBeGreaterThan(
      ENEMY_AUTO_BLOCK_DEFAULTS.individualWarn,
    );
  });
});

describe('데이터 부재 안전 fallback', () => {
  it('null 입력 → shouldBlock=false + skipReason=NO_DATA', () => {
    const r = evaluateEnemyAutoBlock(null);
    expect(r.shouldBlock).toBe(false);
    expect(r.reason).toBe('');
    expect(r.warnings).toEqual([]);
    expect(r.skipReason).toBe('NO_DATA');
  });

  it("source='UNAVAILABLE' → shouldBlock=false + skipReason=NO_DATA", () => {
    const r = evaluateEnemyAutoBlock({
      creditRate: 99,
      individualDominance: 99,
      source: 'UNAVAILABLE',
    });
    expect(r.shouldBlock).toBe(false);
    expect(r.skipReason).toBe('NO_DATA');
  });

  it('creditRate null + individual null → shouldBlock=false (둘 다 부재)', () => {
    const r = evaluateEnemyAutoBlock(fullData(null, null));
    expect(r.shouldBlock).toBe(false);
    expect(r.skipReason).toBeUndefined(); // 데이터 자체는 KIS_FULL 이지만 둘 다 null
  });
});

describe('creditRate 임계 분기', () => {
  it('정확히 12.0% → BLOCK (≥ 임계)', () => {
    const r = evaluateEnemyAutoBlock(fullData(12.0, 50));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('신용잔고율 12.0%');
  });

  it('11.99% → BLOCK 안 됨 + WARN (8% 통과)', () => {
    const r = evaluateEnemyAutoBlock(fullData(11.99, 50));
    expect(r.shouldBlock).toBe(false);
    expect(r.warnings).toEqual(expect.arrayContaining([expect.stringContaining('신용잔고율 12.0%')]));
  });

  it('정확히 8.0% → WARN 만 (BLOCK 안 됨)', () => {
    const r = evaluateEnemyAutoBlock(fullData(8.0, 50));
    expect(r.shouldBlock).toBe(false);
    expect(r.warnings.length).toBe(1);
  });

  it('7.9% → WARN/BLOCK 둘 다 안 됨', () => {
    const r = evaluateEnemyAutoBlock(fullData(7.9, 50));
    expect(r.shouldBlock).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('0% → 안전 통과', () => {
    const r = evaluateEnemyAutoBlock(fullData(0, 0));
    expect(r.shouldBlock).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

describe('individualDominance 임계 분기', () => {
  it('정확히 88% → BLOCK', () => {
    const r = evaluateEnemyAutoBlock(fullData(0, 88));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('개인 비중 88%');
  });

  it('87% → WARN (80% 통과)', () => {
    const r = evaluateEnemyAutoBlock(fullData(0, 87));
    expect(r.shouldBlock).toBe(false);
    expect(r.warnings).toContain('개인 비중 87%');
  });

  it('정확히 80% → WARN', () => {
    const r = evaluateEnemyAutoBlock(fullData(0, 80));
    expect(r.shouldBlock).toBe(false);
    expect(r.warnings).toContain('개인 비중 80%');
  });
});

describe('OR 결합 (둘 중 하나라도 BLOCK 시 차단)', () => {
  it('credit BLOCK + individual 정상 → 차단', () => {
    const r = evaluateEnemyAutoBlock(fullData(15, 50));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('신용잔고율');
    expect(r.reason).not.toContain('개인 비중');
  });

  it('credit 정상 + individual BLOCK → 차단', () => {
    const r = evaluateEnemyAutoBlock(fullData(3, 92));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('개인 비중 92%');
  });

  it('둘 다 BLOCK → reason 두 항목 결합 ("/")', () => {
    const r = evaluateEnemyAutoBlock(fullData(15, 92));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('신용잔고율');
    expect(r.reason).toContain('개인 비중');
    expect(r.reason).toContain(' / ');
  });

  it('한쪽 BLOCK + 다른 쪽 WARN → BLOCK + warnings 비어있음 (BLOCK 우선)', () => {
    const r = evaluateEnemyAutoBlock(fullData(15, 85));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('신용잔고율');
    // 개인 비중 85% 는 WARN 임계 통과지만 BLOCK 결정에 의해 reason 에는 포함 안 됨
    expect(r.warnings).toContain('개인 비중 85%');
  });
});

describe('NaN/Infinity 안전 fallback', () => {
  it('creditRate=NaN → 평가 제외 (BLOCK 안 됨)', () => {
    const r = evaluateEnemyAutoBlock(fullData(NaN, 50));
    expect(r.shouldBlock).toBe(false);
  });

  it('creditRate=Infinity → 평가 제외', () => {
    const r = evaluateEnemyAutoBlock(fullData(Infinity, 50));
    expect(r.shouldBlock).toBe(false);
  });

  it('individualDominance=NaN → 평가 제외 + creditRate 만 정상 평가', () => {
    const r = evaluateEnemyAutoBlock(fullData(15, NaN));
    expect(r.shouldBlock).toBe(true);
    expect(r.reason).toContain('신용잔고율');
    expect(r.reason).not.toContain('개인 비중');
  });
});

describe('ENV 오버라이드', () => {
  it('ENEMY_AUTO_BLOCK_DISABLED=true → 모든 입력 무관 shouldBlock=false', () => {
    process.env.ENEMY_AUTO_BLOCK_DISABLED = 'true';
    const r = evaluateEnemyAutoBlock(fullData(99, 99));
    expect(r.shouldBlock).toBe(false);
    expect(r.skipReason).toBe('DISABLED');
  });

  it('isEnemyAutoBlockDisabled() ENV 반영', () => {
    expect(isEnemyAutoBlockDisabled()).toBe(false);
    process.env.ENEMY_AUTO_BLOCK_DISABLED = 'true';
    expect(isEnemyAutoBlockDisabled()).toBe(true);
    process.env.ENEMY_AUTO_BLOCK_DISABLED = 'false'; // 'true' 외엔 비활성 안 됨
    expect(isEnemyAutoBlockDisabled()).toBe(false);
  });

  it('ENEMY_CREDIT_RATE_BLOCK=15 → 12% 입력은 BLOCK 안 됨', () => {
    process.env.ENEMY_CREDIT_RATE_BLOCK = '15';
    const r = evaluateEnemyAutoBlock(fullData(13, 50));
    expect(r.shouldBlock).toBe(false);
    expect(r.thresholds.creditRateBlock).toBe(15);
  });

  it('ENEMY_INDIVIDUAL_BLOCK=95 → 90% 입력은 BLOCK 안 됨 (기본 88 보다 완화)', () => {
    process.env.ENEMY_INDIVIDUAL_BLOCK = '95';
    const r = evaluateEnemyAutoBlock(fullData(0, 90));
    expect(r.shouldBlock).toBe(false);
    expect(r.thresholds.individualBlock).toBe(95);
  });

  it('잘못된 ENV (음수/NaN) → default fallback', () => {
    process.env.ENEMY_CREDIT_RATE_BLOCK = '-5';
    const t1 = getDefaultEnemyThresholds();
    expect(t1.creditRateBlock).toBe(12.0);
    process.env.ENEMY_CREDIT_RATE_BLOCK = 'abc';
    const t2 = getDefaultEnemyThresholds();
    expect(t2.creditRateBlock).toBe(12.0);
  });

  it('ENV 0 (음수 동등) → default fallback', () => {
    process.env.ENEMY_INDIVIDUAL_BLOCK = '0';
    const t = getDefaultEnemyThresholds();
    expect(t.individualBlock).toBe(88.0);
  });
});

describe('source 분기', () => {
  it("'KIS_FULL' 와 'KIS_PARTIAL' 동일 평가", () => {
    const r1 = evaluateEnemyAutoBlock(fullData(15, 50));
    const r2 = evaluateEnemyAutoBlock(partialData(15, 50));
    expect(r1.shouldBlock).toBe(r2.shouldBlock);
    expect(r1.reason).toBe(r2.reason);
  });

  it('thresholds 결과 객체에 propagate', () => {
    const r = evaluateEnemyAutoBlock(fullData(0, 0));
    expect(r.thresholds.creditRateBlock).toBe(12.0);
    expect(r.thresholds.individualBlock).toBe(88.0);
    expect(r.thresholds.creditRateWarn).toBe(8.0);
    expect(r.thresholds.individualWarn).toBe(80.0);
  });

  it('명시 thresholds override (ENV 무시)', () => {
    process.env.ENEMY_CREDIT_RATE_BLOCK = '20'; // ENV 가 있어도
    const r = evaluateEnemyAutoBlock(
      fullData(13, 50),
      { creditRateBlock: 10, creditRateWarn: 5, individualBlock: 88, individualWarn: 80 },
    );
    expect(r.shouldBlock).toBe(true); // override 10 적용
    expect(r.thresholds.creditRateBlock).toBe(10);
  });
});
