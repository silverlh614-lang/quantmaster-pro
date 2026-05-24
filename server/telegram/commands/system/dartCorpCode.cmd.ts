// @responsibility DART corpCode master cache refresh/status Telegram commands.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  getDartCorpCodeCacheStatus,
  refreshDartCorpCodeMasterCache,
} from '../../../trading/gate2/dartCorpCodeMasterCache.js';

function cleanSymbol(value: unknown): string | null {
  const symbol = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 6);
  return symbol.length > 0 ? symbol.padStart(6, '0') : null;
}

function parseSymbols(args: readonly string[]): string[] {
  return [...new Set(args
    .join(' ')
    .split(/[,\s]+/)
    .map(cleanSymbol)
    .filter((symbol): symbol is string => Boolean(symbol)))];
}

function formatStatus(input: ReturnType<typeof getDartCorpCodeCacheStatus>): string[] {
  return [
    `corpCodeCacheLoaded=${input.corpCodeCacheLoaded}`,
    `corpCodeCacheCount=${input.corpCodeCacheCount}`,
    `listedStockCodeCount=${input.listedStockCodeCount}`,
    `loadedAt=${input.loadedAt ?? 'NONE'}`,
    `ttlExpiresAt=${input.ttlExpiresAt ?? 'NONE'}`,
    `ttlHours=${input.ttlHours}`,
    `expired=${input.expired}`,
    `source=${input.source}`,
    `lastHttpStatus=${input.lastHttpStatus ?? 'NONE'}`,
    `lastError=${input.lastError ?? 'NONE'}`,
    `sampleMappings=${input.sampleMappings.length > 0 ? input.sampleMappings.join('|') : 'NONE'}`,
    `missingSampleSymbols=${input.missingSampleSymbols.length > 0 ? input.missingSampleSymbols.join(',') : 'NONE'}`,
    'executionImpact=NONE',
  ];
}

const dartCorpCodeStatus: TelegramCommand = {
  name: '/dart_corpcode_status',
  aliases: ['/dart_corp_status', '/corpcode_status'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Read-only DART stock_code to corp_code master cache status',
  usage: '/dart_corpcode_status [symbol ...]',
  async execute({ args, reply }) {
    const status = getDartCorpCodeCacheStatus({ sampleSymbols: parseSymbols(args) });
    await reply([
      '[dart_corpcode_status] DART CorpCode Master Cache',
      ...formatStatus(status),
      'note: status only; no provider fetch, no scan execution, no broker order, no live promotion.',
    ].join('\n'));
  },
};

const dartCorpCodeRefresh: TelegramCommand = {
  name: '/dart_corpcode_refresh',
  aliases: ['/dart_corp_refresh', '/refresh_dart_corpcode'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'Refresh DART corpCode.xml master cache without scan or live promotion impact',
  usage: '/dart_corpcode_refresh [sample symbol ...]',
  async execute({ args, reply }) {
    const sampleSymbols = parseSymbols(args);
    await reply('[dart_corpcode_refresh] starting mode=OBSERVE executionImpact=NONE');
    const result = await refreshDartCorpCodeMasterCache();
    const status = getDartCorpCodeCacheStatus({ sampleSymbols });
    await reply([
      '[dart_corpcode_refresh] completed',
      `downloaded=${result.downloaded}`,
      `parseStatus=${result.parseStatus}`,
      `refreshed=${result.refreshed}`,
      `reason=${result.reason}`,
      `cacheFile=${result.cacheFile}`,
      ...formatStatus(status),
      'note: provider master refresh only; no scan execution, no broker order, no live promotion.',
    ].join('\n'));
  },
};

commandRegistry.register(dartCorpCodeStatus);
commandRegistry.register(dartCorpCodeRefresh);

export { dartCorpCodeRefresh, dartCorpCodeStatus };
export default dartCorpCodeStatus;
