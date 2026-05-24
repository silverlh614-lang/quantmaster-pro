import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../_types.js';

describe('/governance ADR-0525 command', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders compact/detail/item and blocks unauthorized approval', async () => {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    const outcome = await import('../../../learning/outcomeClosure.js');
    const fixtures = await import('../../../learning/dynamicWeightFeedbackFixtures.js');
    const governance = await import('../../../learning/promotionGovernance.js');
    outcome.outcomeClosureRepo.reset();
    governance.promotionGovernanceRepo.reset();
    for (const seed of fixtures.repeatSamples('WIN', 115, { gate2AxisScores: { SUPPLY_CONFLUENCE: 95 } })) {
      outcome.outcomeClosureRepo.createSeedIfNotExists(seed);
    }
    await import('./governance.cmd.js');

    const command = registry.commandRegistry.resolve('/governance');
    expect(command).toBeDefined();
    expect(registry.commandRegistry.resolve('/strategy_draft')).toBe(command);
    expect(registry.commandRegistry.resolve('/strategy_rollback')).toBe(command);

    let replied = '';
    const reply: CommandContext['reply'] = async (message) => {
      replied = message;
    };

    await command!.execute({ args: [], command: '/governance', reply });
    expect(replied).toContain('[Governance]');
    expect(replied).toContain('autoApply: false');
    expect(replied).toContain('impact: NONE');

    await command!.execute({ args: ['detail'], command: '/governance', reply });
    expect(replied).toContain('Items:');
    const itemId = governance.promotionGovernanceRepo.listItems()[0]!.itemId;

    await command!.execute({ args: ['item', itemId], command: '/governance', reply });
    expect(replied).toContain('[Governance Review]');
    expect(replied).toContain('Buttons: [Approve] [Reject] [Defer] [Quarantine] [Detail]');

    await command!.execute({ args: ['approve', itemId, 'nope'], command: '/governance', userId: 'guest', reply });
    expect(replied).toContain('UNAUTHORIZED_GOVERNANCE_ACTION');
    expect(replied).toContain('executionImpact=NONE');
  }, 20000);
});
