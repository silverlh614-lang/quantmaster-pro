// @responsibility: /learning_weights_reset Telegram command metadata, dry-run, and confirm reset behavior.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../_types.js';

describe('/learning_weights_reset command', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-weights-reset-cmd-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PERSIST_DATA_DIR;
    } else {
      process.env.PERSIST_DATA_DIR = originalDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function loadCommand() {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    const repo = await import('../../../persistence/conditionWeightsRepo.js');
    const quant = await import('../../../quantFilter.js');
    const mod = await import('./learningWeightsReset.cmd.js');
    return { command: mod.default, registry, repo, DEFAULT_CONDITION_WEIGHTS: quant.DEFAULT_CONDITION_WEIGHTS };
  }

  it('registers as an admin autocomplete-visible light mutation command', async () => {
    const { command, registry } = await loadCommand();

    expect(command.name).toBe('/learning_weights_reset');
    expect(command.category).toBe('LRN');
    expect(command.visibility).toBe('ADMIN');
    expect(command.riskLevel).toBe(1);
    expect(command.showInMenu).toBe(true);
    expect(command.menuPriority).toBe(0);
    expect(registry.commandRegistry.resolve('/weights_reset')).toBe(command);
    expect(registry.commandRegistry.resolve('/reset_weights')).toBe(command);
  }, 15000);

  it('dry-run reports drift without mutating weights', async () => {
    const { command, repo, DEFAULT_CONDITION_WEIGHTS } = await loadCommand();
    repo.saveConditionWeights({ ...DEFAULT_CONDITION_WEIGHTS, momentum: 0.1 });
    const replies: string[] = [];
    const reply: CommandContext['reply'] = async (message) => {
      replies.push(message);
    };

    await command.execute({ args: ['dryrun'], reply });

    expect(repo.loadConditionWeights().momentum).toBe(0.1);
    expect(replies.join('\n')).toContain('[Learning weights reset dry-run]');
    expect(replies.join('\n')).toContain('currentDriftCount=1');
    expect(replies.join('\n')).toContain('mutation=false');
  }, 15000);

  it('confirm resets global weights to defaults with no execution impact', async () => {
    const { command, repo, DEFAULT_CONDITION_WEIGHTS } = await loadCommand();
    repo.saveConditionWeights({ ...DEFAULT_CONDITION_WEIGHTS, supply_confluence: 0.1 });
    const replies: string[] = [];
    const reply: CommandContext['reply'] = async (message) => {
      replies.push(message);
    };

    await command.execute({ args: ['confirm'], reply });

    expect(repo.loadConditionWeights()).toEqual(DEFAULT_CONDITION_WEIGHTS);
    const body = replies.join('\n');
    expect(body).toContain('[Learning weights reset applied]');
    expect(body).toContain('resetGlobal=true');
    expect(body).toContain('backupFiles=condition-weights.json.');
    expect(body).toContain('executionImpact=NONE');
    expect(body).toContain('liveExecutionAllowed=false');
    expect(body).toContain('shadowLearningImpact=NONE');
  }, 15000);
});
