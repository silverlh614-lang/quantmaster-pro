// @responsibility ADR-0523 display dedup/cooldown for Telegram diagnostic messages.

type TelegramMessageType = 'GATE_SUMMARY' | 'GATE_BLOCKER' | 'PROVIDER_ISSUE' | 'EXECUTION_READY' | 'LEARNING_PULSE';

export interface TelegramDedupInput {
  messageType: TelegramMessageType;
  sourceSnapshotId: string;
  gateStage?: string;
  status?: string;
  topBlockReason?: string;
  marketSession?: string;
  symbol?: string;
  triggerEventId?: string;
  nowMs?: number;
}

export interface TelegramDedupDecision {
  allowed: boolean;
  dedupKey: string;
  telegramDedupSuppressedCount: number;
  telegramCooldownReason: string;
  telegramLastSentAt: string | null;
}

export class TelegramDedupRouter {
  private readonly lastSent = new Map<string, number>();
  private suppressed = 0;

  decide(input: TelegramDedupInput): TelegramDedupDecision {
    const nowMs = input.nowMs ?? Date.now();
    const dedupKey = buildTelegramDedupKey(input);
    const last = this.lastSent.get(dedupKey);
    const cooldownMs = cooldownFor(input.messageType);
    if (last != null && nowMs - last < cooldownMs) {
      this.suppressed += 1;
      return {
        allowed: false,
        dedupKey,
        telegramDedupSuppressedCount: this.suppressed,
        telegramCooldownReason: `${input.messageType}_COOLDOWN`,
        telegramLastSentAt: new Date(last).toISOString(),
      };
    }
    this.lastSent.set(dedupKey, nowMs);
    return {
      allowed: true,
      dedupKey,
      telegramDedupSuppressedCount: this.suppressed,
      telegramCooldownReason: 'NONE',
      telegramLastSentAt: last == null ? null : new Date(last).toISOString(),
    };
  }

  reset(): void {
    this.lastSent.clear();
    this.suppressed = 0;
  }
}

export function buildTelegramDedupKey(input: TelegramDedupInput): string {
  if (input.messageType === 'EXECUTION_READY' && input.symbol) {
    return [
      input.messageType,
      input.sourceSnapshotId,
      input.symbol,
      input.triggerEventId ?? 'NO_TRIGGER_EVENT',
    ].join('|');
  }
  return [
    input.messageType,
    input.sourceSnapshotId,
    input.gateStage ?? 'ALL_GATES',
    input.status ?? 'UNKNOWN',
    input.topBlockReason ?? 'none',
    input.marketSession ?? 'UNKNOWN_SESSION',
  ].join('|');
}

function cooldownFor(type: TelegramMessageType): number {
  if (type === 'GATE_SUMMARY') return 10 * 60 * 1000;
  if (type === 'GATE_BLOCKER') return 30 * 60 * 1000;
  if (type === 'PROVIDER_ISSUE') return 60 * 60 * 1000;
  if (type === 'LEARNING_PULSE') return 24 * 60 * 60 * 1000;
  return 0;
}
