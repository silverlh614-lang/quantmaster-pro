import { beforeEach, describe, expect, it } from 'vitest';

import { clearWarnDedupStore, shouldEmitWarn } from './warnDedupStore.js';

describe('warnDedupStore', () => {
  beforeEach(() => clearWarnDedupStore());

  it('allows first emit and suppresses same key until ttl expires', () => {
    expect(shouldEmitWarn('key', 30, 1_000)).toEqual({
      allowed: true,
      suppressedCount: 0,
      expiresAt: 31_000,
    });
    expect(shouldEmitWarn('key', 30, 2_000)).toEqual({
      allowed: false,
      suppressedCount: 1,
      expiresAt: 31_000,
    });
    expect(shouldEmitWarn('key', 30, 31_001).allowed).toBe(true);
  });
});
