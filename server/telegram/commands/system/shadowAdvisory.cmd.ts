// @responsibility shadowAdvisory.cmd 텔레그램 모듈 — /shadow_advisory 3축(과엄격/방어성공/트윈우월) 통합 advisory.
import {
  summarizeRejectionShadow,
} from '../../../learning/rejectionShadowTracker.js';
import {
  ALL_TWIN_KEYS,
  compareTwinsVsReal,
  type TwinKey,
} from '../../../learning/counterfactualTwinPortfolio.js';
import {
  analyzeShadowAttribution,
  type ShadowConditionStat,
} from '../../../learning/conditionAttributionShadow.js';
import { loadShadowTrades, aggregateFillStats } from '../../../persistence/shadowTradeRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const TWIN_LABEL: Record<TwinKey, string> = {
  AGGRESSIVE: 'AGGR',
  DISCIPLINED: 'DISC',
  EQUAL_WEIGHT: 'EQW',
};

export interface ShadowAdvisoryFormatInput {
  rejectionSummary: ReturnType<typeof summarizeRejectionShadow>;
  twinComparison: ReturnType<typeof compareTwinsVsReal>;
  attribution: ReturnType<typeof analyzeShadowAttribution>;
  realCumReturnPct: number;
  /** 표시 limit (default 5, max 10) */
  limit: number;
}

/**
 * Shadow Advisory 통합 메시지 빌더 — 사용자 요청 (4/29) "과엄격/방어성공/트윈우월" 3축.
 *
 * 1축 — Over-Strict 후보: 거절 후 ≥+5% 성과 종목의 *낮은 점수 조건* (Gate 완화 후보)
 * 2축 — Good Defense 후보: 거절 후 ≤-5% 성과 종목의 *낮은 점수 조건* (Gate 강화 후보)
 * 3축 — Twin 우월: AGGR/DISC/EQW 중 CURRENT 누적수익률 보다 높은 Twin
 *
 * 자동 임계 조정 *금지* — 운영자 검토 필수 (PR-Y2 학습 정책 준수).
 */
