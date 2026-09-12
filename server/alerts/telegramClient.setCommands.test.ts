// @responsibility setTelegramBotCommands loads command barrels before building Telegram autocomplete payload.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./alertAuditLog.js', () => ({ appendAlertAudit: vi.fn() }));
vi.mock('../persistence/alertsFeedRepo.js', () => ({ appendAlertFeed: vi.fn() }));
vi.mock('./unifiedBriefing.js', () => ({
  captureToUnifiedBriefing: () => false,
  isUnifiedBriefingActive: () => false,
  shouldBypassCapture: () => false,
}));

vi.mock('../telegram/commands/system/index.js', () => ({}));
vi.mock('../telegram/commands/watchlist/index.js', () => ({}));
vi.mock('../telegram/commands/positions/index.js', () => ({}));
vi.mock('../telegram/commands/alert/index.js', () => ({}));
vi.mock('../telegram/commands/control/index.js', () => ({}));
vi.mock('../telegram/commands/trade/index.js', () => ({}));
vi.mock('../telegram/commands/infra/index.js', () => ({}));
vi.mock('../telegram/commands/shadow/index.js', () => ({}));
vi.mock('../telegram/commands/learning/index.js', async () => {
  const { commandRegistry } = await import('../telegram/commandRegistry.js');
  commandRegistry.register({
    name: '/learning_weights_reset',
    category: 'LRN',
    visibility: 'ADMIN',
    riskLevel: 1,
    showInMenu: true,
    menuPriority: 0,
    description: 'Reset learned condition weights to defaults',
    async execute() {
      /* no-op */
    },
  });
  return {};
});

describe('Telegram delivery confirmation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function setup() {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('TELEGRAM_CHAT_ID', '123');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('failed private delivery does not consume the retry cooldown', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'blocked' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { message_id: 41 } }) });
    const { sendTelegramAlert } = await import('./telegramClient.js');
    const opts = { dedupeKey: 'retry-delivery', cooldownMs: 60_000, requireAck: false };
    expect(await sendTelegramAlert('connection check', opts)).toBeUndefined();
    expect(await sendTelegramAlert('connection check', opts)).toBe(41);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('plain test requires a returned message ID and bounds the request', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { message_id: 42 } }) });
    const { sendTelegramPlainText } = await import('./telegramClient.js');
    expect(await sendTelegramPlainText('test')).toBeUndefined();
    expect(await sendTelegramPlainText('test')).toBe(42);
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '123', text: 'test' });
  });

  it('a failed chunk is not reported as a complete plain-text delivery', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { message_id: 43 } }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'blocked' });
    const { sendTelegramPlainText } = await import('./telegramClient.js');
    expect(await sendTelegramPlainText('a'.repeat(4096) + '\nsecond chunk')).toBeUndefined();
  });
});

describe('setTelegramBotCommands autocomplete payload', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('includes /learning_weights_reset even when no command barrel was preloaded', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { commandRegistry } = await import('../telegram/commandRegistry.js');
    commandRegistry.__resetForTests();
    const { setTelegramBotCommands } = await import('./telegramClient.js');

    await setTelegramBotCommands();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      commands?: Array<{ command: string }>;
    };
    expect(body.commands?.some((cmd) => cmd.command === 'learning_weights_reset')).toBe(true);
  }, 20000);
});
