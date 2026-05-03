// @responsibility R3 sanity block persistence and one-shot ACK token validation

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir = '';
let repo: typeof import('./r3SanityBlockRepo.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-sanity-block-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
  repo = await import('./r3SanityBlockRepo.js');
  repo.__resetR3SanityBlockForTests();
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('r3SanityBlockRepo', () => {
  it('activates and loads persistent block state', () => {
    const state = repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      message: 'block',
      now: new Date('2026-05-03T00:00:00Z'),
    });

    expect(state.active).toBe(true);
    expect(repo.loadR3SanityBlockState().triggeredAt).toBe('2026-05-03T00:00:00.000Z');
  });

  it('requires exact one-shot ACK token, not plain true', () => {
    const state = repo.activateR3SanityBlock({
      violation: 'CANDIDATES_ZERO',
      regime: 'R3_EARLY',
      message: 'block',
      now: new Date('2026-05-03T00:00:00Z'),
    });

    expect(repo.isR3SanityAckTokenValid(state, 'true')).toBe(false);
    expect(repo.isR3SanityAckTokenValid(state, state.triggeredAt)).toBe(true);
    expect(repo.isR3SanityAckTokenValid(state, `ACK:${state.triggeredAt}`)).toBe(true);
  });
});
