// @responsibility Learning Flow Unclog Patch v1 constants — virtual-only learning loop safety SSOT
export const LEARNING_ATTRIBUTION_TARGET_7D = 70;
export const LEARNING_GEMINI_UTILIZATION_TARGET = 0.8;
export const LEARNING_TRADING_DAYS_PER_MONTH = 22;
export const LEARNING_STALE_OPEN_HOURS = 24;
export const LEARNING_DEFAULT_MAX_HOLDING_MINUTES = 30 * 24 * 60;
export const LEARNING_DEFAULT_TARGET_RETURN_PCT = 3;
export const LEARNING_DEFAULT_STOP_RETURN_PCT = -3;
export const LEARNING_VALID_ATTRIBUTION_LABELS = new Set(['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED']);
export const LEARNING_SUGGEST_CHANNELS = ['counterfactual', 'ledger', 'kellySurface', 'regime'] as const;
