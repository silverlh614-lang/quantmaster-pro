/**
 * @responsibility learningHistorySummary 스냅샷을 텔레그램 HTML 메시지 문자열로 포맷한다.
 */

import { escapeHtml } from '../alerts/telegramClient.js';
import type {
  LearningStatusSnapshot,
  LearningHistorySummary,
  LearningHistoryDay,
} from './learningHistorySummary.js';
import type { ReflectionMode, DailyVerdict, BiasType } from './reflectionTypes.js';

const VERDICT_ICON: Record<DailyVerdict, string> = {
  GOOD_DAY: '🟢',
  MIXED: '🟡',
  BAD_DAY: '🔴',
  SILENT: '⚪',
};

function modeLabel(mode: ReflectionMode | null): string {
  if (mode == null) return '—';
  switch (mode) {
    case 'FULL': return 'FULL';
    case 'REDUCED_EOD': return 'REDUCED_EOD';
    case 'REDUCED_MWF': return 'REDUCED_MWF';
    case 'TEMPLATE_ONLY': return 'TEMPLATE_ONLY';
    case 'SILENCE_MONDAY': return 'SILENCE_MONDAY';
    default: return String(mode);
  }
}

function biasShort(bias: BiasType): string {
  return bias.length > 12 ? bias.slice(0, 12) : bias;
}

function biasIcon(score: number): string {
  if (score >= 0.6) return '🔴';
  if (score >= 0.4) return '🟡';
  return '🟢';
}

function dayOfWeekKr(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
}

export function formatLearningStatusMessage(s: LearningStatusSnapshot): string {
  const lines: string[] = ['🧠 <b>자기학습 상태 (직전 1회)</b>'];

  if (s.lastReflection) {
    const r = s.lastReflection;
    const verdictIcon = VERDICT_ICON[r.dailyVerdict] ?? '⚪';
    lines.push(`📅 마지막 reflection: ${r.date} (mode: ${modeLabel(r.mode)})`);
    lines.push(`${verdictIcon} 일일 평가: ${r.dailyVerdict}`);
    lines.push(
      `📝 서사: ${r.narrativeLength}자 / 핵심교훈 ${r.keyLessonsCount}건 / 의문결정 ${r.questionableDecisionsCount}건 / 내일조정 ${r.tomorrowAdjustmentsCount}건`
    );
    const personaLabel = r.personaReviewStressed === null
      ? '미평가'
      : r.personaReviewStressed
        ? '✅'
        : '🔴';
    lines.push(`🔍 5-Why: ${r.fiveWhyCount}건 / 페르소나 원탁 통과: ${personaLabel}`);
    lines.push(`🛡️ Integrity Guard: ${r.integrityRemovedCount}건 삭제${r.integrityParseFailed ? ' (파싱 실패)' : ''}`);
    if (r.narrativePreview && r.narrativePreview.length > 0) {
      lines.push('');
      lines.push(`💬 서사 미리보기:\n  <i>${escapeHtml(r.narrativePreview)}</i>`);
    }
  } else {
    lines.push('📅 마지막 reflection: 없음 (최근 30일 내 0건)');
  }

  if (s.tomorrowPriming) {
    lines.push('');
    lines.push(`💡 내일 아침 학습 포인트 (forDate ${s.tomorrowPriming.forDate}):`);
    lines.push(`  <i>${escapeHtml(s.tomorrowPriming.oneLineLearning)}</i>`);
  }

  lines.push('');
  if (s.biasHeatmapToday && s.biasHeatmapToday.scores.length > 0) {
    const top3 = [...s.biasHeatmapToday.scores]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const segs = top3.map(b => `${biasIcon(b.score)} ${biasShort(b.bias)} ${b.score.toFixed(2)}`);
    lines.push(`📊 편향 히트맵 (오늘): ${segs.join(' / ')}`);
  } else {
    lines.push('📊 편향 히트맵 (오늘): 미생성');
  }

  if (s.biasHeatmap7dAvg.length > 0) {
    const top3 = s.biasHeatmap7dAvg.slice(0, 3);
    const segs = top3.map(b => `${biasShort(b.bias)} ${b.avg.toFixed(2)}`);
    lines.push(`📈 7일 평균 TOP3: ${segs.join(' / ')}`);
  }

  lines.push('');
  lines.push(
    `🧪 실험 제안 활성: ${s.experimentProposalsActive.length}건` +
    (s.experimentProposalsCompletedRecent.length > 0
      ? ` / 최근 완료 ${s.experimentProposalsCompletedRecent.length}건`
      : '')
  );

  lines.push(
    `💰 Gemini 예산 (${s.reflectionBudget.month}): 호출 ${s.reflectionBudget.callCount}회 / tokens ${s.reflectionBudget.tokensUsed.toLocaleString()}`
  );
  lines.push(`👻 Ghost Portfolio OPEN: ${s.ghostPortfolioOpenCount}건`);

  const sa = s.suggestAlerts7d;
  lines.push(
    `🔔 최근 7일 suggest 알림: 총 ${sa.total}건 (counterfactual ${sa.counterfactual} · ledger ${sa.ledger} · kellySurface ${sa.kellySurface} · regime ${sa.regimeCoverage})`
  );

  lines.push('');
  if (s.diagnostics.healthy) {
    lines.push('✅ 진단: 정상');
  } else {
    lines.push('⚠️ 진단: 주의 필요');
    for (const w of s.diagnostics.warnings) {
      lines.push(`  - ${escapeHtml(w)}`);
    }
  }

  return lines.join('\n');
}

