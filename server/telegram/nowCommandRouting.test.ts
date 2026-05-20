import { beforeEach, describe, expect, it, vi } from 'vitest';

const metaMocks = vi.hoisted(() => ({
  handleMetaCommand: vi.fn(async () => undefined),
}));

vi.mock('./metaCommands.js', () => ({
  buildAdminHelpMessage: vi.fn(() => 'admin help'),
  buildHelpKeyboard: vi.fn(() => ({ inline_keyboard: [] })),
  buildHelpMessage: vi.fn(() => 'help'),
  handleMetaCommand: metaMocks.handleMetaCommand,
}));

vi.mock('./commandRegistry.js', () => ({
  commandRegistry: {
    resolve: (name: string) => (name === '/now' || name === '/now_debug' ? { name } : undefined),
    all: () => [],
    keys: () => [],
    register: vi.fn(),
  },
}));

vi.mock('../persistence/commandUsageRepo.js', () => ({
  getTopUsage: vi.fn(() => []),
  recordUsage: vi.fn(),
}));

import {
  canonicalizeCommand,
  dispatchTelegramCommand,
  normalizeCommand,
  resolveCommandAction,
} from './commandRouter.js';

describe('NOW command routing', () => {
  beforeEach(() => {
    metaMocks.handleMetaCommand.mockClear();
  });

  it('routes /now_debug as MARKET_NOW debug mode', async () => {
    const reply = vi.fn(async () => undefined);

    await dispatchTelegramCommand({ rawText: '/now_debug', chatId: '1', userId: '2', reply });

    expect(canonicalizeCommand('/now_debug')).toBe('/now_debug');
    expect(resolveCommandAction('/now_debug')).toBe('MARKET_NOW');
    expect(metaMocks.handleMetaCommand).toHaveBeenCalledWith(
      '/now_debug',
      reply,
      { nowRenderOptions: { mode: 'DEBUG', includeRaw: true } },
    );
  });

  it('routes /now as MARKET_NOW compact mode', async () => {
    const reply = vi.fn(async () => undefined);

    await dispatchTelegramCommand({ rawText: '/now', chatId: '1', userId: '2', reply });

    expect(metaMocks.handleMetaCommand).toHaveBeenCalledWith(
      '/now',
      reply,
      { nowRenderOptions: { mode: 'COMPACT', includeRaw: false } },
    );
  });

  it('routes /now --debug to NOW debug mode without changing the canonical command', async () => {
    const reply = vi.fn(async () => undefined);

    await dispatchTelegramCommand({ rawText: '/now --debug', chatId: '1', userId: '2', reply });

    expect(metaMocks.handleMetaCommand).toHaveBeenCalledWith(
      '/now',
      reply,
      { nowRenderOptions: { mode: 'DEBUG', includeRaw: true } },
    );
  });

  it('routes /now debug to NOW debug mode', async () => {
    const reply = vi.fn(async () => undefined);

    await dispatchTelegramCommand({ rawText: '/now debug', chatId: '1', userId: '2', reply });

    expect(metaMocks.handleMetaCommand).toHaveBeenCalledWith(
      '/now',
      reply,
      { nowRenderOptions: { mode: 'DEBUG', includeRaw: true } },
    );
  });

  it('keeps now_debug intact during command normalization', () => {
    expect(normalizeCommand('/NOW_DEBUG')).toBe('/now_debug');
    expect(canonicalizeCommand('now_debug')).toBe('/now_debug');
    expect(canonicalizeCommand('now')).toBe('/now');
  });
});
