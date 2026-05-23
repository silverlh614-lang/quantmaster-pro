// @responsibility Telegram command/callback backward compatibility hotfix regression tests.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandReplyFn, TelegramCommand } from './commands/_types.js';

const COLD_IMPORT_TIMEOUT_MS = 15_000;

function makeCommand(name: string, calls: string[]): TelegramCommand {
  return {
    name,
    category: name === '/pnl' ? 'POS' : 'SYS',
    visibility: 'ADMIN',
    riskLevel: 0,
    description: `stub ${name}`,
    async execute() {
      calls.push(name);
    },
  };
}

async function loadRouters(options: { includeCallbackRouter?: boolean } = {}) {
  vi.resetModules();
  const calls: string[] = [];
  const handlers = new Map<string, TelegramCommand>([
    ['/pos', makeCommand('/pos', calls)],
    ['/pnl', makeCommand('/pnl', calls)],
    ['/status', makeCommand('/status', calls)],
    ['/scan', makeCommand('/scan', calls)],
    ['/scan_blockers', makeCommand('/scan_blockers', calls)],
  ]);

  vi.doMock('./commandRegistry.js', () => ({
    commandRegistry: {
      resolve: (name: string) => handlers.get(name),
      all: () => Array.from(handlers.values()),
      keys: () => Array.from(handlers.keys()),
      register: (cmd: TelegramCommand) => handlers.set(cmd.name, cmd),
    },
  }));
  vi.doMock('../persistence/commandUsageRepo.js', () => ({
    recordUsage: vi.fn(),
    getTopUsage: vi.fn(() => [
      { name: '/pos', count: 3, lastUsedAt: '2026-05-18T00:00:00.000Z' },
      { name: '/pnl', count: 2, lastUsedAt: '2026-05-18T00:00:00.000Z' },
    ]),
  }));

  const commandRouter = await import('./commandRouter.js');
  const callbackRouter = options.includeCallbackRouter
    ? await import('./callbackRouter.js')
    : undefined;
  return { commandRouter, callbackRouter, calls };
}

describe('Telegram command hotfix normalization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizeCommand("/PNL") == "/pnl"', async () => {
    const { commandRouter } = await loadRouters();
    expect(commandRouter.normalizeCommand('/PNL')).toBe('/pnl');
  }, COLD_IMPORT_TIMEOUT_MS);

  it('normalizeCommand("/pos@Quantmaster_Bot") == "/pos"', async () => {
    const { commandRouter } = await loadRouters();
    expect(commandRouter.normalizeCommand('/pos@Quantmaster_Bot')).toBe('/pos');
  });

  it('parseTelegramCommand separates payload args after whitespace normalization', async () => {
    const { commandRouter } = await loadRouters();
    expect(commandRouter.parseTelegramCommand(' /pos   005930  000660 ')).toEqual({
      raw: ' /pos   005930  000660 ',
      normalized: '/pos',
      args: ['005930', '000660'],
    });
  });
});

describe('Telegram command hotfix commandRouter dispatch', () => {
  it('commandRouter.dispatch("/pos") calls PositionSummaryService equivalent /pos handler', async () => {
    const { commandRouter, calls } = await loadRouters();
    await commandRouter.dispatchTelegramCommand({ rawText: '/pos', chatId: '1', userId: '2', reply: vi.fn() });
    expect(calls).toEqual(['/pos']);
  });

  it('emits P0 command routing aliases for Railway log verification', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { commandRouter, calls } = await loadRouters();

    await commandRouter.dispatchTelegramCommand({ rawText: '/pos', chatId: '1', userId: '2', reply: vi.fn() });

    expect(calls).toEqual(['/pos']);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('[TELEGRAM_UPDATE_RECEIVED]'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('[COMMAND_NORMALIZED]'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('[COMMAND_ROUTED]'));
  });

  it('commandRouter.dispatch("/positions") calls PositionSummaryService equivalent /pos handler', async () => {
    const { commandRouter, calls } = await loadRouters();
    await commandRouter.dispatchTelegramCommand({ rawText: '/positions', chatId: '1', userId: '2', reply: vi.fn() });
    expect(calls).toEqual(['/pos']);
  });

  it('commandRouter.dispatch("/pnl") calls PnlSummaryService equivalent /pnl handler', async () => {
    const { commandRouter, calls } = await loadRouters();
    await commandRouter.dispatchTelegramCommand({ rawText: '/pnl', chatId: '1', userId: '2', reply: vi.fn() });
    expect(calls).toEqual(['/pnl']);
  });

  it('/help call does not block later /pos and /pnl dispatch', async () => {
    const { commandRouter, calls } = await loadRouters();
    const reply = vi.fn<CommandReplyFn>(async () => undefined);
    await commandRouter.dispatchTelegramCommand({ rawText: '/help', chatId: '1', userId: '2', reply });
    await commandRouter.dispatchTelegramCommand({ rawText: '/pos', chatId: '1', userId: '2', reply });
    await commandRouter.dispatchTelegramCommand({ rawText: '/pnl', chatId: '1', userId: '2', reply });
    expect(calls).toEqual(['/pos', '/pnl']);
  });
});

describe('Telegram command hotfix callbackRouter dispatch', () => {
  it('callbackRouter.dispatch("BTN_POSITION") calls PositionSummaryService equivalent /pos handler', async () => {
    const { callbackRouter, calls } = await loadRouters({ includeCallbackRouter: true });
    if (!callbackRouter) throw new Error('callbackRouter was not loaded');
    await callbackRouter.dispatchTelegramCallback({ data: 'BTN_POSITION', reply: vi.fn() });
    expect(calls).toEqual(['/pos']);
  });

  it('callbackRouter.dispatch("BTN_PNL") calls PnlSummaryService equivalent /pnl handler', async () => {
    const { callbackRouter, calls } = await loadRouters({ includeCallbackRouter: true });
    if (!callbackRouter) throw new Error('callbackRouter was not loaded');
    await callbackRouter.dispatchTelegramCallback({ data: 'BTN_PNL', reply: vi.fn() });
    expect(calls).toEqual(['/pnl']);
  });
});

describe('Telegram command hotfix help visibility split', () => {
  it('general /help does not expose 자주 쓰는 명령 Top 5', async () => {
    const { commandRouter } = await loadRouters();
    const reply = vi.fn<CommandReplyFn>(async () => undefined);
    await commandRouter.dispatchTelegramCommand({ rawText: '/help', chatId: '1', userId: '2', reply });
    expect(reply.mock.calls[0][0]).not.toContain('자주 쓰는 명령 Top 5');
  });

  it('/admin_help exposes administrator command usage stats', async () => {
    const { commandRouter } = await loadRouters();
    const reply = vi.fn<CommandReplyFn>(async () => undefined);
    await commandRouter.dispatchTelegramCommand({ rawText: '/admin_help', chatId: '1', userId: '2', reply });
    expect(reply.mock.calls[0][0]).toContain('자주 쓰는 명령 Top');
    expect(reply.mock.calls[0][0]).toContain('command usage stats');
  });
});
