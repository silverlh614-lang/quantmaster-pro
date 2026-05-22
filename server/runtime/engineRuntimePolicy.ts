// @responsibility Engine runtime mode/policy SSOT. Pure functions only; no broker/order imports.

export type EngineMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SELL_ONLY'
  | 'SHADOW_ONLY'
  | 'OBSERVE_ONLY';

export type ExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'LIVE_ORDER_ALLOWED'
  | 'LIVE_ORDER_BLOCKED';

export interface EngineRuntimePolicy {
  engineMode: EngineMode;
  liveEntryAllowed: boolean;
  liveExitAllowed: boolean;
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
  shadowBuyAllowed: boolean;
  shadowSellAllowed: boolean;
  shadowLearningAllowed: boolean;
  counterfactualAllowed: boolean;
  diagnosticAllowed: boolean;
  brokerOrderAllowed: boolean;
  shadowAllowed: boolean;
  learningAllowed: boolean;
  executionImpact: ExecutionImpact;
  reasonCodes: string[];
}

export interface EngineState {
  engineAlive: boolean;
  runtimePolicy: EngineRuntimePolicy;
  reasonCodes: string[];
}

export interface ResolveEngineRuntimePolicyInput {
  engineMode: EngineMode;
  macroRegime?: string;
  marketSessionState?: string;
  hardBlock?: boolean;
  positionFull?: boolean;
  riskLimitReached?: boolean;
  liveBuyGateAllowed?: boolean;
  liveSellGateAllowed?: boolean;
  reasonCodes?: string[];
}

const SHADOW_LEARNING_ALWAYS_ON = {
  shadowBuyAllowed: true,
  shadowSellAllowed: true,
  shadowLearningAllowed: true,
  counterfactualAllowed: true,
  diagnosticAllowed: true,
  shadowAllowed: true,
  learningAllowed: true,
} as const;

function uniqueReasons(reasons: string[] = []): string[] {
  return [...new Set(reasons.filter(Boolean))];
}

export function isEngineMode(value: unknown): value is EngineMode {
  return value === 'NORMAL'
    || value === 'DEGRADED'
    || value === 'SELL_ONLY'
    || value === 'SHADOW_ONLY'
    || value === 'OBSERVE_ONLY';
}

export const EngineModeManager = Object.freeze({
  normalize(value: unknown): EngineMode {
    const raw = String(value ?? '').trim().toUpperCase();
    if (raw === 'SELL_ONLY') return 'NORMAL';
    return isEngineMode(raw) ? raw : 'OBSERVE_ONLY';
  },
});

export const LearningPolicy = Object.freeze({
  resolve(): Pick<EngineRuntimePolicy, 'shadowBuyAllowed' | 'shadowSellAllowed' | 'shadowLearningAllowed' | 'counterfactualAllowed' | 'diagnosticAllowed' | 'shadowAllowed' | 'learningAllowed'> {
    return SHADOW_LEARNING_ALWAYS_ON;
  },
});

function liveEntryPolicyBlocked(input: ResolveEngineRuntimePolicyInput, engineMode: EngineMode): boolean {
  return engineMode === 'SHADOW_ONLY'
    || engineMode === 'OBSERVE_ONLY'
    || input.macroRegime === 'R5_CAUTION'
    || input.macroRegime === 'R5_CRISIS'
    || input.marketSessionState === 'NON_TRADING_DAY'
    || input.marketSessionState === 'CLOSED'
    || input.hardBlock === true
    || input.positionFull === true
    || input.riskLimitReached === true;
}

function liveEntryPolicyReasons(input: ResolveEngineRuntimePolicyInput, engineMode: EngineMode): string[] {
  const reasons: string[] = [];
  if (engineMode === 'SHADOW_ONLY') reasons.push('SHADOW_ONLY');
  if (engineMode === 'OBSERVE_ONLY') reasons.push('OBSERVE_ONLY');
  if (input.macroRegime === 'R5_CAUTION') reasons.push('R5_CAUTION');
  if (input.macroRegime === 'R5_CRISIS') reasons.push('R5_CRISIS');
  if (input.marketSessionState === 'NON_TRADING_DAY') reasons.push('KRX_NON_TRADING_DAY');
  if (input.marketSessionState === 'CLOSED') reasons.push('MARKET_CLOSED');
  if (input.hardBlock === true) reasons.push('HARD_BLOCK');
  if (input.positionFull === true) reasons.push('POSITION_FULL');
  if (input.riskLimitReached === true) reasons.push('RISK_LIMIT');
  return reasons;
}

