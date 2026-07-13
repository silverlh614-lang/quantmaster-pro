// @responsibility shadowWalkForward.cmd 텔레그램 모듈 — /shadow_walk_forward Shadow IS/OOS 진단.
import { loadShadowWalkForwardResults } from '../../../persistence/shadowWalkForwardResultsRepo.js';
import { isShadowFrameworkDisabled } from '../../../learning/shadowWalkForwardFramework.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import type {
  WalkForwardResults,
  WalkForwardWindow,
} from '../../../persistence/walkForwardResultsRepo.js';

export function formatShadowWalkForwardMessage(
  results: WalkForwardResults,
  requestedN: number,
  disabled: boolean,
): string {
  if (disabled) {
    return '🌑 <b>Shadow Walk-Forward</b>\n\n⛔ 비활성 (SHADOW_WALK_FORWARD_DISABLED=true)';
  }
  if (results.windows.length === 0) {
    return (
      '🌑 <b>Shadow Walk-Forward</b>\n\n' +
      '📭 윈도우 결과 없음 — Rejection/Twin 영속 데이터 부족 또는 framework 미실행.\n' +
      '   `/health` 명령으로 학습 cron 상태 확인 가능.'
    );
  }
  const safeN = Math.max(1, Math.min(24, Math.floor(Number.isFinite(requestedN) ? requestedN : 10)));
  const recent = results.windows.slice(-safeN);
  const last = recent[recent.length - 1] ?? recent[0];
  const lines: string[] = [];
  lines.push(`🌑 <b>Shadow Walk-Forward</b> — 최근 ${recent.length}/${results.windows.length} 윈도우 (Rejection + Twin)`);
  lines.push('');
  lines.push('📊 <b>전체 요약</b>:');
  lines.push(`  • avgDegradation: ${results.summary.avgDegradation.toFixed(1)}%p (IS - OOS)`);
  lines.push(`  • medianDegradation: ${results.summary.medianDegradation.toFixed(1)}%p`);
  lines.push(`  • overfitFlagged: ${results.summary.overfitFlagged} (>15%p)`);
  lines.push(`  • decayTrend: ${decayEmoji(results.summary.decayTrend)} ${results.summary.decayTrend}`);
  lines.push('');
  lines.push(`📌 <b>최근 윈도우</b> (${last.outSampleStart} ~ ${last.outSampleEnd}):`);
  lines.push(formatWindowLine('IS ', last.isMetrics));
  lines.push(formatWindowLine('OOS', last.oosMetrics));
  lines.push(`  • degradation: ${last.degradation.toFixed(1)}%p ${overfitMark(last.degradation)}`);
  lines.push('');
  lines.push(`📁 windowId prefix='shadow_' (LIVE 결과는 \`/walk_forward\` 별도)`);
  lines.push(`generatedAt: ${results.generatedAt}`);
  return lines.join('\n');
}

function formatWindowLine(label: string, m: WalkForwardWindow['isMetrics']): string {
  return (
    `  • ${label}: WR ${(m.winRate * 100).toFixed(1)}% (${m.sampleSize}건) ` +
    `avg ${m.avgReturn >= 0 ? '+' : ''}${m.avgReturn.toFixed(1)}% / ` +
    `total ${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn.toFixed(1)}%`
  );
}

function decayEmoji(trend: WalkForwardResults['summary']['decayTrend']): string {
  switch (trend) {
    case 'IMPROVING': return '🟢';
    case 'STABLE': return '🟡';
    case 'DECAYING': return '🔴';
    case 'INSUFFICIENT': default: return '⚪';
  }
}

function overfitMark(degradation: number): string {
  if (degradation > 15) return '🔴 (과최적화 의심)';
  if (degradation > 5) return '🟡';
  return '✅';
}

const shadowWalkForward: TelegramCommand = {
  name: '/shadow_walk_forward',
  aliases: ['/swf'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow Walk-Forward 결과 진단 (Rejection + Twin IS/OOS 분할)',
  usage: '/shadow_walk_forward [N=10]  — 최근 N개 윈도우 표시',
  async execute({ args, reply }) {
    try {
      const requested = Number(args[0] ?? '10');
      const results = loadShadowWalkForwardResults();
      const message = formatShadowWalkForwardMessage(results, requested, isShadowFrameworkDisabled());
      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /shadow_walk_forward 실패:', e);
      await reply('❌ Shadow Walk-Forward 결과 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(shadowWalkForward);
