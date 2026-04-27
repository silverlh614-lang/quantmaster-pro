/**
 * @responsibility BudgetPolicy 정책 객체 추출 + 백테스트 주입 회귀 테스트 — PR-T (아이디어 8)
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  defaultBudgetPolicy,
  getBudgetPolicy,
  setBudgetPolicy,
  withPolicyOverride,
  applyFractionalKellyWithPolicy,
  type BudgetPolicy,
} from './budgetPolicy.js';
import {
  computeRiskAdjustedSize,
  applyFractionalKelly,
  type AccountRiskBudgetSnapshot,
} from './accountRiskBudget.js';

function mkBudget(overrides: Partial<AccountRiskBudgetSnapshot> = {}): AccountRiskBudgetSnapshot {
  return {
    dailyLossLimitPct: 5,
    dailyLossPct: 0,
    dailyLossRemainingPct: 5,
    maxConcurrentRiskPct: 6,
    openRiskPct: 0,
    concurrentRiskRemainingPct: 6,
    maxPerTradeRiskPct: 1.5,
    maxSectorWeightPct: 30,
    canEnterNew: true,
    blockedReasons: [],
    ...overrides,
  };
}

describe('BudgetPolicy — PR-T 아이디어 8', () => {
  afterEach(() => {
    setBudgetPolicy(null);
    delete process.env.DAILY_LOSS_LIMIT;
    delete process.env.MAX_CONCURRENT_RISK_PCT;
    delete process.env.MAX_PER_TRADE_RISK_PCT;
    delete process.env.MAX_SECTOR_WEIGHT;
  });

  describe('defaultBudgetPolicy()', () => {
    it('env 미설정 시 안전한 default 값 반환', () => {
      const p = defaultBudgetPolicy();
      expect(p.id).toBe('default-env');
      expect(p.dailyLossLimitPct).toBe(5);
      expect(p.maxConcurrentRiskPct).toBe(6);
      expect(p.maxPerTradeRiskPct).toBe(1.5);
      expect(p.maxSectorWeightPct).toBe(30); // 0.30 × 100
      expect(p.fractionalKellyCap.STRONG_BUY).toBe(0.50);
      expect(p.fractionalKellyCap.BUY).toBe(0.25);
      expect(p.fractionalKellyCap.HOLD).toBe(0.10);
      expect(p.fractionalKellyCap.PROBING).toBe(0.10);
    });

    it('env 설정값을 즉시 반영', () => {
      process.env.DAILY_LOSS_LIMIT = '3';
      process.env.MAX_CONCURRENT_RISK_PCT = '8';
      process.env.MAX_PER_TRADE_RISK_PCT = '2';
      process.env.MAX_SECTOR_WEIGHT = '0.4';
      const p = defaultBudgetPolicy();
      expect(p.dailyLossLimitPct).toBe(3);
      expect(p.maxConcurrentRiskPct).toBe(8);
      expect(p.maxPerTradeRiskPct).toBe(2);
      expect(p.maxSectorWeightPct).toBe(40);
    });
  });

  describe('setBudgetPolicy / getBudgetPolicy', () => {
    it('setBudgetPolicy(null) → 활성 정책이 env 기반 default 로 폴백', () => {
      setBudgetPolicy(null);
      const p = getBudgetPolicy();
      expect(p.id).toBe('default-env');
    });

    it('setBudgetPolicy(p) → 활성 정책이 주입값으로 교체', () => {
      const custom: BudgetPolicy = {
        id: 'kelly-half-test',
        dailyLossLimitPct: 4,
        maxConcurrentRiskPct: 5,
        maxPerTradeRiskPct: 1.0,
        maxSectorWeightPct: 25,
        fractionalKellyCap: { STRONG_BUY: 0.25, BUY: 0.125, HOLD: 0.05, PROBING: 0.05 },
      };
      setBudgetPolicy(custom);
      const p = getBudgetPolicy();
      expect(p.id).toBe('kelly-half-test');
      expect(p.fractionalKellyCap.STRONG_BUY).toBe(0.25);
    });
  });

  describe('withPolicyOverride', () => {
    it('일부 필드만 덮어쓰기 (root 필드)', () => {
      const p = withPolicyOverride({ id: 'aggressive', dailyLossLimitPct: 10 });
      expect(p.id).toBe('aggressive');
      expect(p.dailyLossLimitPct).toBe(10);
      // 미덮어쓴 필드는 default 보존
      expect(p.maxConcurrentRiskPct).toBe(6);
    });

    it('fractionalKellyCap 부분 덮어쓰기 — 다른 등급은 default 보존', () => {
      const p = withPolicyOverride({
        id: 'half-strong-only',
        fractionalKellyCap: { STRONG_BUY: 0.25 } as Record<string, number> as never,
      });
      expect(p.fractionalKellyCap.STRONG_BUY).toBe(0.25);
      expect(p.fractionalKellyCap.BUY).toBe(0.25);     // default 보존
      expect(p.fractionalKellyCap.HOLD).toBe(0.10);    // default 보존
      expect(p.fractionalKellyCap.PROBING).toBe(0.10); // default 보존
    });

    it('base 정책 명시 시 그 위에 덮어쓰기', () => {
      const base: BudgetPolicy = {
        id: 'tight-base',
        dailyLossLimitPct: 2,
        maxConcurrentRiskPct: 3,
        maxPerTradeRiskPct: 0.5,
        maxSectorWeightPct: 20,
        fractionalKellyCap: { STRONG_BUY: 0.2, BUY: 0.1, HOLD: 0.05, PROBING: 0.05 },
      };
      const p = withPolicyOverride({ id: 'tight-loose-strong', fractionalKellyCap: { STRONG_BUY: 0.5 } as never }, base);
      expect(p.id).toBe('tight-loose-strong');
      expect(p.dailyLossLimitPct).toBe(2);    // base 보존
      expect(p.fractionalKellyCap.STRONG_BUY).toBe(0.5);
      expect(p.fractionalKellyCap.BUY).toBe(0.1); // base 보존
    });
  });

  describe('applyFractionalKellyWithPolicy', () => {
    it('정책 캡 초과 시 절단', () => {
      const p = defaultBudgetPolicy();
      const r = applyFractionalKellyWithPolicy('STRONG_BUY', 0.7, p);
      expect(r.capped).toBe(0.5);
      expect(r.wasCapped).toBe(true);
      expect(r.cap).toBe(0.5);
    });

    it('정책 캡 미달 시 그대로', () => {
      const p = defaultBudgetPolicy();
      const r = applyFractionalKellyWithPolicy('BUY', 0.2, p);
      expect(r.capped).toBe(0.2);
      expect(r.wasCapped).toBe(false);
    });

    it('음수 입력 → 0 으로 clamp', () => {
      const p = defaultBudgetPolicy();
      const r = applyFractionalKellyWithPolicy('STRONG_BUY', -0.5, p);
      expect(r.capped).toBe(0);
      expect(r.wasCapped).toBe(false);
    });

    it('정책 미주입 → 활성 정책 자동 사용', () => {
      const aggressive: BudgetPolicy = {
        ...defaultBudgetPolicy(),
        id: 'agg',
        fractionalKellyCap: { STRONG_BUY: 0.9, BUY: 0.6, HOLD: 0.3, PROBING: 0.3 },
      };
      setBudgetPolicy(aggressive);
      const r = applyFractionalKellyWithPolicy('STRONG_BUY', 0.7);
      expect(r.cap).toBe(0.9);
      expect(r.wasCapped).toBe(false);
      expect(r.capped).toBe(0.7);
    });
  });

  describe('applyFractionalKelly (accountRiskBudget re-export 후방호환)', () => {
    it('default 정책 캡 적용', () => {
      const r = applyFractionalKelly('STRONG_BUY', 0.7);
      expect(r.capped).toBe(0.5);
      expect(r.wasCapped).toBe(true);
    });

    it('명시 정책 인자 우선', () => {
      const halfKelly = withPolicyOverride({
        id: 'half-strong',
        fractionalKellyCap: { STRONG_BUY: 0.25 } as never,
      });
      const r = applyFractionalKelly('STRONG_BUY', 0.7, halfKelly);
      expect(r.capped).toBe(0.25);
    });

    it('활성 정책 주입 시 default 호출자 동작 변경', () => {
      const halfKelly = withPolicyOverride({
        id: 'half-strong',
        fractionalKellyCap: { STRONG_BUY: 0.25 } as never,
      });
      setBudgetPolicy(halfKelly);
      const r = applyFractionalKelly('STRONG_BUY', 0.7);
      expect(r.capped).toBe(0.25);
    });
  });

  describe('computeRiskAdjustedSize 정책 통합 — Kelly 0.25배 vs 0.5배 백테스트 시나리오', () => {
    const TOTAL = 100_000_000;
    const baseInput = {
      entryPrice: 10_000,
      stopLoss: 9_500,
      signalGrade: 'STRONG_BUY' as const,
      kellyMultiplier: 0.4,
      confidenceModifier: 1.0,
      totalAssets: TOTAL,
    };

    it('0.5 Kelly 정책 (default) — capped Kelly = 0.4 (cap 미달)', () => {
      const r = computeRiskAdjustedSize({ ...baseInput, budget: mkBudget() });
      expect(r.staticKelly).toBe(0.4); // default cap 0.5, 입력 0.4 미달
      expect(r.kellyWasCapped).toBe(false);
    });

    it('0.25 Kelly 정책 주입 — capped Kelly = 0.25 (cap 작동)', () => {
      const halfKelly = withPolicyOverride({
        id: 'kelly-quarter-strong',
        fractionalKellyCap: { STRONG_BUY: 0.25, BUY: 0.125, HOLD: 0.05, PROBING: 0.05 },
      });
      const r = computeRiskAdjustedSize({
        ...baseInput,
        budget: mkBudget(),
        policy: halfKelly,
      });
      expect(r.staticKelly).toBe(0.25); // policy cap 0.25 작동
      expect(r.kellyWasCapped).toBe(true);
    });

    it('정책 주입 시 권장 자본이 절반 가량으로 감소 (capitalByKelly 활성 시)', () => {
      // capitalByKelly = totalAssets × kelly × confidence
      // riskBudget = min(maxRisk, remainingConc) = totalAssets × 1.5%
      // sharesByRisk = floor(1500000 / 500) = 3000, capitalByRisk = 3000 × 10000 = 30M
      // 0.5 Kelly: capitalByKelly = 1억 × 0.4 × 1.0 = 40M → min(30M, 40M) = 30M
      // 0.25 Kelly: capitalByKelly = 1억 × 0.25 × 1.0 = 25M → min(30M, 25M) = 25M
      const fullKelly = computeRiskAdjustedSize({ ...baseInput, budget: mkBudget() });
      const halfKelly = withPolicyOverride({
        id: 'kelly-quarter-strong',
        fractionalKellyCap: { STRONG_BUY: 0.25, BUY: 0.125, HOLD: 0.05, PROBING: 0.05 },
      });
      const half = computeRiskAdjustedSize({ ...baseInput, budget: mkBudget(), policy: halfKelly });
      expect(half.recommendedBudgetKrw).toBeLessThan(fullKelly.recommendedBudgetKrw);
      expect(half.recommendedBudgetKrw).toBe(25_000_000);
      expect(fullKelly.recommendedBudgetKrw).toBe(30_000_000);
    });

    it('정책 미주입 시 활성 정책(setBudgetPolicy 주입)을 자동 사용', () => {
      const halfKelly = withPolicyOverride({
        id: 'kelly-quarter',
        fractionalKellyCap: { STRONG_BUY: 0.25, BUY: 0.125, HOLD: 0.05, PROBING: 0.05 },
      });
      setBudgetPolicy(halfKelly);
      const r = computeRiskAdjustedSize({ ...baseInput, budget: mkBudget() });
      expect(r.staticKelly).toBe(0.25);
      expect(r.kellyWasCapped).toBe(true);
    });
  });
});
