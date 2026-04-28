// @responsibility twins.cmd 텔레그램 모듈 — /twins Twin Strategy Leaderboard (AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT vs CURRENT).
import {
  ALL_TWIN_KEYS,
  compareTwinsVsReal,
  getAllTwinEntries,
  type TwinComparisonResult,
  type TwinEntry,
  type TwinKey,
} from '../../../learning/counterfactualTwinPortfolio.js';
import { getMonthlyStats } from '../../../learning/recommendationTracker.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const TWIN_LABEL: Record<TwinKey, string> = {
  AGGRESSIVE: '🔥 AGGRESSIVE',
  DISCIPLINED: '🎯 DISCIPLINED',
  EQUAL_WEIGHT: '⚖️ EQUAL_WEIGHT',
};

export interface TwinsFormatInput {
  result: TwinComparisonResult;
  /** 모든 Twin entries (활성 카운트 표시용) */
  entries: TwinEntry[];
  /** CURRENT (실제 LIVE) 누적 수익률 표기 (compareTwinsVsReal 결과와 동일) */
  realCumReturnPct: number;
}

/**
 * Twin Strategy Leaderboard 메시지 빌더.
 *
 * 표시: 4 전략 (CURRENT vs 3 Twin) cumReturnPct + Sharpe proxy + weekWinning + 활성 카운트.
 * 정렬: cumReturnPct 내림차순.
 */
export function formatTwinsMessage(input: TwinsFormatInput): string {
  const { result, entries, realCumReturnPct } = input;
  const totalEntries = entries.length;

  if (totalEntries === 0) {
    return (
      '👯 <b>Twin Strategy Leaderboard</b>\n\n' +
      '📭 Twin Portfolio 데이터 없음 — Twin 기록 hook (PR-R) 가 wiring 된 후 운영 데이터 누적 필요.\n' +
      '   3 Twin 정책: AGGRESSIVE (Gate≥14, KELLY) / DISCIPLINED (Gate≥22, KELLY) / EQUAL_WEIGHT (Gate≥18, 0.10).'
    );
  }

  // CURRENT + 3 Twin 정렬용 entries
  const ranking: Array<{ name: string; key: 'CURRENT' | TwinKey; cumReturnPct: number; sharpe: number; activeCount: number; closedCount: number; winningOverReal: boolean }> = [
    {
      name: '👤 CURRENT (LIVE)',
      key: 'CURRENT',
      cumReturnPct: realCumReturnPct,
      sharpe: 0, // CURRENT 의 sharpe 는 본 모듈 scope 외 — 0 placeholder
      activeCount: 0,
      closedCount: 0,
      winningOverReal: false,
    },
  ];
  for (const k of ALL_TWIN_KEYS) {
    const stats = result.perTwin[k];
    const twinEntries = entries.filter((e) => e.twin === k);
    ranking.push({
      name: TWIN_LABEL[k],
      key: k,
      cumReturnPct: stats.cumReturnPct,
      sharpe: stats.weeklySharpeProxy,
      activeCount: stats.activeCount,
      closedCount: stats.closedCount,
      winningOverReal: result.weekWinning[k],
    });
  }
  ranking.sort((a, b) => b.cumReturnPct - a.cumReturnPct);

  const lines: string[] = [];
  lines.push('👯 <b>Twin Strategy Leaderboard</b> — CURRENT vs 3 Twin 정책');
  lines.push('');
  lines.push(`📊 <b>전체</b>: ${totalEntries}건 (활성 ${entries.filter((e) => e.status === 'OPEN').length} / 종결 ${entries.filter((e) => e.status === 'CLOSED').length})`);
  lines.push('');
  lines.push('🏆 <b>순위 (cumReturnPct 내림차순)</b>:');
  ranking.forEach((r, i) => {
    const sign = r.cumReturnPct >= 0 ? '+' : '';
    const winMark = r.key !== 'CURRENT' && r.winningOverReal ? ' ✅' : '';
    const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '4️⃣';
    if (r.key === 'CURRENT') {
      lines.push(`  ${rankEmoji} ${r.name} — ${sign}${r.cumReturnPct.toFixed(2)}%`);
    } else {
      lines.push(
        `  ${rankEmoji} ${r.name} — ${sign}${r.cumReturnPct.toFixed(2)}% ` +
        `(Sharpe ${r.sharpe.toFixed(2)} / 종결 ${r.closedCount} 건${winMark})`,
      );
    }
  });

  lines.push('');
  lines.push('💡 ✅ = 해당 Twin 이 CURRENT 보다 누적 수익률 우월 (현재 시점)');
  lines.push('   4주 연속 우월 시 promotion 후보 (운영자 검토 — 자동 임계 조정 금지)');

  return lines.join('\n');
}

const twins: TelegramCommand = {
  name: '/twins',
  aliases: ['/twin_leaderboard'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Twin Strategy Leaderboard — CURRENT vs AGGRESSIVE/DISCIPLINED/EQUAL_WEIGHT',
  usage: '/twins  — 4 전략 누적 수익률 비교',
  async execute({ reply }) {
    try {
      // CURRENT cumReturnPct = recommendationTracker 의 monthlyStats.compoundReturn 사용
      const monthlyStats = getMonthlyStats();
      const realCumReturnPct = monthlyStats.compoundReturn ?? 0;
      const result = compareTwinsVsReal(realCumReturnPct);
      const entries = getAllTwinEntries();
      const message = formatTwinsMessage({ result, entries, realCumReturnPct });
      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /twins 실패:', e);
      await reply('❌ Twin Leaderboard 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(twins);

export default twins;