export function formatShadowAdvisoryMessage(input: ShadowAdvisoryFormatInput): string {
  const { rejectionSummary, twinComparison, attribution, realCumReturnPct, limit } = input;
  const safeN = Math.max(1, Math.min(10, Math.floor(Number.isFinite(limit) ? limit : 5)));

  const lines: string[] = [];
  lines.push('🌑 <b>Shadow Advisory — 메타 학습 진단</b>');
  lines.push('');

  // ─── 1) Rejection alpha 누락 ──────────────────────────────────────────────
  lines.push('📊 <b>1) Rejection alpha 누락 (과엄격 의심)</b>');
  if (rejectionSummary.totalCount === 0) {
    lines.push('  • 데이터 부족 — Gate 14~17 near-miss 영속 부재');
  } else if (!rejectionSummary.reliable) {
    lines.push(`  • 표본 부족 (종결 ${rejectionSummary.closedCount}/${rejectionSummary.totalCount}, <5)`);
  } else {
    const fnPct = (rejectionSummary.falseNegativeRate * 100).toFixed(0);
    const emoji = rejectionSummary.falseNegativeRate >= 0.3 ? '🔴' : rejectionSummary.falseNegativeRate >= 0.15 ? '🟡' : '🟢';
    lines.push(`  ${emoji} 거절 ${rejectionSummary.closedCount}건 중 alpha 누락 ${fnPct}% (≥+5% 종목 비율)`);
    lines.push(`  • 평균 ${rejectionSummary.avgClosedReturnPct.toFixed(2)}% / 중앙값 ${rejectionSummary.medianClosedReturnPct.toFixed(2)}%`);
  }

  // ─── 2) Over-Strict 조건 후보 ─────────────────────────────────────────────
  lines.push('');
  lines.push('⚠️ <b>2) Over-Strict 조건 후보 (Gate 완화 검토)</b>');
  const overStrict = attribution.conditions
    .filter((c: ShadowConditionStat) => c.classification === 'over_strict_candidate')
    .sort((a: ShadowConditionStat, b: ShadowConditionStat) => b.overStrictCount - a.overStrictCount)
    .slice(0, safeN);
  if (attribution.status !== 'OK') {
    lines.push(`  • ${attribution.status === 'DISABLED' ? 'ENV 비활성' : '데이터 부족'}`);
  } else if (overStrict.length === 0) {
    lines.push('  ✓ 후보 없음 — 거절 정책이 균형 상태');
  } else {
    for (const c of overStrict) {
      lines.push(
        `  ⚠️ <b>${c.conditionName}</b> (#${c.conditionId}) — ` +
        `over=${c.overStrictCount} avg+${c.overStrictAvgReturn.toFixed(1)}% (ratio ${(c.ratio * 100).toFixed(0)}%)`,
      );
    }
  }

  // ─── 3) Good Defense 조건 후보 (방어성공) ─────────────────────────────────
  lines.push('');
  lines.push('🛡️ <b>3) Good Defense 조건 (방어 성공)</b>');
  const goodDefense = attribution.conditions
    .filter((c: ShadowConditionStat) => c.classification === 'good_defense_candidate')
    .sort((a: ShadowConditionStat, b: ShadowConditionStat) => b.goodDefenseCount - a.goodDefenseCount)
    .slice(0, safeN);
  if (attribution.status !== 'OK') {
    // 위 1) 안내와 중복 — 라인 1개만
    lines.push('  • (위 진단 참조)');
  } else if (goodDefense.length === 0) {
    lines.push('  ✓ 후보 없음');
  } else {
    for (const c of goodDefense) {
      lines.push(
        `  🛡️ <b>${c.conditionName}</b> (#${c.conditionId}) — ` +
        `defense=${c.goodDefenseCount} avg${c.goodDefenseAvgReturn.toFixed(1)}% (ratio ${(c.ratio * 100).toFixed(0)}%)`,
      );
    }
  }

  // ─── 4) Twin 우월 ─────────────────────────────────────────────────────────
  lines.push('');
  lines.push(`👯 <b>4) Twin 우월 (CURRENT ${realCumReturnPct >= 0 ? '+' : ''}${realCumReturnPct.toFixed(2)}% 대비)</b>`);
  const ranking: Array<{ key: TwinKey; cumReturnPct: number; sharpe: number }> = ALL_TWIN_KEYS.map((k) => ({
    key: k,
    cumReturnPct: twinComparison.perTwin[k].cumReturnPct,
    sharpe: twinComparison.perTwin[k].weeklySharpeProxy,
  }));
  ranking.sort((a, b) => b.cumReturnPct - a.cumReturnPct);
  let topAdvantage = false;
  for (const r of ranking) {
    const delta = r.cumReturnPct - realCumReturnPct;
    const emoji = delta > 0 ? '🥇' : delta === 0 ? '=' : '↓';
    if (delta > 0) topAdvantage = true;
    lines.push(
      `  ${emoji} ${TWIN_LABEL[r.key]}: ${r.cumReturnPct >= 0 ? '+' : ''}${r.cumReturnPct.toFixed(2)}% ` +
      `(Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%p, Sharpe ${r.sharpe.toFixed(2)})`,
    );
  }
  if (!topAdvantage) {
    lines.push('  ✓ CURRENT 가 모든 Twin 보다 우월 — 현 정책 유지');
  }

  // ─── 의사결정 안내 ────────────────────────────────────────────────────────
  lines.push('');
  lines.push('💡 <b>의사결정 안내</b>');
  lines.push('  • 자동 임계 조정 <i>금지</i> — 운영자 검토 필수');
  lines.push('  • Over-Strict 빈발 → 해당 조건 score 임계 -1 검토');
  lines.push('  • Good Defense 빈발 → 해당 조건 가중치 보강 검토');
  lines.push('  • Twin 4주 연속 우월 → 진입 정책 격상 검토');

  return lines.join('\n');
}

const shadowAdvisory: TelegramCommand = {
  name: '/shadow_advisory',
  aliases: ['/sa_advisory', '/sad'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Shadow Advisory — 과엄격/방어성공/트윈우월 통합 메타 진단',
  usage: '/shadow_advisory [N=5]  — 후보 Top N 표시',
  async execute({ args, reply }) {
    try {
      const limit = Number(args[0] ?? '5');
      const rejectionSummary = summarizeRejectionShadow();
      // CURRENT 누적 수익률 — fillStats 의 weightedReturnPct 사용 (ADR-0086 정합)
      const trades = loadShadowTrades();
      const fillStats = aggregateFillStats(trades);
      const realCumReturnPct = fillStats.weightedReturnPct ?? 0;
      const twinComparison = compareTwinsVsReal(realCumReturnPct);
      const attribution = analyzeShadowAttribution();
      const message = formatShadowAdvisoryMessage({
        rejectionSummary,
        twinComparison,
        attribution,
        realCumReturnPct,
        limit,
      });
      await reply(message);
    } catch (e) {
      console.error('[TelegramBot] /shadow_advisory 실패:', e);
      await reply('❌ Shadow Advisory 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(shadowAdvisory);

export default shadowAdvisory;
