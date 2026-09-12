import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertCategory } from './alertCategories.js';

const mocks = vi.hoisted(() => ({
  sendChannelAlertTo: vi.fn(async (): Promise<number | undefined> => 777),
  incrementChannelStat: vi.fn(),
  appendAlertHistory: vi.fn(),
}));

vi.mock('./telegramClient.js', () => ({
  sendChannelAlertTo: mocks.sendChannelAlertTo,
}));

vi.mock('../persistence/channelStatsRepo.js', () => ({
  incrementChannelStat: mocks.incrementChannelStat,
}));

vi.mock('../persistence/alertHistoryRepo.js', () => ({
  appendAlertHistory: mocks.appendAlertHistory,
}));

const { dispatchAlert, getChannelFlushStatus, runChannelHealthCheck } = await import('./alertRouter.js');

describe('channel connection test', () => {
  beforeEach(() => {
    vi.stubEnv('CHANNEL_ENABLED', 'true');
    for (const category of Object.values(AlertCategory)) vi.stubEnv(`${category}_CHANNEL_ENABLED`, 'true');
    vi.stubEnv('CHANNEL_MAP', JSON.stringify({ TRADE: 'same', ANALYSIS: 'same', INFO: 'same', SYSTEM: 'same' }));
    mocks.sendChannelAlertTo.mockResolvedValue(777);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends once when categories share a destination', async () => {
    const result = await runChannelHealthCheck();
    expect(mocks.sendChannelAlertTo).toHaveBeenCalledTimes(1);
    expect(Object.values(result).every(item => item.ok && item.messageId === 777)).toBe(true);
  });

  it('does not send to disabled channels', async () => {
    for (const category of Object.values(AlertCategory)) vi.stubEnv(`${category}_CHANNEL_ENABLED`, 'false');
    const result = await runChannelHealthCheck();
    expect(mocks.sendChannelAlertTo).not.toHaveBeenCalled();
    expect(Object.values(result).every(item => !item.ok && !item.enabled)).toBe(true);
  });

  it('a shared destination failure is checked once and reported for every category', async () => {
    mocks.sendChannelAlertTo.mockResolvedValue(undefined);
    const result = await runChannelHealthCheck();
    expect(mocks.sendChannelAlertTo).toHaveBeenCalledTimes(1);
    expect(Object.values(result).every(item => !item.ok && item.reason === 'send failed')).toBe(true);
  });
});

const originalSystemEnabled = process.env.SYSTEM_CHANNEL_ENABLED;
const originalSystemChannel = process.env.TELEGRAM_SYSTEM_CHANNEL_ID;
const originalAnalysisEnabled = process.env.ANALYSIS_CHANNEL_ENABLED;
const originalAnalysisChannel = process.env.TELEGRAM_ANALYSIS_CHANNEL_ID;
const originalChannelEnabled = process.env.CHANNEL_ENABLED;

beforeEach(() => {
  mocks.sendChannelAlertTo.mockClear();
  mocks.sendChannelAlertTo.mockResolvedValue(777);
  mocks.incrementChannelStat.mockClear();
  mocks.appendAlertHistory.mockClear();
  process.env.SYSTEM_CHANNEL_ENABLED = 'true';
  process.env.TELEGRAM_SYSTEM_CHANNEL_ID = '-100system';
  delete process.env.ANALYSIS_CHANNEL_ENABLED;
  delete process.env.TELEGRAM_ANALYSIS_CHANNEL_ID;
  delete process.env.CHANNEL_ENABLED;
});

afterEach(() => {
  if (originalSystemEnabled === undefined) delete process.env.SYSTEM_CHANNEL_ENABLED;
  else process.env.SYSTEM_CHANNEL_ENABLED = originalSystemEnabled;
  if (originalSystemChannel === undefined) delete process.env.TELEGRAM_SYSTEM_CHANNEL_ID;
  else process.env.TELEGRAM_SYSTEM_CHANNEL_ID = originalSystemChannel;
  if (originalAnalysisEnabled === undefined) delete process.env.ANALYSIS_CHANNEL_ENABLED;
  else process.env.ANALYSIS_CHANNEL_ENABLED = originalAnalysisEnabled;
  if (originalAnalysisChannel === undefined) delete process.env.TELEGRAM_ANALYSIS_CHANNEL_ID;
  else process.env.TELEGRAM_ANALYSIS_CHANNEL_ID = originalAnalysisChannel;
  if (originalChannelEnabled === undefined) delete process.env.CHANNEL_ENABLED;
  else process.env.CHANNEL_ENABLED = originalChannelEnabled;
});

describe('alertRouter JOURNAL delivery policy ADR-0466', () => {
  it('does not force non-critical SYSTEM alerts into weekly buffer', async () => {
    await dispatchAlert(AlertCategory.SYSTEM, 'daily learning journal', {
      severity: 'NORMAL',
      dedupeKey: 'journal-default',
    });

    // 출력 드리프트 정정: SYSTEM(CH4 JOURNAL) 카테고리는 decorateMessage 에서 '📒 ' 접두어를
    // 무조건 부여한다(alertRouter.ts case SYSTEM, L220 문서화된 정책). 본 테스트의 의도는
    // non-critical SYSTEM 알림이 weekly buffer 가 아니라 *즉시 전송* 됨을 검증하는 것이며,
    // 접두어는 채널 데코레이션일 뿐 — 기대 메시지에 📒 접두어를 반영한다.
    expect(mocks.sendChannelAlertTo).toHaveBeenCalledWith('-100system', '📒 daily learning journal', {
      disableNotification: true,
    });
    expect(getChannelFlushStatus().systemWeeklyBufferLength).toBe(0);
  });

  it('buffers SYSTEM alerts only when weekly_digest is explicitly requested', async () => {
    await dispatchAlert(AlertCategory.SYSTEM, 'weekly journal item', {
      severity: 'LOW',
      dedupeKey: 'journal-weekly',
      delivery: 'weekly_digest',
    });

    expect(mocks.sendChannelAlertTo).not.toHaveBeenCalled();
    expect(getChannelFlushStatus().systemWeeklyBufferLength).toBeGreaterThanOrEqual(1);
    expect(mocks.incrementChannelStat).toHaveBeenCalledWith(AlertCategory.SYSTEM, 'buffered', {
      eventType: 'journal-weekly',
    });
  });

  it('adds public responsibility disclaimer to ANALYSIS channel messages', async () => {
    process.env.ANALYSIS_CHANNEL_ENABLED = 'true';
    process.env.TELEGRAM_ANALYSIS_CHANNEL_ID = '-100analysis';

    await dispatchAlert(AlertCategory.ANALYSIS, 'BUY candidate reference', {
      severity: 'NORMAL',
      dedupeKey: 'analysis-disclaimer',
    });

    expect(mocks.sendChannelAlertTo).toHaveBeenCalledWith(
      '-100analysis',
      expect.stringContaining('※ 투자 판단은 각자 책임입니다.'),
      { disableNotification: true },
    );
  });
});
