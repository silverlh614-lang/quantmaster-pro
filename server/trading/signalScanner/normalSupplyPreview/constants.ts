// @responsibility Constants for normal supply preview diagnostics.
export const NORMAL_SUPPLY_DIAGNOSTIC_PREVIEW_MODE = 'NORMAL_SUPPLY_DIAGNOSTIC' as const;
export const NORMAL_SUPPLY_DIAGNOSTIC_FULL_PREVIEW_MODE = 'NORMAL_SUPPLY_DIAGNOSTIC_FULL' as const;

export const NORMAL_SUPPLY_SCORE_THRESHOLDS = Object.freeze({
  bullishThreshold: 80,
  accumulatingThreshold: 70,
  bearishThreshold: 35,
});
