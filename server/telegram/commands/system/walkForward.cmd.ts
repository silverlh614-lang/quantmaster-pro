// @responsibility walkForward.cmd 텔레그램 모듈 — /walk_forward 영속 결과 진단.
import { loadWalkForwardResults } from '../../../persistence/walkForwardResultsRepo.js';
import { isFrameworkDisabled } from '../../../learning/walkForwardFramework.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import type { WalkForwardResults, WalkForwardWindow } from '../../../persistence/walkForwardResultsRepo.js';

/**
 * 메시지 빌더 (단위 테스트 가능 — TelegramCommand.execute 와 분리).
 *
 * @param results 영속 결과 (load 직후)
 * @param requestedN 사용자 요청 윈도우 수 (1~24, 잘못된 값 → 10)
 * @param disabled WALK_FORWARD_FRAMEWORK_DISABLED env 활성 여부
 */
export function formatWalkForwardMessage(
  results: WalkForwardResults,
  requestedN: number,
  disabled: boolean,
): string {
  if (disabled) {
    return '🔬 <b>Walk-Forward Framework</b>\n\n⛔ 비활성 (WALK_FORWARD_FRAMEWORK_DISABLED=true)';
  }
  if (results.windows.length === 0) {
    return (
      '🔬 <b>Walk-Forward Framework</b>\n\n' +
      '📭 윈도우 결과 없음 — framework 가 아직 실행되지 않음.\n' +
      '   /health 명령으로 학습 cron 상태 확인 가능.'
    );
  }
  const safeN = Math.max(1, Math.min(24, Math.floor(Number.isFinite(requestedN) ? requestedN : 10)));
  const recent = results.windows.slice(-safeN);
  const last = recent[recent.length - 1] ?? recent[0];
  const lines: string[] = [];
  lines.push(`🔬 <b>Walk-Forward Framework</b> — 최근 ${recent.length}/${results.windows.length}개 윈도우`);
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
  if (last.regimeMetrics && Object.keys(last.regimeMetrics).length > 0) {
    lines.push('');
    lines.push(`🎯 <b>Regime 분리</b>:`);
    for (const [regime, m] of Object.entries(last.regimeMetrics)) {
      lines.push(`  • ${regime}: IS WR ${(m.is.winRate * 100).toFixed(0)}% (${m.is.sampleSize}) → OOS WR ${(m.oos.winRate * 100).toFixed(0)}% (${m.oos.sampleSize})`);
    }
  }
  lines.push('');
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

const walkForward: TelegramCommand = {
  name: '/walk_forward',
  aliases: ['/wf'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Walk-Forward Framework 결과 진단 (Rolling IS/OOS + Regime + Decay)',
  usage: '/walk_forward [N=10]  — 최근 N개 윈도우 표시',
  async execute({ args, reply }) {
    try {
      const requested = Number(args[0] ?? '10');
      const results = loadWalkForwardResults();
      const message = formatWalkForwardMessage(results, requested, isFrameworkDisabled());
      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /walk_forward 실패:', e);
      await reply('❌ Walk-Forward 결과 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(walkForward);

export default walkForward;
