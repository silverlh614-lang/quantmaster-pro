// @responsibility coherenceAudit.cmd 텔레그램 모듈 — /coherence_audit 영속 cross-consistency 진단.
import path from 'path';
import {
  runCoherenceAudit,
  type CoherenceAuditReport,
  type CoherenceSeverity,
  type CoherenceViolation,
} from '../../../persistence/cacheCoherenceAuditor.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const SEVERITY_EMOJI: Record<CoherenceSeverity, string> = {
  CRITICAL: '🛑',
  WARN: '⚠️',
  INFO: 'ℹ️',
};

const INVARIANT_LABEL: Record<string, string> = {
  I1_OCO_SHADOW_REF: 'OCO ↔ Shadow',
  I2_PENDING_SHADOW_REF: 'Pending ↔ Shadow',
  I3_ATTRIBUTION_SCHEMA: 'Attribution schema',
  I4_TRADE_SIGNAL_FINALIZED_AT: 'Signal finalizedAt',
  I5_CONDITION_WEIGHTS_RANGE: 'Weights 범위',
};

const HTML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => HTML_ESC[c] ?? c);
}

/**
 * 메시지 빌더 — 단위 테스트 가능 (TelegramCommand.execute 와 분리).
 */
export function formatCoherenceAuditMessage(report: CoherenceAuditReport, requestedN: number): string {
  if (report.disabled) {
    return '🔬 <b>Cache Coherence Audit</b>\n\n⛔ 비활성 (CACHE_COHERENCE_AUDIT_DISABLED=true)';
  }

  const { violations, summary } = report;
  if (violations.length === 0) {
    return [
      '🔬 <b>Cache Coherence Audit</b>',
      '',
      '✅ 5종 invariant 모두 정상',
      '  • I1 OCO ↔ Shadow 참조',
      '  • I2 Pending ↔ Shadow 참조',
      '  • I3 Attribution schema',
      '  • I4 Signal finalizedAt 정합',
      '  • I5 Weights 범위 [0.1, 2.0]',
    ].join('\n');
  }

  const safeN = Math.max(1, Math.min(50, Math.floor(Number.isFinite(requestedN) ? requestedN : 10)));

  // CRITICAL > WARN > INFO 순으로 정렬
  const severityRank: Record<CoherenceSeverity, number> = { CRITICAL: 0, WARN: 1, INFO: 2 };
  const sorted = [...violations].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const top = sorted.slice(0, safeN);

  const lines: string[] = [];
  lines.push('🔬 <b>Cache Coherence Audit</b>');
  lines.push('');
  lines.push(`📊 <b>요약</b>: 총 ${summary.totalViolations}건 위반`);
  lines.push(`  • 🛑 CRITICAL: ${summary.bySeverity.CRITICAL}`);
  lines.push(`  • ⚠️ WARN: ${summary.bySeverity.WARN}`);
  lines.push(`  • ℹ️ INFO: ${summary.bySeverity.INFO}`);
  lines.push('');
  lines.push(`🧩 <b>Invariant 별 카운트</b>:`);
  for (const [id, count] of Object.entries(summary.byInvariant)) {
    if (!count) continue;
    const label = INVARIANT_LABEL[id] ?? id;
    lines.push(`  • ${label}: ${count}건`);
  }
  lines.push('');
  lines.push(`📌 <b>Top ${top.length}/${violations.length} 위반</b>:`);
  for (const v of top) {
    lines.push(formatViolationLine(v));
  }
  if (violations.length > top.length) {
    lines.push('');
    lines.push(`… 외 ${violations.length - top.length}건 (전체는 GET /api/system/coherence-audit)`);
  }
  return lines.join('\n');
}

function formatViolationLine(v: CoherenceViolation): string {
  const emoji = SEVERITY_EMOJI[v.severity];
  const label = INVARIANT_LABEL[v.invariantId] ?? v.invariantId;
  const file = path.basename(v.file);
  const id = v.recordId ? ` <code>${escapeHtml(v.recordId)}</code>` : '';
  return `  ${emoji} [${label}]${id} ${escapeHtml(v.message)} (${file})`;
}

const coherenceAudit: TelegramCommand = {
  name: '/coherence_audit',
  aliases: ['/cohere'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '79개 영속 파일 5종 invariant cross-consistency read-only 검사',
  usage: '/coherence_audit [N=10]  — Top N 위반 표시',
  async execute({ args, reply }) {
    try {
      const requested = Number(args[0] ?? '10');
      const report = runCoherenceAudit();
      const msg = formatCoherenceAuditMessage(report, requested);
      await reply(msg);
    } catch (e) {
      console.error('[TelegramBot] /coherence_audit 실패:', e);
      await reply('❌ Coherence Audit 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(coherenceAudit);

export default coherenceAudit;
