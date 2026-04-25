// @responsibility: /news_lag /news_patterns — 베이지안으로 학습된 (newsType × sector) lag 분포 카탈로그.
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const newsLag: TelegramCommand = {
  name: '/news_lag',
  aliases: ['/news_patterns'],
  category: 'ALR',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '뉴스-수급 시차 학습 카탈로그 (베이지안)',
  async execute({ reply }) {
    const { listAllOptimalWindows } = await import('../../../learning/newsLagBayesian.js');
    const windows = listAllOptimalWindows(3);
    if (windows.length === 0) {
      await reply(
        '📡 <b>[뉴스-수급 시차 학습]</b>\n' +
        '아직 표본 ≥3 인 (newsType × sector) 조합이 없습니다.\n' +
        '<i>T+5 결산이 누적될수록 카탈로그가 채워집니다.</i>',
      );
      return;
    }
    const top = windows.slice(0, 12);
    const lines = top.map(
      w =>
        `• <b>${escapeHtml(w.newsType)} → ${escapeHtml(w.sector)}</b>\n` +
        `   peak ${w.meanLagDays}d ± ${w.stdDays}d ` +
        `(95% [${w.ci95LowDays}, ${w.ci95HighDays}d], n=${w.sampleSize})`,
    );
    await reply(
      `📡 <b>[뉴스-수급 시차 카탈로그] ${windows.length}개</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      lines.join('\n') +
      (windows.length > 12 ? `\n...외 ${windows.length - 12}개` : '') +
      `\n\n<i>모델: Normal-Inverse-Gamma conjugate posterior on lag(business days)</i>`,
    );
  },
};

commandRegistry.register(newsLag);

export default newsLag;
