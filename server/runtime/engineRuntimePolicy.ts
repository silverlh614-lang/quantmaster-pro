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
  liveBuyAllowed: boolean;
  liveSellAllowed: boolean;
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
  liveBuyGateAllowed?: boolean;
  liveSellGateAllowed?: boolean;
  reasonCodes?: string[];
}

const SHADOW_LEARNING_ALWAYS_ON = {
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
    return isEngineMode(value) ? value : 'OBSERVE_ONLY';
  },
});

export const LearningPolicy = Object.freeze({
  resolve(): Pick<EngineRuntimePolicy, 'shadowAllowed' | 'learningAllowed'> {
    return SHADOW_LEARNING_ALWAYS_ON;
  },
});

export const ExecutionPolicy = Object.freeze({
  resolve(input: ResolveEngineRuntimePolicyInput): EngineRuntimePolicy {
    const engineMode = EngineModeManager.normalize(input.engineMode);
    const reasonCodes = uniqueReasons(input.reasonCodes);

    if (engineMode === 'SELL_ONLY') {
      return {
        engineMode,
        liveBuyAllowed: false,
        liveSellAllowed: true,
        ...LearningPolicy.resolve(),
        executionImpact: 'NEW_BUY_BLOCKED_ONLY',
        reasonCodes: uniqueReasons([...reasonCodes, 'SELL_ONLY']),
      };
    }

    if (engineMode === 'SHADOW_ONLY') {
      return {
        engineMode,
        liveBuyAllowed: false,
        liveSellAllowed: false,
        ...LearningPolicy.resolve(),
        executionImpact: 'NONE',
        reasonCodes: uniqueReasons([...reasonCodes, 'SHADOW_ONLY']),
      };
    }

    if (engineMode === 'OBSERVE_ONLY') {
      return {
        engineMode,
        liveBuyAllowed: false,
        liveSellAllowed: false,
        ...LearningPolicy.resolve(),
        executionImpact: 'NONE',
        reasonCodes: uniqueReasons([...reasonCodes, 'OBSERVE_ONLY']),
      };
    }

    const liveBuyAllowed = input.liveBuyGateAllowed === true;
    const liveSellAllowed = input.liveSellGateAllowed !== false;
    return {
      engineMode,
      liveBuyAllowed,
      liveSellAllowed,
      ...LearningPolicy.resolve(),
      executionImpact: liveBuyAllowed || liveSellAllowed ? 'LIVE_ORDER_ALLOWED' : 'LIVE_ORDER_BLOCKED',
      reasonCodes,
    };
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
