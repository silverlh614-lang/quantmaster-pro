// @responsibility rejected.cmd 텔레그램 모듈 — /rejected near-miss 거절 종목 사후 추적 가시화.
import {
  getAllRejectionShadow,
  summarizeRejectionShadow,
  type RejectionShadowEntry,
} from '../../../learning/rejectionShadowTracker.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export interface RejectedFormatInput {
  entries: RejectionShadowEntry[];
  summary: ReturnType<typeof summarizeRejectionShadow>;
  /** 표시 limit (default 10, max 30) */
  limit: number;
}

/**
 * 거절된 near-miss 종목 사후 추적 결과 메시지 빌더 (단위 테스트 가능).
 *
 * 우선순위 표시:
 *   1. 통계 요약 (false negative rate / 중앙값 / 분위수)
 *   2. 종결된 entry 중 currentReturnPct 내림차순 Top N
 *   3. 활성 entry 중 currentReturnPct 내림차순 일부
 */
export function formatRejectedMessage(input: RejectedFormatInput): string {
  const { entries, summary, limit } = input;
  if (entries.length === 0) {
    return (
      '🔍 <b>Rejected Alpha Tracker</b>\n\n' +
      '📭 추적 중인 거절 종목 없음 — Gate 14~17 near-miss 데이터 부족.\n' +
      '   거절 hook (PR-R) 가 wiring 된 후 운영 데이터 누적 필요.'
    );
  }

  const safeN = Math.max(1, Math.min(30, Math.floor(Number.isFinite(limit) ? limit : 10)));
  const closed = entries.filter((e) => e.closed).sort((a, b) =>
    (b.currentReturnPct ?? 0) - (a.currentReturnPct ?? 0),
  );
  const active = entries.filter((e) => !e.closed).sort((a, b) =>
    (b.currentReturnPct ?? 0) - (a.currentReturnPct ?? 0),
  );

  const lines: string[] = [];
  lines.push(`🔍 <b>Rejected Alpha Tracker</b> — Gate 14~17 near-miss 5영업일 추적`);
  lines.push('');
  lines.push('📊 <b>전체 통계</b>:');
  lines.push(`  • 총: ${summary.totalCount}건 (종결 ${summary.closedCount} / 활성 ${summary.activeCount})`);
  if (summary.reliable) {
    lines.push(`  • Alpha 누락 (≥+5%): ${(summary.falseNegativeRate * 100).toFixed(1)}%`);
    lines.push(`  • 평균: ${summary.avgClosedReturnPct.toFixed(2)}% / 중앙값: ${summary.medianClosedReturnPct.toFixed(2)}%`);
    lines.push(`  • 분위수 Q1/Q2/Q3: ${summary.quartiles.q1.toFixed(2)}% / ${summary.quartiles.q2.toFixed(2)}% / ${summary.quartiles.q3.toFixed(2)}%`);
  } else {
    lines.push(`  • 표본 부족 (종결 ${summary.closedCount} 건 < 5) — 통계 신뢰 불가`);
  }

  if (closed.length > 0) {
    lines.push('');
    lines.push(`🎯 <b>종결 — Missed Alpha Top ${Math.min(safeN, closed.length)}</b> (수익률 내림차순):`);
    for (const e of closed.slice(0, safeN)) {
      const ret = e.currentReturnPct ?? 0;
      const emoji = ret >= 5 ? '🔥' : ret >= 0 ? '🟢' : '🔵';
      lines.push(
        `  ${emoji} <b>${e.stockName}</b> (${e.stockCode}) — ` +
        `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% (Gate ${e.gateScore} / ${e.signalDate})`,
      );
    }
  }

  if (active.length > 0) {
    lines.push('');
    lines.push(`⏳ <b>활성 추적 중 ${active.length}건</b> (마지막 갱신 ${active[0]?.lastUpdatedAt ?? 'N/A'}):`);
    for (const e of active.slice(0, Math.min(5, active.length))) {
      const ret = e.currentReturnPct ?? 0;
      lines.push(`  • <b>${e.stockName}</b> (${e.stockCode}) — ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% (track ${e.trackUntil})`);
    }
  }

  return lines.join('\n');
}

const rejected: TelegramCommand = {
  name: '/rejected',
  aliases: ['/rejection_shadow'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Rejection Shadow Tracker — Gate 14~17 near-miss 거절 종목 사후 추적',
  usage: '/rejected [N=10]  — 종결된 종목 Top N 표시',
  async execute({ args, reply }) {
    try {
      const limit = Number(args[0] ?? '10');
      const entries = getAllRejectionShadow();
      const summary = summarizeRejectionShadow();
      const message = formatRejectedMessage({ entries, summary, limit });
      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /rejected 실패:', e);
      await reply('❌ Rejection Shadow 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(rejected);

export default rejected;