function formatHistoryDay(d: LearningHistoryDay): string {
  const dow = dayOfWeekKr(d.date);
  if (!d.hasReflection) {
    return `${d.date} (${dow}) ❌ 미실행`;
  }
  if (d.silenceMonday) {
    return `${d.date} (${dow}) ⏸️ SILENCE_MONDAY (의도적 비활성)`;
  }
  const verdict = d.dailyVerdict ?? 'SILENT';
  const verdictIcon = VERDICT_ICON[verdict] ?? '⚪';
  const parts: string[] = [
    `${d.date} (${dow}) ${verdictIcon} ${modeLabel(d.mode)}`,
    `${verdict}`,
    `서사 ${d.narrativeLength}자`,
    `교훈 ${d.keyLessonsCount}`,
    `5Why ${d.fiveWhyCount}`,
  ];
  if (d.integrityRemovedCount > 0) {
    parts.push(`Integrity ${d.integrityRemovedCount}↓`);
  }
  let line = parts.join(' · ');
  if (d.biasTopThree.length > 0) {
    const segs = d.biasTopThree.map(b => `${biasShort(b.bias)} ${b.score.toFixed(2)}`);
    line += `\n              편향 TOP3: ${segs.join(' / ')}`;
  }
  return line;
}

export function formatLearningHistoryMessage(h: LearningHistorySummary): string {
  const span = h.days.length;
  const lines: string[] = [`📚 <b>자기학습 이력 (최근 ${span}일)</b>`, ''];
  for (const d of h.days) {
    lines.push(formatHistoryDay(d));
  }
  lines.push('');
  const denom = span - h.days.filter(d => d.silenceMonday).length;
  lines.push(`총 reflection: ${h.totalReflections}/${denom}일 (SILENCE_MONDAY 제외)`);
  lines.push(`누락 일수: ${h.missingDays}일${h.missingDays > 0 ? ' — cron 또는 data write 실패 의심' : ''}`);
  lines.push(`이번달 Gemini: 호출 ${h.budget.callCount}회 · tokens ${h.budget.tokensUsed.toLocaleString()}`);

  if (h.escalatingBiases.length > 0) {
    lines.push('');
    lines.push('🚨 escalating 편향 (3일 연속 ≥0.5):');
    for (const e of h.escalatingBiases) {
      const seq = e.recentScores.map(s => s.toFixed(2)).join(', ');
      lines.push(`  - ${e.bias}: [${seq}]`);
    }
  }

  return lines.join('\n');
}