function buildPolicy(input: {
  engineMode: EngineMode;
  liveEntryAllowed: boolean;
  liveExitAllowed: boolean;
  executionImpact: ExecutionImpact;
  reasonCodes: string[];
}): EngineRuntimePolicy {
  return {
    engineMode: input.engineMode,
    liveEntryAllowed: input.liveEntryAllowed,
    liveExitAllowed: input.liveExitAllowed,
    liveBuyAllowed: input.liveEntryAllowed,
    liveSellAllowed: input.liveExitAllowed,
    ...LearningPolicy.resolve(),
    brokerOrderAllowed: input.liveEntryAllowed,
    executionImpact: input.executionImpact,
    reasonCodes: uniqueReasons(input.reasonCodes),
  };
}

export const ExecutionPolicy = Object.freeze({
  resolve(input: ResolveEngineRuntimePolicyInput): EngineRuntimePolicy {
    const engineMode = EngineModeManager.normalize(input.engineMode);
    const policyReasons = liveEntryPolicyReasons(input, engineMode);
    const reasonCodes = uniqueReasons([...(input.reasonCodes ?? []), ...policyReasons]);
    const blockedByPolicy = liveEntryPolicyBlocked(input, engineMode);

    if (engineMode === 'SHADOW_ONLY') {
      return buildPolicy({
        engineMode,
        liveEntryAllowed: false,
        liveExitAllowed: true,
        executionImpact: 'NONE',
        reasonCodes,
      });
    }

    if (engineMode === 'OBSERVE_ONLY') {
      return buildPolicy({
        engineMode,
        liveEntryAllowed: false,
        liveExitAllowed: true,
        executionImpact: 'NONE',
        reasonCodes,
      });
    }

    const liveBuyAllowed = input.liveBuyGateAllowed === true && !blockedByPolicy;
    const liveSellAllowed = input.liveSellGateAllowed !== false;
    return buildPolicy({
      engineMode,
      liveEntryAllowed: liveBuyAllowed,
      liveExitAllowed: liveSellAllowed,
      executionImpact: blockedByPolicy ? 'NEW_BUY_BLOCKED_ONLY' : liveBuyAllowed || liveSellAllowed ? 'LIVE_ORDER_ALLOWED' : 'LIVE_ORDER_BLOCKED',
      reasonCodes,
    });
  },
});

export function resolveEngineRuntimePolicy(input: ResolveEngineRuntimePolicyInput): EngineRuntimePolicy {
  return ExecutionPolicy.resolve(input);
}

export function buildEngineState(input: ResolveEngineRuntimePolicyInput & { engineAlive?: boolean }): EngineState {
  const runtimePolicy = resolveEngineRuntimePolicy(input);
  return {
    engineAlive: input.engineAlive ?? true,
    runtimePolicy,
    reasonCodes: runtimePolicy.reasonCodes,
  };
}

export function applyProviderSignalToEngineState(input: {
  current: EngineState;
  providerIssue: boolean;
  reasonCode?: string;
}): EngineState {
  if (!input.providerIssue) return input.current;
  return {
    ...input.current,
    engineAlive: true,
    reasonCodes: uniqueReasons([...input.current.reasonCodes, input.reasonCode ?? 'PROVIDER_ISSUE_ISOLATED']),
  };
}

export function formatEngineRuntimePolicy(policy: EngineRuntimePolicy): string {
  return [
    'Execution Policy:',
    `liveEntryAllowed=${policy.liveEntryAllowed}`,
    `liveExitAllowed=${policy.liveExitAllowed}`,
    `shadowBuyAllowed=${policy.shadowBuyAllowed}`,
    `shadowSellAllowed=${policy.shadowSellAllowed}`,
    `shadowLearningAllowed=${policy.shadowLearningAllowed}`,
    `counterfactualAllowed=${policy.counterfactualAllowed}`,
    `diagnosticAllowed=${policy.diagnosticAllowed}`,
    `brokerOrderAllowed=${policy.brokerOrderAllowed}`,
    `executionImpact=${policy.executionImpact}`,
    'shadow.executionImpact=NONE',
    'counterfactual.executionImpact=NONE',
  ].join('\n');
}
