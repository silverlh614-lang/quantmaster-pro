import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAlertNoisePolicyForTests,
  evaluateAlertNoise,
  formatAlertNoiseStats,
  getAlertNoiseStats,
} from './alertNoisePolicy.js';

describe('ADR-0468 alert noise policy', () => {
  beforeEach(() => {
    __resetAlertNoisePolicyForTests();
  });

  it('suppresses KIS token 12h expiry and refresh success', () => {
    const expiry = evaluateAlertNoise({
      eventType: 'KIS_TOKEN_EXPIRY',
      tokenExpiresInSeconds: 12 * 60 * 60,
      expiresAt: '2026-05-17T21:00:00.000Z',
      nowMs: 1,
    });
    const success = evaluateAlertNoise({
      eventType: 'KIS_TOKEN_REFRESH_SUCCESS',
      expiresAt: '2026-05-18T09:00:00.000Z',
      nowMs: 2,
    });

    expect(expiry.shouldSendNow).toBe(false);
    expect(expiry.level).toBe('SILENT');
    expect(expiry.reason).toBe('KIS_TOKEN_12H_EXPIRY_SILENT');
    expect(expiry.dedupeKey).toBe('KIS_TOKEN:EXPIRY:2026-05-17T21');
    expect(success.shouldSendNow).toBe(false);
    expect(success.reason).toBe('KIS_TOKEN_REFRESH_SUCCESS_SILENT');
  });

  it('escalates KIS token refresh failure streak and 30m refresh failure', () => {
    const fail3 = evaluateAlertNoise({
      eventType: 'KIS_TOKEN_REFRESH_FAILED',
      consecutiveFailures: 3,
      tokenExpiresInSeconds: 2 * 60 * 60,
      nowMs: 1,
    });
    const fail30m = evaluateAlertNoise({
      eventType: 'KIS_TOKEN_REFRESH_FAILED',
      consecutiveFailures: 1,
      tokenExpiresInSeconds: 29 * 60,
      nowMs: 2,
    });

    expect(fail3.level).toBe('WARNING');
    expect(fail3.shouldSendNow).toBe(true);
    expect(fail30m.level).toBe('CRITICAL');
    expect(fail30m.shouldSendNow).toBe(true);
  });

  it('dedupes repeated watchlist full but sends NOTICE for strong candidate capacity rejection', () => {
    const first = evaluateAlertNoise({
      eventType: 'WATCHLIST_SATURATION',
      dedupeHint: 'MOMENTUM',
      nowMs: 1,
    });
    const repeat = evaluateAlertNoise({
      eventType: 'WATCHLIST_SATURATION',
      dedupeHint: 'MOMENTUM',
      nowMs: 2,
    });
    const strongReject = evaluateAlertNoise({
      eventType: 'WATCHLIST_CANDIDATE_REJECTED_CAPACITY',
      candidateStrength: 'STRONG_BUY',
      candidateRejectedDueToCapacity: true,
      symbol: '005930',
      session: 'REGULAR',
      nowMs: 3,
    });

    expect(first.level).toBe('DIGEST');
    expect(first.shouldDigest).toBe(true);
    expect(repeat.level).toBe('SILENT');
    expect(repeat.shouldSendNow).toBe(false);
    expect(repeat.reason).toBe('WATCHLIST_SATURATION_DEDUPED');
    expect(strongReject.level).toBe('NOTICE');
    expect(strongReject.shouldSendNow).toBe(true);
  });

  it('keeps legacy SELL_ONLY transition internal-only and suppresses maintained state', () => {
    const transition = evaluateAlertNoise({
      eventType: 'ENGINE_STATE',
      previousState: 'NORMAL',
      state: 'SELL_ONLY',
      nowMs: 1,
    });
    const maintained = evaluateAlertNoise({
      eventType: 'ENGINE_STATE',
      previousState: 'SELL_ONLY',
      state: 'SELL_ONLY',
      nowMs: 2,
    });

    expect(transition.shouldSendNow).toBe(false);
    expect(transition.level).toBe('SILENT');
    expect(transition.reason).toBe('LEGACY_SELL_ONLY_STATE_INTERNAL_ONLY');
    expect(maintained.shouldSendNow).toBe(false);
    expect(maintained.reason).toBe('LEGACY_SELL_ONLY_STATE_INTERNAL_ONLY');
  });

  it('suppresses health ok and backup success', () => {
    const health = evaluateAlertNoise({ eventType: 'HEALTH_OK', nowMs: 1 });
    const backup = evaluateAlertNoise({ eventType: 'BACKUP_SUCCESS', nowMs: 2 });
    const scanEmpty = evaluateAlertNoise({ eventType: 'SCAN_EMPTY', nowMs: 3 });

    expect(health.shouldSendNow).toBe(false);
    expect(health.level).toBe('SILENT');
    expect(backup.shouldSendNow).toBe(false);
    expect(backup.level).toBe('SILENT');
    expect(scanEmpty.shouldSendNow).toBe(false);
    expect(scanEmpty.level).toBe('SILENT');
  });

  it('suppresses P3 diagnostic provider failure but warns on P1 execution failure', () => {
    const diagnostic = evaluateAlertNoise({
      eventType: 'PROVIDER_FAILURE',
      provider: 'YAHOO',
      providerTier: 'P3',
      consecutiveFailures: 1,
      executionImpact: 'NONE',
      nowMs: 1,
    });
    const execution = evaluateAlertNoise({
      eventType: 'PROVIDER_FAILURE',
      provider: 'KIS',
      providerTier: 'P1',
      consecutiveFailures: 1,
      executionImpact: 'QUERY_BLOCKED',
      nowMs: 2,
    });

    expect(diagnostic.shouldSendNow).toBe(false);
    expect(diagnostic.level).toBe('SILENT');
    expect(execution.shouldSendNow).toBe(true);
    expect(execution.level).toBe('WARNING');
    expect(execution.reason).toBe('PROVIDER_EXECUTION_DATA_IMPACT_WARNING');
  });

  it('suppresses Telegram HTML retry success and warns when plain retry fails', () => {
    const retrySuccess = evaluateAlertNoise({
      eventType: 'TELEGRAM_HTML_RETRY',
      templateId: 'position-card',
      plainRetrySuccess: true,
      nowMs: 1,
    });
    const plainFail = evaluateAlertNoise({
      eventType: 'TELEGRAM_HTML_RETRY',
      templateId: 'position-card',
      plainRetrySuccess: false,
      templateFailureCount: 1,
      nowMs: 2,
    });

    expect(retrySuccess.shouldSendNow).toBe(false);
    expect(retrySuccess.reason).toBe('TELEGRAM_HTML_PARSE_RETRY_SUCCESS_SILENT');
    expect(plainFail.shouldSendNow).toBe(true);
    expect(plainFail.level).toBe('WARNING');
  });

  it('formats alert noise stats with suppressed, digested, sent, noisy type, and active dedupe counts', () => {
    evaluateAlertNoise({ eventType: 'HEALTH_OK', nowMs: 1 });
    evaluateAlertNoise({ eventType: 'WATCHLIST_SATURATION', channel: 'CH4_JOURNAL', nowMs: 2 });
    evaluateAlertNoise({ eventType: 'KIS_TOKEN_REFRESH_FAILED', consecutiveFailures: 3, nowMs: 3 });

    const stats = getAlertNoiseStats(new Date(4));
    const msg = formatAlertNoiseStats(stats);

    expect(stats.suppressedByReason.HEALTH_OK_SILENT).toBe(1);
    expect(stats.digestedByChannel.CH4_JOURNAL).toBe(1);
    expect(stats.sentByLevel.WARNING).toBe(1);
    expect(stats.topNoisyEventTypes.some((x) => x.eventType === 'HEALTH_OK')).toBe(true);
    expect(msg).toContain('activeDedupeKeysCount=');
    expect(msg).toContain('executionImpact=NONE');
  });

  it('keeps alert noise stats scoped to the current KST date', () => {
    const day1 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const day2 = day1 + 24 * 60 * 60 * 1000;

    evaluateAlertNoise({ eventType: 'HEALTH_OK', nowMs: day1 });
    expect(getAlertNoiseStats(new Date(day1)).suppressedByReason.HEALTH_OK_SILENT).toBe(1);

    const nextDay = getAlertNoiseStats(new Date(day2));
    expect(nextDay.suppressedByReason.HEALTH_OK_SILENT).toBeUndefined();
    expect(nextDay.topNoisyEventTypes).toEqual([]);
  });
});
