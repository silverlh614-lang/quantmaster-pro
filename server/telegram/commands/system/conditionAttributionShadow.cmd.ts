// @responsibility conditionAttributionShadow.cmd 텔레그램 모듈 — /shadow_attribution Over-Strict / Good Defense 진단.
import {
  analyzeShadowAttribution,
  type ShadowAttributionReport,
  type ShadowConditionStat,
} from '../../../learning/conditionAttributionShadow.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const CLASS_EMOJI: Record<ShadowConditionStat['classification'], string> = {
  over_strict_candidate: '⚠️',     // 너무 엄격 — 완화 검토
  good_defense_candidate: '🛡️',   // 잘 막아줌 — RISK_PROTECTOR 후보
  insufficient: '⏳',              // 표본 부족
  normal: '✅',                    // 균형
};

export function formatShadowAttributionMessage(report: ShadowAttributionReport): string {
  if (report.status === 'DISABLED') {
    return '🌑 <b>Shadow → Condition Attribution</b>\n\n⛔ 비활성 (SHADOW_CONDITION_ATTRIBUTION_DISABLED=true)';
  }
  if (report.status === 'NO_DATA') {
    return (
      '🌑 <b>Shadow → Condition Attribution</b>\n\n' +
      '📭 분석 가능 데이터 없음 — Rejection 종결 entry + conditionScores 부족.\n' +
      '   조건별 Over-Strict / Good Defense 분류는 호출자 wiring (PR-F-2 후속) 후 가능.'
    );
  }

  const overStrict = report.conditions.filter((c) => c.classification === 'over_strict_candidate')
    .sort((a, b) => b.overStrictCount - a.overStrictCount);
  const goodDefense = report.conditions.filter((c) => c.classification === 'good_defense_candidate')
    .sort((a, b) => b.goodDefenseCount - a.goodDefenseCount);

  const lines: string[] = [];
  lines.push('🌑 <b>Shadow → Condition Attribution</b> — 거절 종목 사후 성과 분석');
  lines.push('');
  lines.push(`📊 <b>요약</b>: 종결 표본 ${report.closedSampleSize}건 / 27 조건 분석`);
  lines.push(`  • ⚠️ Over-Strict 후보: ${report.summary.overStrictCandidates} (너무 엄격 — 완화 검토)`);
  lines.push(`  • 🛡️ Good Defense 후보: ${report.summary.goodDefenseCandidates} (잘 막아줌 — RISK_PROTECTOR)`);
  lines.push(`  • ⏳ 표본 부족: ${report.summary.insufficient}`);
  lines.push(`  • ✅ 균형: ${report.summary.normal}`);

  if (overStrict.length > 0) {
    lines.push('');
    lines.push('⚠️ <b>Over-Strict 후보</b> (거절했지만 +5% 이상 종목에서 자주 미달):');
    for (const c of overStrict.slice(0, 10)) {
      lines.push(
        `  • #${c.conditionId} ${c.conditionName} — ` +
        `over ${c.overStrictCount}건 (avg +${c.overStrictAvgReturn.toFixed(2)}%) / ratio ${(c.ratio * 100).toFixed(0)}%`,
      );
    }
  }

  if (goodDefense.length > 0) {
    lines.push('');
    lines.push('🛡️ <b>Good Defense 후보</b> (거절 후 -5% 이하 종목에서 자주 미달):');
    for (const c of goodDefense.slice(0, 10)) {
      lines.push(
        `  • #${c.conditionId} ${c.conditionName} — ` +
        `defense ${c.goodDefenseCount}건 (avg ${c.goodDefenseAvgReturn.toFixed(2)}%) / ratio ${(c.ratio * 100).toFixed(0)}%`,
      );
    }
  }

  if (overStrict.length === 0 && goodDefense.length === 0) {
    lines.push('');
    lines.push('💡 분류 후보 없음 — 표본 부족 또는 균형 분포.');
  }

  lines.push('');
  lines.push('📌 <b>의사결정 안내</b>:');
  lines.push('   • Over-Strict 후보 → 조건 임계 완화 검토 (운영자 결정, 자동 조정 금지)');
  lines.push('   • Good Defense 후보 → RISK_PROTECTOR 강화 검토');
  lines.push('   • 빈도 ≥ 3 + ratio ≥ 0.7 (Over-Strict) 또는 ≤ 0.3 (Good Defense) 시 후보');

  return lines.join('\n');
}

const conditionAttributionShadow: TelegramCommand = {
  name: '/shadow_attribution',
  aliases: ['/sa'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow Condition Attribution — 거절 종목 사후 성과 + Over-Strict/Good Defense 분류',
  usage: '/shadow_attribution  — 27조건별 Over-Strict / Good Defense 후보 진단',
  async execute({ reply }) {
    try {
      const report = analyzeShadowAttribution();
      await reply(formatShadowAttributionMessage(report));
    } catch (e) {
      console.error('[TelegramBot] /shadow_attribution 실패:', e);
      await reply('❌ Shadow Attribution 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(conditionAttributionShadow);

export default conditionAttributionShadow;
