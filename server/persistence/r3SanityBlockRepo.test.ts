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

describe('getEffectiveR3SanityBlockState (TTL auto-decay — 영구 stuck 재발 방지)', () => {
  afterEach(() => {
    delete process.env.R3_SANITY_TTL_HOURS;
  });

  it('TTL 미설정(default 0)이면 age 무관 active 유지 (byte-equivalent)', () => {
    delete process.env.R3_SANITY_TTL_HOURS;
    repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'block',
      now: new Date('2026-05-01T00:00:00Z'),
    });
    // 10일 경과해도 TTL 미설정이면 effective active 유지(기존 영구 동작 보존).
    expect(repo.getEffectiveR3SanityBlockState(new Date('2026-05-11T00:00:00Z')).active).toBe(true);
    expect(repo.getR3SanityBlockTtlHours()).toBe(0);
  });

  it('TTL 설정 + 미경과면 active 유지', () => {
    process.env.R3_SANITY_TTL_HOURS = '24';
    repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'block',
      now: new Date('2026-05-01T00:00:00Z'),
    });
    expect(repo.getEffectiveR3SanityBlockState(new Date('2026-05-01T12:00:00Z')).active).toBe(true);
  });

  it('TTL 설정 + 경과면 effective inactive (자동 self-heal), 영속 파일은 read-only 보존', () => {
    process.env.R3_SANITY_TTL_HOURS = '24';
    repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'block',
      now: new Date('2026-05-01T00:00:00Z'),
    });
    expect(repo.getEffectiveR3SanityBlockState(new Date('2026-05-02T01:00:00Z')).active).toBe(false); // 25h>24h
    // 자매 streak repo 패턴 — getEffective 는 영속 파일 무변경(read-only).
    expect(repo.loadR3SanityBlockState().active).toBe(true);
  });

  it('getR3SanityBlockTtlHours: 미설정/빈값/NaN/0/음수 → 0, 양수 → 값', () => {
    delete process.env.R3_SANITY_TTL_HOURS;
    expect(repo.getR3SanityBlockTtlHours()).toBe(0);
    process.env.R3_SANITY_TTL_HOURS = '';
    expect(repo.getR3SanityBlockTtlHours()).toBe(0);
    process.env.R3_SANITY_TTL_HOURS = 'abc';
    expect(repo.getR3SanityBlockTtlHours()).toBe(0);
    process.env.R3_SANITY_TTL_HOURS = '0';
    expect(repo.getR3SanityBlockTtlHours()).toBe(0);
    process.env.R3_SANITY_TTL_HOURS = '-5';
    expect(repo.getR3SanityBlockTtlHours()).toBe(0);
    process.env.R3_SANITY_TTL_HOURS = '48';
    expect(repo.getR3SanityBlockTtlHours()).toBe(48);
  });

  it('post-TTL 재트리거: 만료 후 동일 violation 이 latch 를 refresh (dedup 우회)', () => {
    process.env.R3_SANITY_TTL_HOURS = '24';
    repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'old',
      now: new Date('2026-05-01T00:00:00Z'),
    });
    // 25h 경과 후 동일 violation 재트리거 → effective expired 라 dedup 우회, fresh triggeredAt.
    const refreshed = repo.activateR3SanityBlock({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', message: 'new',
      now: new Date('2026-05-02T01:00:00Z'),
    });
    expect(refreshed.triggeredAt).toBe('2026-05-02T01:00:00.000Z');
    expect(refreshed.message).toBe('new');
  });
});
