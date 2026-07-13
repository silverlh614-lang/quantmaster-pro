// @responsibility shadowUniverse.cmd — ADR-0433 Counterfactual Universe Learning 텔레그램 명령.
// @responsibility: /shadow_universe — preflight abort 시 universe-level learning snapshot 통합 진단.
//
// ADR-0433:
// Universe-level counterfactual learning preserves scan context at preflight abort
// time without opening execution, paper, normal shadow, provisional shadow, or
// virtual-account paths. This module is read-only — counterfactual-universe-learning-ledger.json
// 만 read 하고 일반 shadow / provisional / counterfactual candidate ledger 무수정.
//
// 안전 가드:
//   - SYS riskLevel=0 (read-only)
//   - ADMIN visibility
//   - LIVE 매매 영향 0 — KIS 주문 함수 import 0건
//   - aliases: /counterfactual_universe / /universe_learning
//   - 외부 API 호출 0 (영속 ledger 만 read)

import {
  loadCounterfactualUniverseLearningLedger,
  summarizeCounterfactualUniverseLearningLedger,
  type CounterfactualUniverseLearningSummary,
  type CounterfactualUniverseLearningSnapshot,
} from '../../../persistence/counterfactualUniverseLearningRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/**
 * ADR-0433 Universe Learning 진단 메시지 builder SSOT.
 *
 * 사용자 §H 명세 — totalSnapshots / todaySnapshots / blockedByBreakdown /
 * preflightStageBreakdown / latest snapshot 요약 / candidateSummaryCount.
 */
export function formatShadowUniverseMessage(
  summary: CounterfactualUniverseLearningSummary,
  recent: CounterfactualUniverseLearningSnapshot[],
): string {
  if (summary.totalSnapshots === 0) {
    return [
      '🧠 <b>Counterfactual Universe Learning (ADR-0433)</b>',
      '',
      'ledger 가 비어있습니다.',
      '<i>SELL_ONLY / HARD_BLOCK / R6_DEFENSE / VIX / FOMC preflight abort 가 발생하면 universe-level learning snapshot 이 자동 영속됩니다.</i>',
      '',
      '<i>read-only — LIVE 매매 영향 0.</i>',
    ].join('\n');
  }
  const lines: string[] = [];
  lines.push('🧠 <b>Counterfactual Universe Learning (ADR-0433)</b>');
  lines.push('');
  lines.push(`📊 누적: <b>${summary.totalSnapshots}건</b>`);
  lines.push(`📅 오늘 KST: <b>${summary.todaySnapshots}건</b>`);
  lines.push('');

  // blockedBy breakdown
  const blockedByEntries = Object.entries(summary.blockedByBreakdown);
  if (blockedByEntries.length > 0) {
    lines.push('🚫 <b>blockedBy 분포</b>');
    blockedByEntries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
    lines.push('');
  }

  // preflightStage breakdown
  const stageEntries = Object.entries(summary.preflightStageBreakdown);
  if (stageEntries.length > 0) {
    lines.push('🔀 <b>preflightStage 분포</b>');
    stageEntries
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => lines.push(`  • ${k}: ${v}`));
    lines.push('');
  }

  const sourceBreakdown = buildUniversePriceSourceBreakdown(recent);
  if (Object.keys(sourceBreakdown).length > 0) {
    lines.push('Price Sources:');
    Object.entries(sourceBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => lines.push(`  - ${source}: ${count}`));
    lines.push('');
  }

  // recent 5 snapshots
  if (recent.length > 0) {
    lines.push('🕘 <b>최근 snapshot (5건)</b>');
    recent.slice(-5).reverse().forEach((s) => {
      const kst = s.createdAtKst.slice(0, 16).replace('T', ' ');
      const candidates = s.candidateSummaryCount ?? 0;
      lines.push(`  • <code>${kst}</code> ${s.preflightStage} — ${s.blockedBy[0] ?? 'UNKNOWN'} (cand=${candidates})`);
    });
    lines.push('');
  }

  lines.push('<i>preflight abort 로 buyListLoop 까지 가지 못한 universe 를 learning snapshot 으로 보존.</i>');
  lines.push('<i>read-only — LIVE/PAPER/normal shadow/virtual account 영향 0.</i>');
  return lines.join('\n');
}

function buildUniversePriceSourceBreakdown(
  snapshots: CounterfactualUniverseLearningSnapshot[],
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const snapshot of snapshots) {
    const candidates = snapshot.candidates ?? [];
    for (const candidate of candidates) {
      if (
        typeof candidate.lastPrice === 'number' &&
        Number.isFinite(candidate.lastPrice) &&
        candidate.lastPrice > 0
      ) {
        breakdown.SCAN_SNAPSHOT = (breakdown.SCAN_SNAPSHOT ?? 0) + 1;
      } else {
        breakdown.DATA_UNAVAILABLE = (breakdown.DATA_UNAVAILABLE ?? 0) + 1;
      }
    }
    const missing =
      (snapshot.candidateSummaryCount ?? candidates.length) - candidates.length;
    if (missing > 0) {
      breakdown.DATA_UNAVAILABLE = (breakdown.DATA_UNAVAILABLE ?? 0) + missing;
    }
  }
  return breakdown;
}

const shadowUniverse: TelegramCommand = {
  name: '/shadow_universe',
  aliases: ['/counterfactual_universe', '/universe_learning'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    'Counterfactual Universe Learning (ADR-0433) — preflight abort 시 universe-level learning snapshot 통합 진단. read-only.',
  usage: '/shadow_universe',
  async execute({ reply }) {
    try {
      const summary = summarizeCounterfactualUniverseLearningLedger();
      const recent = loadCounterfactualUniverseLearningLedger();
      const message = formatShadowUniverseMessage(summary, recent);
      await reply(message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ Counterfactual Universe Learning Report 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(shadowUniverse);

export default shadowUniverse;
