// @responsibility todaylog.cmd 텔레그램 모듈
// @responsibility: /todaylog 명령 — 오늘 KST 00시부터 현재까지의 알림 감사 로그를 티어·카테고리별 집계.
import { readAlertAuditRange } from '../../../alerts/alertAuditLog.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const todaylog: TelegramCommand = {
  name: '/todaylog',
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '오늘 발생한 알림 카테고리·티어 요약',
  async execute({ reply }) {
    const nowMs = Date.now();
    const kstNow = new Date(nowMs + 9 * 3_600_000);
    const kstMidnight =
      Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) - 9 * 3_600_000;
    const entries = readAlertAuditRange(kstMidnight, nowMs);
    if (entries.length === 0) {
      await reply('📋 오늘 기록된 알림이 없습니다.');
      return;
    }
    const byTier: Record<string, number> = { T1_ALARM: 0, T2_REPORT: 0, T3_DIGEST: 0 };
    const byCat = new Map<string, number>();
    for (const e of entries) {
      byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
    }
    const topCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    await reply(
      `📋 <b>[오늘 알림 로그] ${entries.length}건</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🚨 T1 ALARM: ${byTier.T1_ALARM}건\n` +
      `📊 T2 REPORT: ${byTier.T2_REPORT}건\n` +
      `📋 T3 DIGEST: ${byTier.T3_DIGEST}건\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `<b>카테고리 Top ${topCats.length}:</b>\n` +
      topCats.map(([k, v]) => `  ${k}: ${v}건`).join('\n'),
    );
  },
};

commandRegistry.register(todaylog);

export default todaylog;
