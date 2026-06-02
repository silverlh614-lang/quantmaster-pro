// @responsibility Counterfactual Telegram command alias dispatch tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../_types.js';

describe('/counterfactual outcome board command', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../../../learning/counterfactualOutcomeBoard.js', () => ({
      buildCounterfactualOutcomeBoard: vi.fn(async () => ({ executionImpact: 'NONE' })),
      resolveCounterfactualCommandMode: vi.fn((command?: string, args: string[] = []) => {
        if (command === '/counterfactual_today') return 'today';
        if (command === '/counterfactual_gate1') return 'gate1';
        if (command === '/counterfactual_gate2') return 'gate2';
        if (command === '/counterfactual_gate3') return 'gate3';
        if (command === '/counterfactual_missed') return 'missed';
        if (command === '/counterfactual_review') return 'review';
        if (command === '/counterfactual_debug') return 'debug';
        return args[0] ?? 'summary';
      }),
      formatCounterfactualCommandReply: vi.fn((_board: unknown, mode: string) => `mode=${mode} executionImpact=NONE thresholdAutoChanged=false`),
    }));
    vi.doMock('../../../trading/signalScanner/scanDiagnostics.js', () => ({
      getLastScanSummary: vi.fn(() => ({ snapshotId: 'snapshot-test' })),
    }));
  });

  it('registers all board aliases to one read-only command object', async () => {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    await import('./counterfactual.cmd.js');

    const command = registry.commandRegistry.resolve('/counterfactual');
    expect(command).toBeDefined();
    for (const alias of [
      '/counterfactual_today',
      '/counterfactual_gate1',
      '/counterfactual_gate2',
      '/counterfactual_gate3',
      '/counterfactual_missed',
      '/counterfactual_review',
      '/counterfactual_debug',
    ]) {
      expect(registry.commandRegistry.resolve(alias)).toBe(command);
    }

    let replied = '';
    const reply: CommandContext['reply'] = async (message) => {
      replied = message;
    };
    await command!.execute({ args: [], command: '/counterfactual_today', reply });
    expect(replied).toContain('mode=today');
    expect(replied).toContain('executionImpact=NONE');

    await command!.execute({ args: ['gate2'], command: '/counterfactual', reply });
    expect(replied).toContain('mode=gate2');
    expect(command!.riskLevel).toBe(0);
  });
});
