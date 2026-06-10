// @responsibility Shadow 학습 일일 리포트 요약 빌더 — Rejection + Twin 1~2줄 압축.
/**
 * shadowLearningSummary.ts — 일일 리포트 Shadow 학습 라인 빌더
 *
 * `generateDailyReport` 가 호출하는 1~2줄 요약 — Rejection (false negative rate)
 * + Twin Leaderboard (CURRENT vs Top Twin) 압축 표기.
 *
 * - 외부 의존성: `rejectionShadowTracker` + `counterfactualTwinPortfolio` +
 *   `shadowTradeRepo.aggregateFillStats` (ADR-0124 PR-H BE 표기 — 모두 read-only)
 * - LIVE 매매 본체 무영향
 * - graceful fallback — 데이터 부족 시 빈 문자열 반환 (호출자가 라인 자체 생략 가능)
 */

import {
  ALL_TWIN_KEYS,
  compareTwinsVsReal,
  type TwinKey,
} from '../learning/counterfactualTwinPortfolio.js';
import {
  summarizeRejectionShadow,
  type RejectionShadowSummary,
} from '../learning/rejectionShadowTracker.js';
import { aggregateFillStats, loadShadowTrades } from '../persistence/shadowTradeRepo.js';

const TWIN_LABEL: Record<TwinKey, string> = {
  AGGRESSIVE: 'AGGR',
  DISCIPLINED: 'DISC',
  EQUAL_WEIGHT: 'EQW',
};

export interface ShadowLearningSummary {
  /** 일일 리포트 본문 라인 (빈 문자열 시 호출자가 라인 생략) */
  reportLine: string;
  /** narrative dataBlock 보조 라인 (빈 문자열 가능) */
  narrativeLine: string;
  /** raw 데이터 — 단위 테스트 / 진단 용 */
  rejectionSummary: RejectionShadowSummary;
  /** CURRENT 대비 우월한 Twin 키 (없으면 null) */
  topTwin: TwinKey | null;
  /** Top Twin 누적 수익률 vs CURRENT 격차 (%p, 양수 = Twin 우월) */
  topTwinDelta: number;
  /**
   * ADR-0124 (PR-H): 본절 fill 수 (-0.5 ≤ pnlPct ≤ +0.5, ADR-0112 정합).
   * `aggregateFillStats` SSOT (전체 기간 — shadowProgressBriefing 일일 브리핑과 동일 단위).
   * 옵셔널 — 기존 호출자 무영향. BE_CLASSIFICATION_DISABLED=true 시 0 → 표기 자동 silent.
   */
  beFills?: number;
}

/**
 * Shadow 학습 데이터 요약 — 일일 리포트용.
 *
 * @param realCumReturnPct CURRENT (LIVE) 누적 수익률 (`monthlyStats.compoundReturn`)
 *
 * 반환:
 *   - reportLine: "🌑 Shadow: Rejection 8건 (alpha 누락 25%) | AGGR +9.4% (+5.2%p vs CURRENT)"
 *   - narrativeLine: 동일 컨텍스트 Gemini 프롬프트 dataBlock 용
 *   - 데이터 부족 시 빈 문자열 반환
 */
export function buildShadowLearningSummary(realCumReturnPct: number): ShadowLearningSummary {
  const rejectionSummary = summarizeRejectionShadow();
  const comparison = compareTwinsVsReal(realCumReturnPct);

  // ADR-0124 (PR-H): 본절 fill 가시화 — aggregateFillStats SSOT (read-only, 전체 기간).
  // BE_CLASSIFICATION_DISABLED=true 시 SSOT 가 0 반환 → `beFills > 0` 분기로 자동 silent.
  const fillAgg = aggregateFillStats(loadShadowTrades());
  const beFills = fillAgg.beFills ?? 0;

  // Twin 중 가장 우월한 (cumReturnPct 최대 + CURRENT 보다 우월) 후보 추출
  let topTwin: TwinKey | null = null;
  let topCum = realCumReturnPct;
  for (const k of ALL_TWIN_KEYS) {
    const cum = comparison.perTwin[k].cumReturnPct;
    if (cum > topCum) {
      topCum = cum;
      topTwin = k;
    }
  }
  const topTwinDelta = topTwin ? topCum - realCumReturnPct : 0;

  // Rejection 요약 (reliable=true 일 때만 false negative rate 노출)
  const rejPart = rejectionSummary.totalCount === 0
    ? '데이터 부족'
    : rejectionSummary.reliable
      ? `Rejection ${rejectionSummary.closedCount}건 (alpha 누락 ${(rejectionSummary.falseNegativeRate * 100).toFixed(0)}%)`
      : `Rejection ${rejectionSummary.totalCount}건 (표본 부족)`;

  // Twin 요약 — top twin 이 있으면 표기, 없으면 "Twin 우월 없음"
  const twinPart = topTwin
    ? `${TWIN_LABEL[topTwin]} ${topCum >= 0 ? '+' : ''}${topCum.toFixed(2)}% (+${topTwinDelta.toFixed(2)}%p vs CURRENT)`
    : 'Twin 우월 없음';

  // ADR-0124 (PR-H): 본절 표기 — beFills > 0 일 때만 노출 (운영자 인지 부담 ↓,
  // ENV BE_CLASSIFICATION_DISABLED=true 시 자동 silent — 기존 표기 100% 보존).
  const bePart = beFills > 0 ? ` | 본절 fill ${beFills}건` : '';

  // 데이터가 모두 부족하면 빈 라인 반환 (호출자가 생략)
  // ADR-0124: hasAnyData 판정은 Rejection + Twin 기준 그대로 — BE 단독으로는
  // 라인을 만들지 않는다 (기존 graceful 빈 문자열 동작 byte 보존).
  const hasAnyData = rejectionSummary.totalCount > 0
    || comparison.perTwin.AGGRESSIVE.closedCount > 0
    || comparison.perTwin.DISCIPLINED.closedCount > 0
    || comparison.perTwin.EQUAL_WEIGHT.closedCount > 0;
  if (!hasAnyData) {
    return {
      reportLine: '',
      narrativeLine: '',
      rejectionSummary,
      topTwin: null,
      topTwinDelta: 0,
      beFills,
    };
  }

  return {
    reportLine: `🌑 Shadow: ${rejPart} | ${twinPart}${bePart}`,
    narrativeLine: `Shadow 학습 — ${rejPart}, Twin 비교: ${twinPart}${beFills > 0 ? `, 본절 fill ${beFills}건` : ''}`,
    rejectionSummary,
    topTwin,
    topTwinDelta,
    beFills,
  };
}
