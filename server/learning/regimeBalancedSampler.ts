// @responsibility regimeBalancedSampler 학습 엔진 모듈
/**
 * regimeBalancedSampler.ts — Idea 3: Stratified Sampling (레짐 균형 학습).
 *
 * 학습의 가장 큰 편향은 "최근 3개월 레짐에 전체 샘플이 쏠려 있다" 는 것. 이 모듈은
 * 레짐별 목표 샘플 수를 선언하고, 현재 보유 데이터의 레짐별 분포를 측정해 "부족한
 * 레짐 구간" 을 가시화한다. 실제 부족 구간 Walk-Forward 리플레이는 기존 인프라
 * (walkForwardValidator) 가 IS/OOS 분리에 이미 사용하므로 본 모듈은 "어느 레짐이
 * 얼마나 부족한가" 의 리포팅에 집중.
 *
 * 출력:
 *   - regimeCoverage(): 각 레짐별 현재 샘플 수 vs 목표, 부족 레짐 리스트
 *   - Telegram 카드용 포매터
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { sendSuggestAlert } from './suggestNotifier.js';
import {
  SUGGEST_REGIME_COVERAGE_RATIO,
  SUGGEST_REGIME_DRY_DAYS,
} from './suggestThresholds.js';

/** 레짐별 목표 샘플 수 — 통계적으로 유의한 비교를 위한 최소치. */
export const REGIME_SAMPLE_TARGETS: Record<string, number> = {
  R1_TURBO:   20,
  R2_BULL:    30,
  R3_EARLY:   25,
  R4_NEUTRAL: 30,
  R5_CAUTION: 20,
  R6_DEFENSE: 15,
};

interface RegimeCoverageEntry {
  regime: string;
  target: number;
  current: number;
  deficit: number;         // max(0, target - current)
  oldestSignalDate?: string;
  newestSignalDate?: string;
}

export interface RegimeCoverageReport {
  entries: RegimeCoverageEntry[];
  totalSamples: number;
  totalTarget: number;
  totalDeficit: number;
  balanceRatio: number;   // totalSamples / totalTarget (1.0 = 완전 충족)
}

/**
 * 현재 누적 RecommendationRecord 를 기반으로 레짐별 커버리지를 계산.
 * status 가 PENDING 인 레코드도 샘플로 집계 (단, 수익률 기반 통계는 WIN/LOSS/EXPIRED 만 사용).
 */
function regimeCoverage(records?: RecommendationRecord[]): RegimeCoverageReport {
  const data = records ?? getRecommendations();
  const entries: RegimeCoverageEntry[] = [];
  let totalSamples = 0;
  let totalTarget = 0;
  let totalDeficit = 0;

  for (const regime of Object.keys(REGIME_SAMPLE_TARGETS)) {
    const target = REGIME_SAMPLE_TARGETS[regime];
    const matched = data.filter(r => r.entryRegime === regime);
    const current = matched.length;
    const deficit = Math.max(0, target - current);
    const oldest = matched.reduce<string | undefined>(
      (min, r) => (!min || r.signalTime < min ? r.signalTime : min), undefined,
    );
    const newest = matched.reduce<string | undefined>(
      (max, r) => (!max || r.signalTime > max ? r.signalTime : max), undefined,
    );
    entries.push({ regime, target, current, deficit, oldestSignalDate: oldest, newestSignalDate: newest });
    totalSamples += current;
    totalTarget  += target;
    totalDeficit += deficit;
  }

  entries.sort((a, b) => b.deficit - a.deficit); // 부족 큰 순

  return {
    entries,
    totalSamples,
    totalTarget,
    totalDeficit,
    balanceRatio: totalTarget > 0 ? totalSamples / totalTarget : 0,
  };
}

export function formatRegimeCoverage(report?: RegimeCoverageReport): string {
  const r = report ?? regimeCoverage();
  const lines = [
    '📊 <b>[레짐 샘플 커버리지]</b>',
    `전체: ${r.totalSamples}/${r.totalTarget} (${(r.balanceRatio * 100).toFixed(0)}%)`,
    '━━━━━━━━━━━━━━━━',
  ];
  for (const e of r.entries) {
    const pct = e.target > 0 ? (e.current / e.target) * 100 : 0;
    const bar = pct >= 100 ? '🟢'
      : pct >= 75 ? '🟡'
      : pct >= 50 ? '🟠'
      : '🔴';
    lines.push(
      `${bar} ${e.regime}: ${e.current}/${e.target} ` +
      `(${pct.toFixed(0)}%)${e.deficit > 0 ? ` · 부족 ${e.deficit}` : ''}`,
    );
  }
  if (r.totalDeficit > 0) {
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push(`<i>총 부족 샘플 ${r.totalDeficit} — Walk-Forward replay 보충 권고</i>`);
  }
  return lines.join('\n');
}

