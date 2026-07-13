// @responsibility channelRoutes.cmd — read-only Telegram channel routing summary.
// @responsibility: /channel_routes — AlertCategory/ChannelSemantic/env route 상태를 모바일 한 화면에 표시.

import { AlertCategory, ChannelSemantic, isCategoryEnabled } from '../../../alerts/alertCategories.js';
import { getResolvedChannelMap, VIBRATION_POLICY } from '../../../alerts/alertRouter.js';
import { isDigestEnabled } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

type SemanticRow = {
  semantic: keyof typeof ChannelSemantic;
  category: AlertCategory;
  role: string;
  examples: string;
};

const SEMANTIC_ROWS: SemanticRow[] = [
  {
    semantic: 'EXECUTION',
    category: AlertCategory.TRADE,
    role: '체결/손절/비상/주문 계열',
    examples: 'fills, stop_loss, emergency, order_fail',
  },
  {
    semantic: 'SIGNAL',
    category: AlertCategory.ANALYSIS,
    role: '픽/스캔/후보/분석 계열',
    examples: 'scan_summary, watchlist, blocked_outcome',
  },
  {
    semantic: 'REGIME',
    category: AlertCategory.INFO,
    role: '레짐/매크로/정보 다이제스트',
    examples: 'macro, regime, info_digest',
  },
  {
    semantic: 'JOURNAL',
    category: AlertCategory.SYSTEM,
    role: '시스템/학습/복기/운영 로그',
    examples: 'health, ops_status, weekly_summary',
  },
];

function maskChannelId(channelId: string | undefined): string {
  if (!channelId) return 'missing';
  if (channelId.startsWith('@')) return channelId;
  if (channelId.length <= 8) return channelId;
  return `${channelId.slice(0, 4)}…${channelId.slice(-4)}`;
}

function enabledLabel(category: AlertCategory): string {
  return isCategoryEnabled(category) ? 'ON' : 'OFF';
}

function configuredLabel(channelId: string | undefined): string {
  return channelId ? 'configured' : 'missing';
}

function channelSourceHint(category: AlertCategory): string {
  switch (category) {
    case AlertCategory.TRADE:
      return process.env.TELEGRAM_TRADE_CHANNEL_ID ? 'TELEGRAM_TRADE_CHANNEL_ID' : 'fallback TELEGRAM_CHAT_ID';
    case AlertCategory.ANALYSIS:
      return process.env.TELEGRAM_ANALYSIS_CHANNEL_ID
        ? 'TELEGRAM_ANALYSIS_CHANNEL_ID'
        : process.env.TELEGRAM_PICK_CHANNEL_ID
          ? 'legacy TELEGRAM_PICK_CHANNEL_ID'
          : 'missing';
    case AlertCategory.INFO:
      return process.env.TELEGRAM_INFO_CHANNEL_ID ? 'TELEGRAM_INFO_CHANNEL_ID' : 'fallback TRADE';
    case AlertCategory.SYSTEM:
      return process.env.TELEGRAM_SYSTEM_CHANNEL_ID ? 'TELEGRAM_SYSTEM_CHANNEL_ID' : 'fallback TRADE';
    default:
      return 'unknown';
  }
}

function vibrationSummary(category: AlertCategory): string {
  const policy = VIBRATION_POLICY[category];
  return `C:${policy.CRITICAL ? 'vib' : 'silent'} H:${policy.HIGH ? 'vib' : 'silent'} N:${policy.NORMAL ? 'vib' : 'silent'} L:${policy.LOW ? 'vib' : 'silent'}`;
}

function compactVibration(category: AlertCategory): string {
  const policy = VIBRATION_POLICY[category];
  if (policy.CRITICAL && policy.HIGH && policy.NORMAL && policy.LOW) return 'vib all';
  if (!policy.CRITICAL && !policy.HIGH && !policy.NORMAL && !policy.LOW) return 'silent all';
  const on = [
    policy.CRITICAL ? 'C' : '',
    policy.HIGH ? 'H' : '',
    policy.NORMAL ? 'N' : '',
    policy.LOW ? 'L' : '',
  ].filter(Boolean).join(',');
  return on ? `vib ${on}` : 'silent all';
}

function formatChannelRoutesCompact(): string {
  const channelMap = getResolvedChannelMap();
  const lines = [
    '📡 <b>CHANNEL ROUTES</b>',
    '<i>read-only / no send</i>',
    '',
  ];

  for (const row of SEMANTIC_ROWS) {
    const channelId = channelMap[row.category];
    lines.push(
      `${row.category}: <b>${enabledLabel(row.category)}</b> / ${configuredLabel(channelId)} / ${compactVibration(row.category)}`,
    );
  }

  lines.push('');
  lines.push(`Digest: <b>${isDigestEnabled() ? 'ON' : 'OFF'}</b>`);
  lines.push(`CHANNEL_ENABLED: <b>${process.env.CHANNEL_ENABLED === 'true' ? 'true' : 'false'}</b>`);
  lines.push('');
  lines.push('상세: /channel_routes full');
  lines.push('테스트: /channel_health');
  return lines.join('\n');
}

function formatChannelRoutesFull(): string {
  const channelMap = getResolvedChannelMap();
  const lines = [
    '📡 <b>CHANNEL ROUTES FULL</b>',
    '<i>read-only routing summary — no test send</i>',
    '',
  ];

  for (const row of SEMANTIC_ROWS) {
    const channelId = channelMap[row.category];
    const configured = configuredLabel(channelId);
    lines.push(`<b>${row.semantic}</b> → ${row.category}`);
    lines.push(`• role: ${row.role}`);
    lines.push(`• enabled: <b>${enabledLabel(row.category)}</b> / ${configured}`);
    lines.push(`• target: <code>${maskChannelId(channelId)}</code>`);
    lines.push(`• source: ${channelSourceHint(row.category)}`);
    lines.push(`• vibration: ${vibrationSummary(row.category)}`);
    lines.push(`• examples: ${row.examples}`);
    lines.push('');
  }

  lines.push('<b>Digest</b>');
  lines.push(`• telegramClient T3 digest: <b>${isDigestEnabled() ? 'ON' : 'OFF'}</b>`);
  lines.push(`• CHANNEL_ENABLED: <b>${process.env.CHANNEL_ENABLED === 'true' ? 'true' : 'false'}</b>`);
  lines.push('');
  lines.push('<i>채널 전송 테스트는 /channel_health 또는 /channel_test 사용. 이 명령은 발송하지 않음.</i>');
  return lines.join('\n');
}

function formatChannelRoutes(args: string[] = []): string {
  const full = args.some((arg) => arg.toLowerCase() === 'full' || arg.toLowerCase() === '--full');
  return full ? formatChannelRoutesFull() : formatChannelRoutesCompact();
}

const channelRoutes: TelegramCommand = {
  name: '/channel_routes',
  aliases: ['/alert_routes'],
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '텔레그램 4채널 라우팅 요약 — 기본 compact, full 상세 지원',
  usage: '/channel_routes [full]',
  async execute({ args, reply }) {
    await reply(formatChannelRoutes(args));
  },
};

commandRegistry.register(channelRoutes);
