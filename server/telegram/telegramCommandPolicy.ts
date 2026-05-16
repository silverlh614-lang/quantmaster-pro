// @responsibility Telegram command safety policy for snapshot-only operator commands.

export type TelegramCommandOperation =
  | 'READ_DECISION_SNAPSHOT'
  | 'FORMAT_SNAPSHOT'
  | 'RECOMPUTE_GATE'
  | 'CALL_PROVIDER'
  | 'MUTATE_ENGINE_MODE';

export interface TelegramCommandPolicyResult {
  operation: TelegramCommandOperation;
  allowed: boolean;
  gateEvaluationAllowed: boolean;
  providerCallAllowed: boolean;
  engineModeMutationAllowed: boolean;
  snapshotReadAllowed: boolean;
  reasonCode: string;
}

export function resolveTelegramCommandPolicy(operation: TelegramCommandOperation): TelegramCommandPolicyResult {
  if (operation === 'READ_DECISION_SNAPSHOT' || operation === 'FORMAT_SNAPSHOT') {
    return {
      operation,
      allowed: true,
      gateEvaluationAllowed: false,
      providerCallAllowed: false,
      engineModeMutationAllowed: false,
      snapshotReadAllowed: true,
      reasonCode: 'TELEGRAM_VIEW_LAYER_ONLY',
    };
  }

  return {
    operation,
    allowed: false,
    gateEvaluationAllowed: false,
    providerCallAllowed: false,
    engineModeMutationAllowed: false,
    snapshotReadAllowed: true,
    reasonCode: 'TELEGRAM_COMMAND_SIDE_EFFECT_FORBIDDEN',
  };
}
