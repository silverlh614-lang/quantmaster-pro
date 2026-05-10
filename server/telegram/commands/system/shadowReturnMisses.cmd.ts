import { loadShadowReturnMissDetails } from '../../../learning/shadowFutureReturnMissDiagnostics.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function parseLimit(args: string[]): number {
  const raw = args[0];
  if (!raw) return 10;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(30, n));
}

function formatRows(limit: number): string {
  const rows = loadShadowReturnMissDetails(limit);
  const lines = [
    '🧪 <b>Shadow Return Misses</b>',
    `• count: ${rows.length}`,
  ];
  rows.forEach((row, idx) => {
    lines.push('', `<b>${idx + 1}) ${row.symbol} / ${row.horizon}</b>`);
    lines.push(`• signalDate: ${row.signalDate.slice(0, 10)}`);
    lines.push(`• targetDate: ${row.targetDate}`);
    lines.push(`• reason: ${row.reason}`);
    if (row.existingKeys.length > 0) {
      lines.push(`• existingKeys: ${row.existingKeys.slice(0, 4).join(', ')}`);
    } else {
      lines.push(`• existingKeys: none`);
    }
    if (row.pointCounts.length > 0) {
      lines.push(`• pointCounts: ${row.pointCounts.slice(0, 4).join(', ')}`);
    }
    lines.push(`• checked: ${row.keysChecked.slice(0, 4).join(', ')}`);
  });
  lines.push('', '<i>read-only miss diagnostics only.</i>');
  return lines.join('\n');
}

const shadowReturnMisses: TelegramCommand = {
  name: '/shadow_return_misses',
  aliases: ['/shadow_misses_returns', '/shadow_return_missing'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Show mature Shadow futureReturn cache misses.',
  usage: '/shadow_return_misses [limit=10]',
  async execute({ args, reply }) {
    await reply(formatRows(parseLimit(args)));
  },
};

commandRegistry.register(shadowReturnMisses);

export default shadowReturnMisses;
