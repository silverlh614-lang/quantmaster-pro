// @responsibility setTelegramBotCommands loads command barrels before building Telegram autocomplete payload.
import { afterEach, describe, expect, it, vi } from 'vitest';

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
