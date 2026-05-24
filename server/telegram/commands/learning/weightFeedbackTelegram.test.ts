import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../_types.js';

describe('/weight_feedback ADR-0524 command', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers compact/detail/full report-only feedback command aliases', async () => {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    const outcome = await import('../../../learning/outcomeClosure.js');
    const fixtures = await import('../../../learning/dynamicWeightFeedbackFixtures.js');
    outcome.outcomeClosureRepo.reset();
    for (const seed of [
      ...fixtures.repeatSamples('WIN', 100, { gate2AxisScores: { SUPPLY_CONFLUENCE: 94 } }),
      ...fixtures.repeatSamples('MISSED_WIN', 35, { engineMode: 'SELL_ONLY' }),
    ]) {
      outcome.outcomeClosureRepo.createSeedIfNotExists(seed);
    }

    await import('./weightFeedback.cmd.js');
    const command = registry.commandRegistry.resolve('/weight_feedback');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/weight_fb')).toBe(command);
    expect(registry.commandRegistry.resolve('/weight_feedback_full')).toBe(command);

    const replies: string[] = [];
    let replied = '';
    const reply: CommandContext['reply'] = async (message) => {
      replies.push(message);
      replied = message;
    };

    await command!.execute({ args: [], command: '/weight_feedback', reply });
    expect(replied).toContain('[Weight Feedback]');
    expect(replied).toContain('status: REPORT_ONLY');
    expect(replied).toContain('impact: NONE');
    expect(replied).toContain('approvalRequired=true autoApplyAllowed=false');
    expect(replied).toContain('no CORE weight mutation');
    expect(replied).toContain('no provider fetch');
    expect(replied).toContain('no broker order');

    await command!.execute({ args: ['detail'], command: '/weight_feedback', reply });
    expect(replied).toContain('Factor Contribution:');
    expect(replied).toContain('Suggested Actions:');

    replies.length = 0;
    await command!.execute({ args: [], command: '/weight_feedback_full', reply });
    const fullReply = replies.join('\n');
    expect(fullReply).toContain('Governance Handoff:');
    expect(fullReply).toContain('"autoApplyAllowed": false');
  }, 15000);
});
