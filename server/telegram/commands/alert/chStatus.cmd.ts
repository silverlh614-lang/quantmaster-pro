// @responsibility /ch_status — 4채널 라우팅 설정 + 오늘 발송 현황 통합 모바일 뷰
import { getChannelStatsByDate } from '../../../persistence/channelStatsRepo.js';
import { AlertCategory, isCategoryEnabled } from '../../../alerts/alertCategories.js';
import { getResolvedChannelMap } from '../../../alerts/alertRouter.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function miniBar(sent: number, max: number): string {
  if (max === 0) return '░░░░░';
  const filled = Math.round((sent / max) * 5);
  return '▓'.repeat(filled) + '░'.repeat(5 - filled);
}

function maskId(id: string | undefined): string {
  if (!id) return '❌ 미설정';
  if (id.startsWith('@')) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

const chStatus: TelegramCommand = {
  name: '/ch_status',
  aliases: ['/channel_status'],
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '4채널 라우팅 설정 + 오늘 발송 현황 한눈에 확인',
  usage: '/ch_status',
  async execute({ reply }) {
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    const stats = getChannelStatsByDate(todayKey);
    const channelMap = getResolvedChannelMap();

    const rows: Array<{ label: string; category: AlertCategory; emoji: string }> = [
      { label: 'CH1 EXECUTION', category: AlertCategory.TRADE, emoji: '⚡' },
      { label: 'CH2 SIGNAL', category: AlertCategory.ANALYSIS, emoji: '🎯' },
      { label: 'CH3 REGIME', category: AlertCategory.INFO, emoji: '🌐' },
      { label: 'CH4 JOURNAL', category: AlertCategory.SYSTEM, emoji: '📒' },
    ];

    const maxSent = Math.max(...rows.map(r => stats[r.category].sent), 1);

    const lines = rows.map(({ label, category, emoji }) => {
      const bucket = stats[category];
      const channelId = channelMap[category];
      const enabled = isCategoryEnabled(category);
      const bar = miniBar(bucket.sent, maxSent);
      const statusIcon = !enabled ? '🔴' : !channelId ? '⚠️' : '🟢';

      const warnings: string[] = [];
      if (bucket.missingChannelSkipped > 0) {
        warnings.push(`채널ID 없음 ${bucket.missingChannelSkipped}건 스킵`);
      }
      if (bucket.disabledSkipped > 0) {
        warnings.push(`비활성 ${bucket.disabledSkipped}건 스킵`);
      }
      if (bucket.failed > 0) {
        warnings.push(`실패 ${bucket.failed}건`);
      }

      return (
        `${statusIcon} ${emoji} <b>${label}</b>  ${maskId(channelId)}\n` +
        `   ${bar} ${bucket.sent}건 sent` +
        (bucket.buffered > 0 ? ` | ${bucket.buffered}건 버퍼` : '') +
        (bucket.cooldownSkipped > 0 ? ` | ${bucket.cooldownSkipped}건 쿨다운` : '') +
        (warnings.length > 0 ? `\n   ⚠️ ${warnings.join(' / ')}` : '')
      );
    });

    const totalDmBypass = rows.reduce((sum, r) => sum + stats[r.category].directDmBypass, 0);
    const dmBypassWarn = totalDmBypass > 0
      ? `\n⚠️ 개인 DM 우회 ${totalDmBypass}건 감지 — /channel_stats 로 상세 확인`
      : '';

    const totalSent = rows.reduce((sum, r) => sum + stats[r.category].sent, 0);
    const totalFailed = rows.reduce((sum, r) => sum + stats[r.category].failed, 0);

    await reply(
      `📊 <b>[채널 현황 ${todayKey} KST]</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      lines.join('\n━━━━━━━━━━━━━━━━\n') +
      `\n━━━━━━━━━━━━━━━━\n` +
      `합계: sent ${totalSent}건` +
      (totalFailed > 0 ? ` | ❌ failed ${totalFailed}건` : '') +
      dmBypassWarn +
      `\n상세: /channel_stats | 라우팅: /channel_routes`,
    );
  },
};

commandRegistry.register(chStatus);
export default chStatus;
