// @responsibility Read-only Telegram command diagnostics for routing, identity, position source counts.
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { aggregatePositionSources } from '../positions/shadowPositionSources.js';

function boolText(value: boolean): string {
  return value ? 'true' : 'false';
}

function normalizeDebugCommand(input: string): string {
  const compact = input.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!compact) return '';
  const [first = ''] = compact.split(' ');
  return first.replace(/^\/([^@\s]+)@[a-z0-9_]+$/, '/$1');
}

function canonicalizeDebugCommand(command: string): string {
  if (command === '/positions' || command === 'pos') return '/pos';
  if (command === 'pnl') return '/pnl';
  if (command === '/start') return '/help';
  return command;
}

const BUILTIN_COMMANDS = new Set(['/help', '/admin_help', '/now', '/now_debug', '/watch', '/learning', '/control', '/admin']);

const ping: TelegramCommand = {
  name: '/ping',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Telegram inbound/outbound ping 진단',
  async execute({ reply, correlationId }) {
    const message = ['pong ✅', `botTime=${new Date().toISOString()}`, `correlationId=${correlationId ?? 'N/A'}`].join('\n');
    console.info(`[RESPONSE_FORMATTED] correlationId=${correlationId ?? 'N/A'} command=/ping bytes=${message.length}`);
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/ping`);
  },
};

const whoami: TelegramCommand = {
  name: '/whoami',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Telegram chat/user 권한 범위 진단',
  async execute({ reply, correlationId, chatId, userId }) {
    const allowedChatIds = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? process.env.TELEGRAM_CHAT_ID ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const authorized = allowedChatIds.length === 0 || (chatId !== undefined && allowedChatIds.includes(chatId));
    const message = [
      `chatId=${chatId ?? 'N/A'}`,
      `userId=${userId ?? 'N/A'}`,
      `authorized=${boolText(authorized)}`,
      'commandScope=read-only diagnostics',
      `correlationId=${correlationId ?? 'N/A'}`,
    ].join('\n');
    console.info(`[RESPONSE_FORMATTED] correlationId=${correlationId ?? 'N/A'} command=/whoami bytes=${message.length}`);
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/whoami`);
  },
};

const debugCommand: TelegramCommand = {
  name: '/debug_command',
  aliases: ['/debug'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '특정 Telegram command 라우팅 handler 진단',
  usage: '/debug_command /pos',
  async execute({ args, reply, correlationId }) {
    const raw = args[0] ?? '';
    const normalized = normalizeDebugCommand(raw);
    const aliasResolved = canonicalizeDebugCommand(normalized);
    const handler = commandRegistry.resolve(aliasResolved);
    const action = handler ? 'REGISTRY_COMMAND' : BUILTIN_COMMANDS.has(aliasResolved) ? 'META_MENU' : undefined;
    const message = [
      `raw=${raw || 'N/A'}`,
      `normalized=${normalized || 'N/A'}`,
      `aliasResolved=${aliasResolved || 'N/A'}`,
      `handler=${handler?.name ?? action ?? 'NO_HANDLER'}`,
      `registered=${boolText(Boolean(handler) || Boolean(action))}`,
      `correlationId=${correlationId ?? 'N/A'}`,
    ].join('\n');
    console.info(`[SOURCE_QUERY_RESULT] correlationId=${correlationId ?? 'N/A'} command=/debug_command raw=${raw} normalized=${normalized} aliasResolved=${aliasResolved} registered=${Boolean(handler) || Boolean(action)}`);
    console.info(`[RESPONSE_FORMATTED] correlationId=${correlationId ?? 'N/A'} command=/debug_command bytes=${message.length}`);
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/debug_command`);
  },
};

export async function buildDebugPositionsMessage(correlationId = 'N/A'): Promise<string> {
  const snapshot = await aggregatePositionSources();
  return [
    `ShadowPositionRegistry=${snapshot.counts.shadowRegistryCount}`,
    `ShadowPositionLedger=${snapshot.counts.shadowLedgerCount}`,
    `ShadowTradeRepo=${snapshot.counts.shadowTradeOpenCount}`,
    `VirtualAccount=${snapshot.counts.virtualHoldingCount}`,
    `PaperTradeLedger=${snapshot.counts.paperOpenCount}`,
    `KISLiveHolding=${snapshot.counts.kisLiveCount}`,
    `finalDisplayed=${snapshot.counts.totalCount}`,
    `correlationId=${correlationId}`,
  ].join('\n');
}

const debugPositions: TelegramCommand = {
  name: '/debug_positions',
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '포지션 source별 count read-only 진단',
  async execute({ reply, correlationId }) {
    console.info(`[PORTFOLIO_QUERY_STARTED] correlationId=${correlationId ?? 'N/A'} command=/debug_positions`);
    const message = await buildDebugPositionsMessage(correlationId ?? 'N/A');
    console.info(`[SOURCE_QUERY_RESULT] correlationId=${correlationId ?? 'N/A'} command=/debug_positions ${message.replace(/\n/g, ' ')}`);
    console.info(`[RESPONSE_FORMATTED] correlationId=${correlationId ?? 'N/A'} command=/debug_positions bytes=${message.length}`);
    await reply(message);
    console.info(`[TELEGRAM_REPLY_SENT] correlationId=${correlationId ?? 'N/A'} command=/debug_positions`);
  },
};

for (const cmd of [ping, whoami, debugCommand, debugPositions]) {
  if (!commandRegistry.resolve(cmd.name)) commandRegistry.register(cmd);
}

export { ping, whoami, debugCommand, debugPositions };
