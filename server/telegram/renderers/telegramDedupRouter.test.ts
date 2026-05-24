import { describe, expect, it } from 'vitest';
import { TelegramDedupRouter, buildTelegramDedupKey } from './telegramDedupRouter.js';

describe('ADR-0523 Telegram dedup router', () => {
  it('suppresses same snapshot/status/top blocker during cooldown', () => {
    const router = new TelegramDedupRouter();
    const input = {
      messageType: 'GATE_SUMMARY' as const,
      sourceSnapshotId: 'scan-eval-0523',
      gateStage: 'GATE3',
      status: 'TRIGGER_WAIT',
      topBlockReason: 'VOLUME_WEAK',
      marketSession: 'REGULAR',
      nowMs: 1_000,
    };

    expect(router.decide(input).allowed).toBe(true);
    const second = router.decide({ ...input, nowMs: 2_000 });
    expect(second.allowed).toBe(false);
    expect(second.telegramCooldownReason).toBe('GATE_SUMMARY_COOLDOWN');
    expect(second.telegramDedupSuppressedCount).toBe(1);
  });

  it('dedups execution ready events by symbol and trigger event', () => {
    const key = buildTelegramDedupKey({
      messageType: 'EXECUTION_READY',
      sourceSnapshotId: 'scan-eval-0523',
      symbol: '204320',
      triggerEventId: 'trigger-1',
    });

    expect(key).toBe('EXECUTION_READY|scan-eval-0523|204320|trigger-1');
  });
});
