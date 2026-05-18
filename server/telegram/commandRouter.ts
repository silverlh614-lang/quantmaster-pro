// @responsibility commandRouter 텔레그램 모듈
// @responsibility: 텍스트 명령어 정규화·alias 라우팅·실행 로그 SSOT. 버튼 callback 라우터와 entry point 를 분리한다.

import { commandRegistry } from './commandRegistry.js';
import {
  buildAdminHelpMessage,
  buildHelpKeyboard,
  buildHelpMessage,
  handleMetaCommand,
  type InlineKeyboardMarkup,
} from './metaCommands.js';
import { getTopUsage, recordUsage } from '../persistence/commandUsageRepo.js';
import type { TelegramCommand } from './commands/_types.js';


let commandRegistryLoaded = false;
async function ensureCommandRegistryLoaded(): Promise<void> {
  if (commandRegistryLoaded) return;
  await Promise.all([
    import('./commands/system/index.js'),
    import('./commands/watchlist/index.js'),
    import('./commands/positions/index.js'),
    import('./commands/alert/index.js'),
    import('./commands/learning/index.js'),
    import('./commands/control/index.js'),
    import('./commands/trade/index.js'),
    import('./commands/infra/index.js'),
    import('./commands/shadow/index.js'),
  ]);
  commandRegistryLoaded = true;
}

export type TelegramCommandAction =
  | 'POSITION_SUMMARY'
  | 'PNL_SUMMARY'
  | 'HELP_MENU'
  | 'ADMIN_HELP'
  | 'SYSTEM_STATUS'
  | 'MARKET_NOW'
  | 'WATCHLIST_MENU'
  | 'SCAN'
  | 'SCAN_BLOCKERS'
  | 'REGISTRY_COMMAND'
  | 'META_MENU';

export interface NormalizedTelegramCommand {
  raw: string;
  normalized: string;
  args: string[];
}

export interface CommandDispatchContext {
  rawText: string;
  chatId: string;
  userId?: string;
  reply: (message: string, replyMarkup?: InlineKeyboardMarkup) => Promise<void>;
}

export function createTelegramCorrelationId(chatId: string, command: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const shortRandom = Math.random().toString(36).slice(2, 6);
  return `telegram:${chatId}:${command || 'unknown'}:${stamp}:${shortRandom}`;
}

function logCommandChain(event: string, fields: Record<string, unknown>): void {
  const body = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  console.info(`[${event}] ${body}`);
}

const COMMAND_ALIASES = new Map<string, string>([
  ['/pos', '/pos'],
  ['/positions', '/pos'],
  ['pos', '/pos'],
  ['/pnl', '/pnl'],
  ['pnl', '/pnl'],
  ['/help', '/help'],
  ['/start', '/help'],
  ['/admin_help', '/admin_help'],
  ['/admin_stats', '/admin_help'],
  ['/status', '/status'],
  ['/now', '/now'],
  ['/watch', '/watch'],
  ['/scan', '/scan'],
  ['/scan_blockers', '/scan_blockers'],
]);

const ACTION_BY_CANONICAL = new Map<string, TelegramCommandAction>([
  ['/pos', 'POSITION_SUMMARY'],
  ['/pnl', 'PNL_SUMMARY'],
  ['/help', 'HELP_MENU'],
  ['/admin_help', 'ADMIN_HELP'],
  ['/status', 'SYSTEM_STATUS'],
  ['/now', 'MARKET_NOW'],
  ['/watch', 'WATCHLIST_MENU'],
  ['/scan', 'SCAN'],
  ['/scan_blockers', 'SCAN_BLOCKERS'],
]);

/**
 * Telegram text 첫 토큰을 실행 가능한 command key 로 정규화한다.
 * - trim + lowercase
 * - bot mention 제거: /pos@Quantmaster_Bot -> /pos
 * - 연속 공백 축약 후 첫 토큰만 command 로 반환
 */
export function normalizeCommand(input: string): string {
  const compact = input.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!compact) return '';
  const [first = ''] = compact.split(' ');
  return first.replace(/^\/([^@\s]+)@[a-z0-9_]+$/, '/$1');
}

/** payload 포함 text 를 command + args 로 분리한다. */
export function parseTelegramCommand(input: string): NormalizedTelegramCommand {
  const compact = input.trim().replace(/\s+/g, ' ');
  if (!compact) return { raw: input, normalized: '', args: [] };
  const [rawFirst = '', ...args] = compact.split(' ');
  return {
    raw: input,
    normalized: normalizeCommand(rawFirst),
    args,
  };
}

export function canonicalizeCommand(command: string): string {
  return COMMAND_ALIASES.get(command) ?? command;
}

export function resolveCommandAction(command: string, handler?: TelegramCommand): TelegramCommandAction | undefined {
  const canonical = canonicalizeCommand(command);
  return ACTION_BY_CANONICAL.get(canonical) ?? (handler ? 'REGISTRY_COMMAND' : undefined);
}

