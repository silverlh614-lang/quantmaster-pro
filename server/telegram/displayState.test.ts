import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetTelegramDisplayStateForTests,
  formatDisplayStateRenderedLog,
  formatTelegramEventRoutedLog,
  formatTelegramNotificationSuppressedLog,
  formatTelegramUserNoiseSuppressedLog,
  renderDisplayState,
  routeTelegramDisplayState,
  type DisplayState,
} from './displayState.js';

function buyCandidate(overrides: Partial<DisplayState> = {}): DisplayState {
  return {
    audience: 'USER_SIGNAL',
    severity: 'ACTION',
    eventType: 'BUY_CANDIDATE',
    symbol: '005930',
    name: '삼성전자',
    decision: 'BUY_ALLOWED',
    label: 'BUY',
    finalScore: 74,
    executionScore: 76,
    adjustmentScore: -2,
    advisoryScore: 9,
    positionAmount: 333_500,
    entryPrice: 70_000,
    stopLoss: 67_900,
    targetPrice: 74_200,
    riskReward: 2,
    mode: 'SHADOW',
    summaryLines: [
      '레짐 보정 -5',
      'Volume Clock: 점수 보정 -1',
      'AI 추정값: 실행 제외',
      'Shadow: ON',
    ],
    debugLines: ['[SCORE_CONFIDENCE_SPLIT] hidden'],
    tradingDate: '2026-05-21',
    ...overrides,
  };
}

describe('Simplification Step 8 Telegram DisplayState routing', () => {
  beforeEach(() => {
    __resetTelegramDisplayStateForTests();
  });

  it('routes BUY_ALLOWED candidate to USER_SIGNAL user channel', () => {
    const route = routeTelegramDisplayState(buyCandidate());

    expect(route.audience).toBe('USER_SIGNAL');
    expect(route.sentToUserChannel).toBe(true);
    expect(route.storedInternal).toBe(true);
    expect(route.executionDecisionImpact).toBe('NONE');
    expect(formatTelegramEventRoutedLog(route)).toContain('[TELEGRAM_EVENT_ROUTED]');
    expect(formatDisplayStateRenderedLog(route)).toContain("renderer='DISPLAY_STATE_ONLY'");
  });

  it('keeps ordinary WATCH off the user channel', () => {
    const route = routeTelegramDisplayState(buyCandidate({
      decision: 'WATCH',
      finalScore: 62,
      severity: 'SUMMARY',
    }));

    expect(route.audience).toBe('INTERNAL_LOG_ONLY');
    expect(route.sentToUserChannel).toBe(false);
    expect(route.storedInternal).toBe(true);
    expect(formatTelegramUserNoiseSuppressedLog(route)).toContain('[TELEGRAM_USER_NOISE_SUPPRESSED]');
  });

  it('routes provider issue debug noise away from the user channel', () => {
    const route = routeTelegramDisplayState({
      audience: 'USER_SIGNAL',
      severity: 'DEBUG',
      eventType: 'KIS_REALDATA_500',
      symbol: 'KIS',
      summaryLines: ['providerIssue isolated'],
      tradingDate: '2026-05-21',
    });

    expect(route.audience).toBe('OPERATOR_DEBUG');
    expect(route.sentToUserChannel).toBe(false);
    expect(route.sentToDebugChannel).toBe(true);
    expect(route.storedInternal).toBe(true);
  });

  it('renders Volume Clock as score adjustment, not a buy block', () => {
    const text = renderDisplayState(buyCandidate({
      summaryLines: ['Volume Clock: 점수 보정 -1', 'Shadow: ON'],
    }));

    expect(text).toContain('Volume Clock: 점수 보정 -1');
    expect(text).not.toContain(['Volume Clock', '매수 차단'].join(' '));
    expect(text).not.toContain('SELL_ONLY');
    expect(text).not.toContain('신규 진입 차단');
  });

  it('renders R6 as adjustment-only context, not a block', () => {
    const text = renderDisplayState(buyCandidate({
      summaryLines: ['레짐 보정 -5', 'executionImpact NONE'],
    }));

    expect(text).toContain('레짐 보정 -5');
    expect(text).toContain('executionImpact NONE');
    expect(text).not.toContain(['R6_DEFENSE', '신규 진입 차단'].join(' '));
    expect(text).not.toContain(['블랙스완 감지로', '매수 금지'].join(' '));
  });

  it('renders AI estimate as execution-excluded advisory, not a recommendation', () => {
    const text = renderDisplayState(buyCandidate({
      summaryLines: ['AI 추정값: 실행 제외'],
    }));

    expect(text).toContain('AI 추정값: 실행 제외');
    expect(text).not.toContain(['AI 추천으로', '매수'].join(' '));
  });

  it('deduplicates only notification delivery while preserving decision and learning impact', () => {
    const first = routeTelegramDisplayState(buyCandidate());
    const second = routeTelegramDisplayState(buyCandidate());

    expect(first.sentToUserChannel).toBe(true);
    expect(second.sentToUserChannel).toBe(false);
    expect(second.notificationSuppressed).toBe(true);
    expect(second.displayState.decision).toBe('BUY_ALLOWED');
    expect(second.learningImpact).toBe('NONE');
    expect(formatTelegramNotificationSuppressedLog(second)).toContain('[TELEGRAM_NOTIFICATION_SUPPRESSED]');
  });
});
