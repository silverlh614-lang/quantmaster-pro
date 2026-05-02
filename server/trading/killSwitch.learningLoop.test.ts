import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';

vi.setConfig({ testTimeout: 15000 });

describe('killSwitch learning loop inputs', () => {
  afterEach(() => {
    delete process.env.LEARNING_LOOP_KILL_SWITCH_DISABLED;
  });

  it('STATELESS creates LEARNING_LOOP_STATELESS trigger', async () => {
    const { assessKillSwitch } = await import('./killSwitch.js');
    const assessment = assessKillSwitch({ learningLoopLevel: 'STATELESS' });
    expect(assessment.triggers).toContain('LEARNING_LOOP_STATELESS');
    expect(assessment.shouldDowngrade).toBe(true);
  });

  it('DEGRADED creates warning only', async () => {
    const { assessKillSwitch } = await import('./killSwitch.js');
    const assessment = assessKillSwitch({ learningLoopLevel: 'DEGRADED' });
    expect(assessment.triggers).not.toContain('LEARNING_LOOP_DEGRADED');
    expect(assessment.warnings).toContain('LEARNING_LOOP_DEGRADED');
  });

  it('INSUFFICIENT_DATA does not trigger downgrade', async () => {
    const { assessKillSwitch } = await import('./killSwitch.js');
    const assessment = assessKillSwitch({ learningLoopLevel: 'INSUFFICIENT_DATA' });
    expect(assessment.triggers).not.toContain('LEARNING_LOOP_INSUFFICIENT_DATA');
  });

  it('disabled env suppresses STATELESS trigger', async () => {
    process.env.LEARNING_LOOP_KILL_SWITCH_DISABLED = 'true';
    const { assessKillSwitch } = await import('./killSwitch.js');
    const assessment = assessKillSwitch({ learningLoopLevel: 'STATELESS' });
    expect(assessment.triggers).not.toContain('LEARNING_LOOP_STATELESS');
  });

  it('does not import learningLoopHealth directly', () => {
    const src = fs.readFileSync('server/trading/killSwitch.ts', 'utf-8');
    expect(src).not.toContain('learningLoopHealth');
  });
});
