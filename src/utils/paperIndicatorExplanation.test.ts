// @responsibility Verify formula explanations preserve arithmetic meanings.
import { expect, it } from 'vitest';
import { createPaperIndicatorFormula, paperIndicatorFormulaValue } from '../types/paperIndicatorFormula';
import { PAPER_FEATURES } from '../types/paperObservationFeatures';
import { explainPaperIndicator, inventedRuleRange, PAPER_FEATURE_EXPLANATIONS } from './paperIndicatorExplanation';

it('covers every supported ingredient', () => {
  expect(Object.keys(PAPER_FEATURE_EXPLANATIONS).sort()).toEqual(Object.keys(PAPER_FEATURES).sort());
});
it('explains positive products of two below-reference values rather than promising joint strength', () => {
  const formula = createPaperIndicatorFormula('PRODUCT', 'rsi14', 'volumeRatio20');
  const values = Object.fromEntries([formula.left, formula.right].map(item => [item.feature, item.center - item.scale]));
  expect(paperIndicatorFormulaValue(formula, values)).toBe(1);
  expect(explainPaperIndicator(formula).meaning).toContain('둘 다 낮으면 양수');
});
it('preserves the stored order of difference operands', () => {
  const formula = createPaperIndicatorFormula('DIFFERENCE', 'currentRatio', 'adx14');
  expect(explainPaperIndicator(formula).ingredients.map(item => item.feature)).toEqual(['currentRatio', 'adx14']);
});
it('describes the exact inclusive lower and exclusive upper bucket boundaries', () => {
  expect([0, 1, 2, 3].map(inventedRuleRange)).toEqual(['-1 미만', '-1 이상 0 미만', '0 이상 1 미만', '1 이상']);
});
