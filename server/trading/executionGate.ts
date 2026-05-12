// @responsibility live execution gate invariants
export function computeLiveExecutionAllowed(input: {
  mode: string;
  freshExecutionProviderExists: boolean;
  executionStage: string;
  hasCriticalProviderMismatch: boolean;
}): boolean {
  return input.mode !== 'KIS_ONLY_REBUILD'
    && input.freshExecutionProviderExists
    && input.executionStage === 'CORE'
    && !input.hasCriticalProviderMismatch;
}

export function recordShadowCase<T extends Record<string, unknown>>(entry: T): T & {
  executionImpact: 'NONE';
  shadowLearning: true;
  providerIssue: false;
  marketSignal: false;
} {
  return {
    ...entry,
    executionImpact: 'NONE',
    shadowLearning: true,
    providerIssue: false,
    marketSignal: false,
  };
}
