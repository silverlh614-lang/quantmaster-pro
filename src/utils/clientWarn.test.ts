// @responsibility clientWarn P4 격리 동작 테스트
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { clientWarn } from './clientWarn';
import { __resetClientWarnDedupForTests } from './clientWarnDedup';
import { __resetClientWarnReporterForTests, getRecentClientWarnings } from './clientWarnReporter';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEBUG_CLIENT_WARN = process.env.DEBUG_CLIENT_WARN;
let warnSpy: MockInstance;

describe('clientWarn', () => {
  beforeEach(() => {
    __resetClientWarnDedupForTests();
    __resetClientWarnReporterForTests();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_DEBUG_CLIENT_WARN === undefined) delete process.env.DEBUG_CLIENT_WARN;
    else process.env.DEBUG_CLIENT_WARN = ORIGINAL_DEBUG_CLIENT_WARN;
    vi.restoreAllMocks();
  });

  it('emits a P4 client-only payload with no execution/server/telegram impact', () => {
    process.env.NODE_ENV = 'development';

    const payload = clientWarn({
      domain: 'UI',
      code: 'P4_CLIENT_DEBUG_WARN',
      message: 'debug panel only',
      dedupKey: 'clientWarn:test:payload',
    });

    expect(payload).toMatchObject({
      priority: 'P4',
      clientOnly: true,
      executionImpact: 'NONE',
      serverImpact: 'NONE',
      telegramAlert: false,
      ttlSec: 1800,
    });
    expect(getRecentClientWarnings()).toHaveLength(1);
  });

  it('deduplicates repeated warnings by dedupKey', () => {
    process.env.NODE_ENV = 'development';

    const first = clientWarn({
      domain: 'CLIENT_DATA',
      code: 'P4_CLIENT_DATA_STALE',
      message: 'stale UI data',
      dedupKey: 'clientWarn:test:dedup',
    });
    const second = clientWarn({
      domain: 'CLIENT_DATA',
      code: 'P4_CLIENT_DATA_STALE',
      message: 'stale UI data',
      dedupKey: 'clientWarn:test:dedup',
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses production console output unless DEBUG_CLIENT_WARN=true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEBUG_CLIENT_WARN;

    clientWarn({
      domain: 'CLIENT_DEBUG',
      code: 'P4_CLIENT_DEBUG_WARN',
      message: 'suppressed in prod',
      dedupKey: 'clientWarn:test:prod-suppress',
    });

    expect(warnSpy).not.toHaveBeenCalled();

    process.env.DEBUG_CLIENT_WARN = 'true';
    clientWarn({
      domain: 'CLIENT_DEBUG',
      code: 'P4_CLIENT_DEBUG_WARN',
      message: 'visible in prod when debug flag is set',
      dedupKey: 'clientWarn:test:prod-debug',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