/**
 * ADR-0124 (사용자 4/30 보고): regimeCoverage suggest false positive 차단.
 * 기존 결함 — `history = getRecommendations()` 만 read 라 *실제 진입* (SHADOW/LIVE
 * 거래) 은 카운트 0. 사용자 보고: "실제 진입이 발생했는데도 메시지 출력".
 *
 * 수정: 30일 dry 카운트에 `loadShadowTrades()` 합산 — recommendationTracker 진입 +
 * shadowTradeRepo 진입 양쪽 모두 0 일 때만 dry. SHADOW/LIVE 진입이 발생한 레짐은
 * suggest 발송 자동 차단.
 *
 * ENV `LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED=true` 비상 우회 — 진단 시 사용.
 */
function isRegimeCoverageSuggestDisabled(): boolean {
  return process.env.LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED === 'true';
}

/**
 * Suggest 판정 — (목표 대비 current/target < 50%) 이고 최근 N일간 해당 레짐 진입이 0건이면
 * 가장 부족한 레짐 1건만 suggest 한다. 0건 판정은 signalTime 기반 (KST 날짜가 아니라 ms 기준).
 *
 * ADR-0124: recommendationTracker + shadowTradeRepo 양쪽 SSOT 합산 카운트 — 실제 진입 발생 시 false positive 차단.
 */
export async function evaluateRegimeCoverageSuggestion(now: Date = new Date()): Promise<boolean> {
  try {
    if (isRegimeCoverageSuggestDisabled()) return false;

    const report = regimeCoverage();
    const cutoffMs = now.getTime() - SUGGEST_REGIME_DRY_DAYS * 24 * 3600 * 1000;
    const history = getRecommendations();

    // ADR-0124: shadow trade 영속도 read — 실제 진입한 SHADOW/LIVE 거래 카운트 합산.
    // shadowTradeRepo 의 entryRegime 은 buyPipeline.buildBuyTrade 가 ctx.regime 으로 영속.
    let shadowTrades: Array<{ entryRegime?: string; signalTime: string }> = [];
    try {
      shadowTrades = loadShadowTrades();
    } catch (e) {
      console.warn(
        '[regimeBalancedSampler] loadShadowTrades 실패 — recommendation 만 사용:',
        e instanceof Error ? e.message : String(e),
      );
    }

    const dry = report.entries
      .filter(e => e.target > 0 && e.current / e.target < SUGGEST_REGIME_COVERAGE_RATIO)
      .map(e => {
        const recentRecommendations = history.filter(r =>
          r.entryRegime === e.regime && new Date(r.signalTime).getTime() >= cutoffMs,
        );
        const recentShadowEntries = shadowTrades.filter(s =>
          s.entryRegime === e.regime && new Date(s.signalTime).getTime() >= cutoffMs,
        );
        return {
          entry: e,
          recentCount: recentRecommendations.length + recentShadowEntries.length,
          recommendationCount: recentRecommendations.length,
          shadowCount: recentShadowEntries.length,
        };
      })
      .filter(x => x.recentCount === 0)
      .sort((a, b) => b.entry.deficit - a.entry.deficit);

    if (dry.length === 0) return false;

    const top = dry[0];
    const day = now.toISOString().slice(0, 10);
    const pct = top.entry.target > 0 ? (top.entry.current / top.entry.target) * 100 : 0;

    return await sendSuggestAlert({
      moduleKey: 'regimeCoverage',
      signature: `regime-${top.entry.regime}-${day}`,
      title: `레짐 ${top.entry.regime} 샘플 부족 & ${SUGGEST_REGIME_DRY_DAYS}일 dry`,
      rationale:
        `현재 ${top.entry.current}/${top.entry.target} (${pct.toFixed(0)}%) · ` +
        `최근 ${SUGGEST_REGIME_DRY_DAYS}일 진입 0건 (추천 ${top.recommendationCount}건 + 실거래 ${top.shadowCount}건)`,
      currentValue: `${top.entry.regime} 커버리지 ${pct.toFixed(0)}%`,
      suggestedValue: 'Walk-Forward replay 보충 또는 PROBING 슬롯 확장',
      threshold:
        `current/target<${(SUGGEST_REGIME_COVERAGE_RATIO * 100).toFixed(0)}% & ${SUGGEST_REGIME_DRY_DAYS}일 dry`,
    });
  } catch (e) {
    console.warn(
      '[regimeBalancedSampler] evaluateSuggestion 실패:',
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}
