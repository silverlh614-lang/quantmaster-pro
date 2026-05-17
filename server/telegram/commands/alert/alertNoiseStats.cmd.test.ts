// @responsibility ADR-0468 /alert_noise_stats command registration and read-only output.
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('/alert_noise_stats command', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { commandRegistry } = await import('../../commandRegistry.js');
    commandRegistry.__resetForTests();
  });

  it('registers as an admin read-only alert command', async () => {
    await import('./alertNoiseStats.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');

    const cmd = commandRegistry.resolve('/alert_noise_stats');
    expect(cmd).toBeDefined();
    expect(cmd?.category).toBe('ALR');
    expect(cmd?.visibility).toBe('ADMIN');
    expect(cmd?.riskLevel).toBe(0);
  });

  it('replies with today noise suppression diagnostics', async () => {
    const mod = await import('./alertNoiseStats.cmd.js');
    const reply = vi.fn(async (_message: string) => {});

    await mod.default.execute({ args: [], reply });

    const message = String(reply.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('Alert Noise Stats');
    expect(message).toContain('suppressedByReason=');
    expect(message).toContain('digestedByChannel=');
    expect(message).toContain('sentByLevel=');
    expect(message).toContain('activeDedupeKeysCount=');
    expect(message).toContain('executionImpact=NONE');
  });
});
