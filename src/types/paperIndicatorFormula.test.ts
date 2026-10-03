// @responsibility Verify frozen arithmetic and invalid-input isolation for invented indicators.
import { describe, expect, it } from 'vitest';
import { PAPER_FEATURES, type PaperFeatureKey } from './paperObservationFeatures';
import { createPaperIndicatorFormula, paperIndicatorFormulaId, paperIndicatorFormulaLabel,
  paperIndicatorFormulaValue, paperIndicatorOperand, validPaperIndicatorFormula,
  PAPER_MAX_INVENTION_ATTEMPTS, type PaperIndicatorOperation } from './paperIndicatorFormula';
import { paperAdaptiveFeatureLabel, paperAdaptiveRuleLabel, type PaperAdaptiveRule } from './paperAdaptive';

describe('invented indicator formulas', () => {
  it('preserves subtraction orientation and canonicalizes equivalent commutative formulas', () => {
    for (const operation of ['MEAN', 'PRODUCT'] as const) {
      const forward = createPaperIndicatorFormula(operation, 'rsi14', 'volumeRatio20');
      const reverse = createPaperIndicatorFormula(operation, 'volumeRatio20', 'rsi14');
      expect(reverse).toEqual(forward);
      expect(paperIndicatorFormulaId(reverse)).toBe(paperIndicatorFormulaId(forward));
      expect(validPaperIndicatorFormula({ ...forward, left: forward.right, right: forward.left })).toBe(false);
    }
    const forward = createPaperIndicatorFormula('DIFFERENCE', 'rsi14', 'volumeRatio20');
    const reverse = createPaperIndicatorFormula('DIFFERENCE', 'volumeRatio20', 'rsi14');
    expect(paperIndicatorFormulaId(forward)).toBe('invented:difference:rsi14:volumeRatio20');
    expect(paperIndicatorFormulaId(reverse)).toBe('invented:difference:volumeRatio20:rsi14');
    expect(paperIndicatorFormulaValue(reverse, { rsi14: 70, volumeRatio20: 1 })).toBe(-0.5);
  });

  it('computes each operation from frozen normalization rather than raw units', () => {
    const values = { rsi14: 70, volumeRatio20: 2.5 };
    expect(paperIndicatorFormulaValue(createPaperIndicatorFormula('MEAN', 'rsi14', 'volumeRatio20'), values)).toBe(0.75);
    expect(paperIndicatorFormulaValue(createPaperIndicatorFormula('DIFFERENCE', 'rsi14', 'volumeRatio20'), values)).toBe(-0.5);
    expect(paperIndicatorFormulaValue(createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20'), values)).toBe(0.5);
  });

  it('bounds outliers before composing operands', () => {
    const values = { rsi14: Number.MAX_VALUE, volumeRatio20: -Number.MAX_VALUE };
    expect(paperIndicatorFormulaValue(createPaperIndicatorFormula('MEAN', 'rsi14', 'volumeRatio20'), values)).toBe(0);
    expect(paperIndicatorFormulaValue(createPaperIndicatorFormula('DIFFERENCE', 'rsi14', 'volumeRatio20'), values)).toBe(6);
    expect(paperIndicatorFormulaValue(createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20'), values)).toBe(-9);
  });

  it('leaves missing and nonfinite operands unavailable', () => {
    const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
    for (const value of [undefined, null, NaN, Infinity, -Infinity]) {
      expect(paperIndicatorFormulaValue(formula, { rsi14: value, volumeRatio20: 2 })).toBeNull();
      expect(paperIndicatorFormulaValue(formula, { rsi14: 50, volumeRatio20: value })).toBeNull();
    }
    expect(paperIndicatorFormulaValue(formula, { rsi14: 0, volumeRatio20: 0 })).not.toBeNull();
  });

  it('rejects altered normalization, unknown operations, nesting and repeated inputs', () => {
    const formula = createPaperIndicatorFormula('MEAN', 'rsi14', 'volumeRatio20');
    const invalid: unknown[] = [null, undefined, [], {}, { ...formula, version: 'feature-composition-v2' },
      { ...formula, operation: 'EVAL' }, { ...formula, left: formula },
      { ...formula, left: { ...formula.left, feature: 'constructor' } },
      { ...formula, left: { ...formula.left, center: 49 } },
      { ...formula, left: { ...formula.left, scale: 0 } },
      { ...formula, right: formula.left }];
    for (const value of invalid) expect(validPaperIndicatorFormula(value)).toBe(false);
    expect(paperIndicatorFormulaValue({ ...formula, left: { ...formula.left, scale: 0 } }, { rsi14: 70, volumeRatio20: 2 })).toBeNull();
  });

  it('derives every operand from fixed cuts, including the two-cut cashflow feature', () => {
    expect(paperIndicatorOperand('rsi14')).toEqual({ feature: 'rsi14', center: 50, scale: 40 });
    expect(paperIndicatorOperand('volumeRatio20')).toEqual({ feature: 'volumeRatio20', center: 1, scale: 1.5 });
    expect(paperIndicatorOperand('operatingCashFlowSign')).toEqual({ feature: 'operatingCashFlowSign', center: 1, scale: 1 });
    const features = (Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).sort();
    const ids = new Set<string>();
    for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
      for (const operation of ['MEAN', 'DIFFERENCE', 'PRODUCT'] as PaperIndicatorOperation[]) {
        const formula = createPaperIndicatorFormula(operation, features[i], features[j]);
        expect(validPaperIndicatorFormula(formula)).toBe(true);
        ids.add(paperIndicatorFormulaId(formula));
      }
    }
    expect(ids.size).toBe(PAPER_MAX_INVENTION_ATTEMPTS);
  });

  it('shows arithmetic and distinguishes invented rules from existing feature labels', () => {
    expect(paperAdaptiveRuleLabel({ feature: 'rsi14', bucket: 2, horizon: 3 })).toBe('RSI 14 · 50 이상 70 미만 · D3');
    const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
    const rule: PaperAdaptiveRule = { feature: paperIndicatorFormulaId(formula), bucket: 3, horizon: 5,
      invention: { id: paperIndicatorFormulaId(formula), formula, createdAt: '2026-10-05T00:00:00Z',
        discoveryCutoffAt: '2026-10-04T15:00:00Z', rule: { bucket: 3, horizon: 5 },
        training: { sampleCount: 0, dateCount: 0, symbolCount: 0, experimentIds: [],
          meanNetReturnPct: null, meanDailyExcessPct: null } } };
    expect(paperIndicatorFormulaLabel(formula)).toBe('N(RSI 14) × N(완료일 거래량 / 이전 20일 평균)');
    expect(paperAdaptiveFeatureLabel(rule)).toBe(`발명 · ${paperIndicatorFormulaLabel(formula)}`);
    expect(paperAdaptiveRuleLabel(rule)).toBe(`발명 · ${paperIndicatorFormulaLabel(formula)} · 1 이상 · D5`);
  });
});