export async function dispatchTelegramCommand(ctx: CommandDispatchContext): Promise<boolean> {
  const startedAt = Date.now();
  const parsed = parseTelegramCommand(ctx.rawText);
  const canonical = canonicalizeCommand(parsed.normalized);
  const correlationId = createTelegramCorrelationId(ctx.chatId, canonical);

  logCommandChain('TELEGRAM_UPDATE_RECEIVED', { correlationId, raw: ctx.rawText, chatId: ctx.chatId, userId: ctx.userId ?? '' });
  logCommandChain('COMMAND_NORMALIZED', { correlationId, rawCommand: parsed.normalized, normalized: canonical, args: parsed.args.length });

  if (!commandRegistry.resolve(canonical)) {
    await ensureCommandRegistryLoaded();
  }
  const route = await resolveRoute(canonical, ctx.reply);
  if (!route) {
    console.warn(`[TELEGRAM_COMMAND_UNHANDLED] correlationId=${correlationId} raw=${JSON.stringify(ctx.rawText)} normalized=${JSON.stringify(parsed.normalized)} reason=NO_HANDLER`);
    await ctx.reply('알 수 없는 명령입니다. 아래 메뉴에서 선택하세요.', buildHelpKeyboard());
    return false;
  }

  logCommandChain('COMMAND_ROUTED', { correlationId, command: canonical, action: route.action, handler: route.handlerName });

  try {
    logCommandChain('SERVICE_CALLED', { correlationId, command: canonical, handler: route.handlerName });
    await route.execute(parsed.args, correlationId, ctx);
    recordUsage(route.usageName);
    console.info(
      `[TELEGRAM_COMMAND_RESULT] correlationId=${correlationId} command=${JSON.stringify(canonical)} ` +
      `success=true elapsedMs=${Date.now() - startedAt}`,
    );
    return true;
  } catch (e) {
    console.error(
      `[TELEGRAM_COMMAND_RESULT] correlationId=${correlationId} command=${JSON.stringify(canonical)} ` +
      `success=false elapsedMs=${Date.now() - startedAt}`,
      e,
    );
    throw e;
  }
}

async function resolveRoute(
  canonical: string,
  reply: CommandDispatchContext['reply'],
): Promise<{
  action: TelegramCommandAction;
  handlerName: string;
  usageName: string;
  execute: (args: string[], correlationId: string, dispatchContext: CommandDispatchContext) => Promise<void>;
} | null> {
  if (canonical === '/help') {
    return {
      action: 'HELP_MENU',
      handlerName: 'buildHelpMessage',
      usageName: '/help',
      execute: async (_args, correlationId) => { const msg = buildHelpMessage(); logCommandChain('RESPONSE_FORMATTED', { correlationId, command: '/help', bytes: msg.length }); await reply(msg, buildHelpKeyboard()); logCommandChain('TELEGRAM_REPLY_SENT', { correlationId, command: '/help' }); },
    };
  }

  if (canonical === '/admin_help') {
    return {
      action: 'ADMIN_HELP',
      handlerName: 'buildAdminHelpMessage',
      usageName: '/admin_help',
      execute: async (_args, correlationId) => { const msg = buildAdminHelpMessage(getTopUsage(5)); logCommandChain('RESPONSE_FORMATTED', { correlationId, command: '/admin_help', bytes: msg.length }); await reply(msg); logCommandChain('TELEGRAM_REPLY_SENT', { correlationId, command: '/admin_help' }); },
    };
  }

  if (canonical === '/now' || canonical === '/watch') {
    return {
      action: ACTION_BY_CANONICAL.get(canonical) ?? 'META_MENU',
      handlerName: 'handleMetaCommand',
      usageName: canonical,
      execute: async (_args, correlationId) => { logCommandChain('SERVICE_CALLED', { correlationId, command: canonical, service: 'handleMetaCommand' }); await handleMetaCommand(canonical, reply); logCommandChain('TELEGRAM_REPLY_SENT', { correlationId, command: canonical }); },
    };
  }

  const handler = commandRegistry.resolve(canonical);
  if (handler) {
    return {
      action: ACTION_BY_CANONICAL.get(canonical) ?? 'REGISTRY_COMMAND',
      handlerName: handler.name,
      usageName: handler.name,
      execute: async (args, correlationId, dispatchContext) => handler.execute({ args, reply, correlationId, chatId: dispatchContext.chatId, userId: dispatchContext.userId, command: canonical }),
    };
  }

  // 기존 메타 메뉴 backward compatibility (/learning /control /admin)는 registry 밖에서 유지한다.
  if (canonical === '/learning' || canonical === '/control' || canonical === '/admin') {
    return {
      action: 'META_MENU',
      handlerName: 'handleMetaCommand',
      usageName: canonical,
      execute: async (_args, correlationId) => { logCommandChain('SERVICE_CALLED', { correlationId, command: canonical, service: 'handleMetaCommand' }); await handleMetaCommand(canonical, reply); logCommandChain('TELEGRAM_REPLY_SENT', { correlationId, command: canonical }); },
    };
  }

  return null;
}
