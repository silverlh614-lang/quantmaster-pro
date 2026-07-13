// @responsibility conditionLifecycle.cmd 텔레그램 모듈 — /condition_lifecycle 27조건 status 진단.
import { loadCurrentSchemaRecords } from '../../../persistence/attributionRepo.js';
import {
  ConditionLifecycleReport,
  getAllConditionLifecycleStatuses,
  isConditionLifecycleDisabled,
  summarizeConditionLifecycle,
} from '../../../learning/conditionLifecyclePolicy.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const STATUS_EMOJI: Record<ConditionLifecycleReport['status'], string> = {
  normal: '✅',
  grace: '🟡',
  silent: '🟠',
  deprecated: '❌',
};

/**
 * 메시지 빌더 — 단위 테스트 가능 (TelegramCommand.execute 와 분리).
 */
export function formatConditionLifecycleMessage(
  reports: ConditionLifecycleReport[],
  windowDays: number,
  requestedN: number,
  disabled: boolean,
): string {
  if (disabled) {
    return '🧬 <b>Condition Lifecycle</b>\n\n⛔ 비활성 (CONDITION_LIFECYCLE_DISABLED=true)';
  }
  if (reports.length === 0) {
    return '🧬 <b>Condition Lifecycle</b>\n\n📭 27조건 데이터 없음 — attributionRepo 가 비어있음.';
  }
  const summary = summarizeConditionLifecycle(reports);
  const safeN = Math.max(1, Math.min(27, Math.floor(Number.isFinite(requestedN) ? requestedN : 27)));

  // activationRate 내림차순 (높은 → 낮은) — 의미 있는 조건이 먼저
  const sorted = [...reports].sort((a, b) => b.activationRate - a.activationRate);
  const top = sorted.slice(0, safeN);

  const lines: string[] = [];
  lines.push(`🧬 <b>Condition Lifecycle</b> — 최근 ${windowDays}일 윈도우`);
  lines.push('');
  lines.push('📊 <b>Status 요약</b>:');
  lines.push(`  • ✅ normal: ${summary.normal}`);
  lines.push(`  • 🟡 grace: ${summary.grace}`);
  lines.push(`  • 🟠 silent: ${summary.silent}`);
  lines.push(`  • ❌ deprecated: ${summary.deprecated}`);
  lines.push('');
  lines.push(`📌 <b>Top ${top.length}/27 조건</b> (활성률 내림차순):`);
  for (const r of top) {
    const emoji = STATUS_EMOJI[r.status];
    const rate = (r.activationRate * 100).toFixed(2);
    const age = r.ageDays > 0 ? `${r.ageDays.toFixed(0)}일` : '신규';
    lines.push(
      `  ${emoji} <b>#${r.conditionId}</b> ${r.conditionName} — ` +
      `${rate}% (${r.activatedCount}/${r.totalRecords}, ${age})`,
    );
  }

  // silent / deprecated 조건은 별도 강조 (있을 때만)
  const flagged = sorted.filter((r) => r.status === 'silent' || r.status === 'deprecated');
  if (flagged.length > 0) {
    lines.push('');
    lines.push(`⚠️ <b>은퇴 후보</b> (${flagged.length}건):`);
    for (const r of flagged.slice(0, 10)) {
      const emoji = STATUS_EMOJI[r.status];
      lines.push(`  ${emoji} #${r.conditionId} ${r.conditionName} — ${r.reason}`);
    }
  }

  return lines.join('\n');
}

const conditionLifecycle: TelegramCommand = {
  name: '/condition_lifecycle',
  aliases: ['/cl'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '27조건 lifecycle status (normal/grace/silent/deprecated) 일괄 진단',
  usage: '/condition_lifecycle [N=27]  — Top N개 조건 표시',
  async execute({ args, reply }) {
    try {
      const requested = Number(args[0] ?? '27');
      const records = loadCurrentSchemaRecords();
      const windowDays = 180;
      const reports = getAllConditionLifecycleStatuses(records, { windowDays });
      const msg = formatConditionLifecycleMessage(
        reports,
        windowDays,
        requested,
        isConditionLifecycleDisabled(),
      );
      await reply(msg);
    } catch (e) {
      console.error('[TelegramBot] /condition_lifecycle 실패:', e);
      await reply('❌ Condition Lifecycle 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(conditionLifecycle);
