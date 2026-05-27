// @responsibility Telegram notification severity router regression tests.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTelegramNotificationPolicyForTests,
  formatNotificationClassifiedLog,
  formatTelegramNotificationPolicyStats,
  formatTelegramNotificationSuppressedLog,
  getTelegramNotificationPolicyStats,
  recordTelegramNotificationSent,
  routeTelegramNotification,
} from './telegramNotificationPolicy.js';

describe('telegramNotificationPolicy', () => {
  beforeEach(() => {
    __resetTelegramNotificationPolicyForTests();
  });

  it('suppresses explicit executionImpact=NONE diagnostic push messages', () => {
    const decision = routeTelegramNotification({
      message: [
        '[Threshold 진단]',
        'executionImpact=NONE',
        'marketSignal=false',
        'providerIssue=false',
        'kisImpact=NONE',
        'actionRequired=false',
        'tradeEvent=false',
        'critical=false',
        'diagnosticOnly=true',
      ].join('\n'),
      eventType: 'THRESHOLD_SEARCH_LOOP',
      nowMs: 1000,
    });

    expect(decision.severity).toBe('DIAGNOSTIC');
    expect(decision.shouldSuppress).toBe(true);
    expect(decision.telegramEligible).toBe(false);
    expect(decision.reason).toBe('DIAGNOSTIC_ONLY');
    expect(formatTelegramNotificationSuppressedLog(decision)).toContain('telegramSent=false');
  });

  it('allows manual bot query diagnostic responses even when diagnosticOnly=true', () => {
    const decision = routeTelegramNotification({
      message: [
        '🔬 [scan_blockers full mode]',
        'diagnosticOnly=true',
        'executionImpact=NONE',
        'marketSignal=false',
        'providerIssue=false',
        'kisImpact=NONE',
      ].join('\n'),
      eventType: 'BOT_QUERY_RESPONSE',
      targetChannel: 'BOT_QUERY_RESPONSE',
      diagnosticOnly: true,
      executionImpact: 'NONE',
      marketSignal: false,
      providerIssue: false,
      kisImpact: 'NONE',
      nowMs: 1000,
    });

    expect(decision.severity).toBe('DIAGNOSTIC');
    expect(decision.targetChannel).toBe('BOT_QUERY_RESPONSE');
    expect(decision.shouldSuppress).toBe(false);
    expect(decision.telegramEligible).toBe(true);
    expect(decision.reason).toBe('BOT_QUERY_RESPONSE_MANUAL_REQUEST');
  });

  it('routes approval-required events as ACTION_REQUIRED without changing trading fields', () => {
    const decision = routeTelegramNotification({
      message: '[Threshold 제안 — 승인 필요]\nactionRequired=true\nexecutionImpact=NONE',
      eventType: 'THRESHOLD_SEARCH_LOOP',
      actionRequired: true,
      executionImpact: 'NONE',
      marketSignal: false,
      providerIssue: false,
      kisImpact: 'NONE',
      nowMs: 1000,
    });

    expect(decision.severity).toBe('ACTION_REQUIRED');
    expect(decision.shouldSuppress).toBe(false);
    expect(decision.priority).toBe('HIGH');
    expect(decision.tier).toBe('T1_ALARM');
    expect(formatNotificationClassifiedLog(decision)).toContain('tradingLogicChanged=false');
    expect(formatNotificationClassifiedLog(decision)).toContain('orderLogicChanged=false');
  });

  it('suppresses no-impact push when it is not an explicit summary', () => {
    const decision = routeTelegramNotification({
      message: 'executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE actionRequired=false tradeEvent=false critical=false',
      eventType: 'NO_ENTRY_DIAGNOSTIC',
      nowMs: 1000,
    });

    expect(decision.shouldSuppress).toBe(true);
    expect(decision.reason).toBe('DIAGNOSTIC_PUSH_DISABLED');
  });

  it('does not suppress CRITICAL notifications', () => {
    const decision = routeTelegramNotification({
      message: '[ORDER / failure]',
      eventType: 'LIVE_ORDER_FAILURE',
      priority: 'CRITICAL',
      critical: true,
      nowMs: 1000,
    });

    expect(decision.severity).toBe('CRITICAL');
    expect(decision.shouldSuppress).toBe(false);
    expect(decision.reason).toBe('CRITICAL_ALWAYS_PUSH');
  });

  it('allows explicitly scheduled SUMMARY even when execution impact is none', () => {
    const decision = routeTelegramNotification({
      message: '[MiddayRescan 완료]',
      eventType: 'MIDDAY_RESCAN_WATCHLIST_ADDED',
      severity: 'SUMMARY',
      summaryId: 'midday_20260527_1300',
      executionImpact: 'NONE',
      marketSignal: false,
      providerIssue: false,
      kisImpact: 'NONE',
      actionRequired: false,
      tradeEvent: false,
      critical: false,
      nowMs: 1000,
    });

    expect(decision.severity).toBe('SUMMARY');
    expect(decision.shouldSuppress).toBe(false);
    expect(decision.telegramEligible).toBe(true);
  });

  it('dedups TRADE_EVENT by exact eventId only after it was sent', () => {
    const input = {
      message: '[EXECUTION] shadow close',
      eventType: 'SHADOW_POSITION_CLOSED',
      tradeEvent: true,
      eventId: 'evt-shadow-close-1',
      nowMs: 1000,
    };
    const first = routeTelegramNotification(input);
    recordTelegramNotificationSent(first, input.eventId, 1000);
    const second = routeTelegramNotification({ ...input, nowMs: 2000 });

    expect(first.severity).toBe('TRADE_EVENT');
    expect(first.shouldSuppress).toBe(false);
    expect(second.shouldSuppress).toBe(true);
    expect(second.reason).toBe('TRADE_EVENT_DUPLICATE_EVENT_ID');
  });

  it('aggregates suppression stats for /noise_summary style diagnostics', () => {
    const decision = routeTelegramNotification({
      message: 'executionImpact=NONE marketSignal=false providerIssue=false kisImpact=NONE',
      eventType: 'WATCHLIST_SOFT_CAP',
      diagnosticOnly: true,
      nowMs: 1000,
    });
    expect(decision.shouldSuppress).toBe(true);

    const stats = getTelegramNotificationPolicyStats(new Date(1000));
    const formatted = formatTelegramNotificationPolicyStats(stats);

    expect(stats.suppressedCount).toBe(1);
    expect(formatted).toContain('[NOTIFICATION_DAILY_SUMMARY_AGGREGATED]');
    expect(formatted).toContain('watchlistSelectionChanged=false');
  });
});
