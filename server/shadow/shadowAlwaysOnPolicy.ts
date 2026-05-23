// @responsibility Shadow Always-On policy for defensive regimes; no order/KIS/Gate side effects.

export type ShadowAlwaysOnExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'LIVE_BUY_BLOCKED'
  | 'LIVE_TRADING_BLOCKED';

export interface ShadowAlwaysOnPolicyInput {
  engineMode?: string | null;
  effectiveRegime?: string | null;
  riskOverrideActive?: boolean;
  marketSession?: string | null;
  providerIssue?: boolean;
  dataHealth?: string | null;
  liveExecutionAllowed?: boolean;
  realOrderAllowed?: boolean;
}

export interface ShadowAlwaysOnPolicyResult {
  shadowScanAllowed: boolean;
  shadowSignalAllowed: boolean;
  shadowPaperFillAllowed: boolean;
  shadowPositionManagementAllowed: boolean;
  shadowExitAllowed: boolean;
  shadowLearningAllowed: boolean;
  counterfactualAllowed: boolean;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  executionImpact: ShadowAlwaysOnExecutionImpact;
  reason: string;
  invariant: {
    liveBlockedDoesNotBlockShadow: boolean;
    providerIssueDoesNotBecomeMarketSignal: boolean;
    shadowLearningAlwaysOn: boolean;
  };
}

const SHADOW_TRUE = {
  shadowScanAllowed: true,
  shadowSignalAllowed: true,
  shadowPaperFillAllowed: true,
  shadowPositionManagementAllowed: true,
  shadowExitAllowed: true,
  shadowLearningAllowed: true,
  counterfactualAllowed: true,
} as const;

function normalizeToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function isR6Like(input: ShadowAlwaysOnPolicyInput): boolean {
  const mode = normalizeToken(input.engineMode);
  const regime = normalizeToken(input.effectiveRegime);
  return mode === 'R6_DEFENSE' || regime === 'R6_DEFENSE' || regime.startsWith('R6_');
}

function isOutsideLiveWindow(input: ShadowAlwaysOnPolicyInput): boolean {
  const session = normalizeToken(input.marketSession);
  return session === 'AFTER_MARKET'
    || session === 'AFTERMARKET'
    || session === 'CLOSING_SESSION'
    || session === 'POST_CLOSE'
    || session === 'CLOSED'
    || session === 'NON_TRADING_DAY';
}

function resolveLiveBuyDefault(input: ShadowAlwaysOnPolicyInput): boolean {
  if (input.liveExecutionAllowed !== undefined) return input.liveExecutionAllowed === true;
  if (input.realOrderAllowed !== undefined) return input.realOrderAllowed === true;
  return true;
}

function withInvariant(result: Omit<ShadowAlwaysOnPolicyResult, 'invariant'>): ShadowAlwaysOnPolicyResult {
  const shadowCoreAllowed = result.shadowScanAllowed
    && result.shadowSignalAllowed
    && result.shadowPositionManagementAllowed
    && result.shadowExitAllowed
    && result.shadowLearningAllowed
    && result.counterfactualAllowed;
  return {
    ...result,
    invariant: {
      liveBlockedDoesNotBlockShadow: shadowCoreAllowed,
      providerIssueDoesNotBecomeMarketSignal: true,
      shadowLearningAlwaysOn: result.shadowLearningAllowed && result.counterfactualAllowed,
    },
  };
}

export function resolveShadowAlwaysOnPolicy(input: ShadowAlwaysOnPolicyInput): ShadowAlwaysOnPolicyResult {
  const mode = normalizeToken(input.engineMode);
  const liveBuyDefault = resolveLiveBuyDefault(input);

  if (isR6Like(input)) {
    return withInvariant({
      ...SHADOW_TRUE,
      liveBuyAllowed: liveBuyDefault,
      liveSellAllowed: true,
      executionImpact: liveBuyDefault ? 'NONE' : 'NEW_BUY_BLOCKED_ONLY',
      reason: 'LEGACY_R6_EVIDENCE_ONLY_SHADOW_ALLOWED',
    });
  }

  if (mode === 'SELL_ONLY') {
    return withInvariant({
      ...SHADOW_TRUE,
      liveBuyAllowed: false,
      liveSellAllowed: true,
      executionImpact: 'NEW_BUY_BLOCKED_ONLY',
      reason: 'SELL_ONLY_EVALUATION_CONTINUED_LIVE_BUY_BLOCKED',
    });
  }

  if (mode === 'SHADOW_ONLY') {
    return withInvariant({
      ...SHADOW_TRUE,
      liveBuyAllowed: false,
      liveSellAllowed: false,
      executionImpact: 'NONE',
      reason: 'SHADOW_ONLY_LIVE_DISABLED_SHADOW_ALLOWED',
    });
  }

  if (mode === 'OBSERVE_ONLY') {
    return withInvariant({
      ...SHADOW_TRUE,
      liveBuyAllowed: false,
      liveSellAllowed: false,
      executionImpact: 'NONE',
      reason: 'OBSERVE_ONLY_LIVE_DISABLED_SHADOW_LEARNING_ALLOWED',
    });
  }

  if (mode === 'HARD_BLOCK') {
    return withInvariant({
      ...SHADOW_TRUE,
      liveBuyAllowed: false,
      liveSellAllowed: true,
      executionImpact: 'LIVE_TRADING_BLOCKED',
      reason: 'HARD_BLOCK_LIVE_BUY_BLOCK_SHADOW_ALLOWED',
    });
  }

  return withInvariant({
    ...SHADOW_TRUE,
    liveBuyAllowed: liveBuyDefault,
    liveSellAllowed: true,
    executionImpact: liveBuyDefault ? 'NONE' : 'NEW_BUY_BLOCKED_ONLY',
    reason: input.providerIssue === true
      ? 'PROVIDER_ISSUE_ISOLATED_SHADOW_LEARNING_ALLOWED'
      : 'NORMAL_SHADOW_ALLOWED',
  });
}
