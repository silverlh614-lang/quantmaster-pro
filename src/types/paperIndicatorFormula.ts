// @responsibility Define bounded formulas for invented Shadow indicators.
import { PAPER_FEATURES, type PaperFeatureKey, type PaperFeatureValues } from './paperObservationFeatures';

export type PaperIndicatorOperation = 'MEAN' | 'DIFFERENCE' | 'PRODUCT';
export type PaperInventedFeatureId = `invented:${Lowercase<PaperIndicatorOperation>}:${PaperFeatureKey}:${PaperFeatureKey}`;
export interface PaperIndicatorOperand { feature: PaperFeatureKey; center: number; scale: number }
export interface PaperIndicatorFormula {
  version: 'feature-composition-v1'; operation: PaperIndicatorOperation;
  left: PaperIndicatorOperand; right: PaperIndicatorOperand;
}
export const PAPER_INVENTED_FEATURE_CUTS = [-1, 0, 1] as const;
export const PAPER_MAX_INVENTIONS = 24;
/** Discovery tries one ordered pair per operation, so an inverse difference is not a separate search. */
export const PAPER_MAX_INVENTION_ATTEMPTS = 975;

export function paperIndicatorOperand(feature: PaperFeatureKey): PaperIndicatorOperand {
  const cuts: readonly number[] = PAPER_FEATURES[feature].cuts;
  return { feature, center: cuts[Math.floor(cuts.length / 2)], scale: cuts[cuts.length - 1] - cuts[0] || 1 };
}
export function createPaperIndicatorFormula(operation: PaperIndicatorOperation, left: PaperFeatureKey,
  right: PaperFeatureKey): PaperIndicatorFormula {
  if (operation !== 'DIFFERENCE' && left > right) [left, right] = [right, left];
  return { version: 'feature-composition-v1', operation,
    left: paperIndicatorOperand(left), right: paperIndicatorOperand(right) };
}
export function paperIndicatorFormulaId(formula: PaperIndicatorFormula): PaperInventedFeatureId {
  let left = formula.left.feature, right = formula.right.feature;
  if (formula.operation !== 'DIFFERENCE' && left > right) [left, right] = [right, left];
  return `invented:${formula.operation.toLowerCase() as Lowercase<PaperIndicatorOperation>}:${left}:${right}`;
}
function validOperand(value: unknown): value is PaperIndicatorOperand {
  if (typeof value !== 'object' || value === null) return false;
  const operand = value as Partial<PaperIndicatorOperand>;
  if (typeof operand.feature !== 'string' || !Object.hasOwn(PAPER_FEATURES, operand.feature)) return false;
  const fixed = paperIndicatorOperand(operand.feature);
  return operand.center === fixed.center && operand.scale === fixed.scale;
}
export function validPaperIndicatorFormula(value: unknown): value is PaperIndicatorFormula {
  if (typeof value !== 'object' || value === null) return false;
  const formula = value as Partial<PaperIndicatorFormula>;
  return formula.version === 'feature-composition-v1'
    && (formula.operation === 'MEAN' || formula.operation === 'DIFFERENCE' || formula.operation === 'PRODUCT')
    && validOperand(formula.left) && validOperand(formula.right)
    && formula.left.feature !== formula.right.feature
    && (formula.operation === 'DIFFERENCE' || formula.left.feature < formula.right.feature);
}
function normalizeOperand(operand: PaperIndicatorOperand, values: Partial<PaperFeatureValues>): number | null {
  const value = values[operand.feature];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(-3, Math.min(3, (value - operand.center) / operand.scale));
}
export function paperIndicatorFormulaValue(formula: PaperIndicatorFormula, values: Partial<PaperFeatureValues>): number | null {
  if (!validPaperIndicatorFormula(formula)) return null;
  const left = normalizeOperand(formula.left, values), right = normalizeOperand(formula.right, values);
  if (left === null || right === null) return null;
  if (formula.operation === 'MEAN') return (left + right) / 2;
  return formula.operation === 'DIFFERENCE' ? left - right : left * right;
}
/** N means the frozen normalization (value - center) / scale, limited to the range [-3, 3]. */
export function paperIndicatorFormulaLabel(formula: PaperIndicatorFormula): string {
  const left = `N(${PAPER_FEATURES[formula.left.feature].label})`;
  const right = `N(${PAPER_FEATURES[formula.right.feature].label})`;
  if (formula.operation === 'MEAN') return `(${left} + ${right}) / 2`;
  return `${left} ${formula.operation === 'DIFFERENCE' ? '−' : '×'} ${right}`;
}
