import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../_types.js';

describe('/strategy ADR-0526 command', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('renders registry, diff, safe apply, and rejects unauthorized live apply', async () => {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    const strategy = await import('../../../learning/strategyVersioning.js');
    const fixtures = await import('../../../learning/strategyVersioningFixtures.js');
    strategy.strategyVersionRepo.reset();
    const version = strategy.strategyVersionRepo.createVersion(fixtures.strategyVersionFixture());

    await import('./strategy.cmd.js');
    const command = registry.commandRegistry.resolve('/strategy');
    expect(command).toBeDefined();

    let replied = '';
    const reply: CommandContext['reply'] = async (message) => {
      replied = message;
    };

    await command!.execute({ args: [], command: '/strategy', reply });
    expect(replied).toContain('[Strategy]');
    expect(replied).toContain('impact: NONE');

    await command!.execute({ args: ['diff', version.versionId], command: '/strategy', reply });
    expect(replied).toContain('[Strategy Diff]');

    await command!.execute({ args: ['apply_live', version.versionId], command: '/strategy', userId: 'guest', reply });
    expect(replied).toContain('UNAUTHORIZED_STRATEGY_ACTION');
    expect(replied).toContain('executionImpact=NONE');

    await command!.execute({ args: ['apply_shadow', version.versionId], command: '/strategy', userId: 'operator', reply });
    expect(replied).toContain('[Strategy Apply]');
    expect(replied).toContain('ok: true');
    expect(replied).toContain('shadowLearning: true');
  }, 20000);
});
