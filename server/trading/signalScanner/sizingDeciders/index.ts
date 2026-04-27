// @responsibility SizingDecider 패턴 모듈 barrel — sizingTier/kellyBudget/stopLossPolicy 통합 진입점

export type {
  SizingDeciderFail,
  SizingDeciderPassBase,
} from './types.js';

export {
  sizingTierDecider,
  type SizingTierDeciderInput,
  type SizingTierDeciderPass,
  type SizingTierDeciderResult,
} from './sizingTierDecider.js';

export {
  kellyBudgetDecider,
  type KellyBudgetDeciderInput,
  type KellyBudgetDeciderPass,
  type KellyBudgetDeciderResult,
} from './kellyBudgetDecider.js';

export {
  stopLossPolicyResolver,
  type StopLossPolicyInput,
  type StopLossPolicyOutput,
  type ProfileKey,
} from './stopLossPolicyResolver.js';
