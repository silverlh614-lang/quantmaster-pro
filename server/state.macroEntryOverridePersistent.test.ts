import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ORIGINAL_PERSIST_DIR = process.env.PERSIST_DATA_DIR;

async function loadState() {
  return import('./state.js');
}

describe('MacroEntryOverride persistent state', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-macro-entry-override-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_PERSIST_DIR === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = ORIGINAL_PERSIST_DIR;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.resetModules();
  });

  it('survives module reload so Telegram and scheduler processes can share it', async () => {
    const stateA = await loadState();
    stateA.setMacroEntryOverride({
      targets: ['R6_DEFENSE', 'FOMC_BLOCK'],
      ttlMinutes: 60,
      reason: 'operator approved',
      now: new Date('2026-05-15T08:00:00.000Z'),
    });

    vi.resetModules();
    const stateB = await loadState();
    const restored = stateB.getMacroEntryOverrideState(new Date('2026-05-15T08:30:00.000Z'));

    expect(restored?.targets).toEqual(['R6_DEFENSE', 'FOMC_BLOCK']);
    expect(restored?.reason).toBe('operator approved');
    expect(restored?.expiresAt).toBe('2026-05-15T09:00:00.000Z');
  });

  it('clears the persistent file when the override expires', async () => {
    const state = await loadState();
    state.setMacroEntryOverride({
      targets: ['VIX_BLOCK'],
      ttlMinutes: 10,
      now: new Date('2026-05-15T08:00:00.000Z'),
    });

    expect(state.getMacroEntryOverrideState(new Date('2026-05-15T08:09:59.000Z'))?.targets).toEqual(['VIX_BLOCK']);
    expect(state.getMacroEntryOverrideState(new Date('2026-05-15T08:10:00.000Z'))).toBeNull();

    vi.resetModules();
    const stateAfterReload = await loadState();
    expect(stateAfterReload.getMacroEntryOverrideState(new Date('2026-05-15T08:10:01.000Z'))).toBeNull();
  });
});
