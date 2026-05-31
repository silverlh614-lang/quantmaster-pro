// @responsibility 종목 분석 표시 정본(SSOT) — deep-analysis 위젯이 단일 통로로 읽는 파생 뷰모델
/**
 * 종목 상세/검색 화면의 모든 표시 위젯(레이더·체크리스트 램프·게이트·점수·합치도)이
 * **하나의 정본**에서 파생값을 읽도록 통일한다. 위젯이 stock.checklist(truthy)·
 * aiConvictionScore.factors·gateEvaluation 을 제각각 다르게 읽어 서로 안 맞던 문제를 제거.
 *
 * 가격이 `usePriceCanon` 정본을 쓰는 것과 동일 철학. 본 모듈은 순수 함수 — 단위 테스트 대상.
 *
 * 조건 3-상태(정직성): Gemini 가 checklist 를 거의 다 true 로 채우므로 단순 통과/실패로는
 * 신뢰가 안 된다. 실데이터 검증(conditionSourceTiers/휴리스틱) 여부로 3-상태 구분:
 *   - VERIFIED_PASS : 충족 + 실데이터(DART/KRX/계산) 검증
 *   - AI_PASS       : 충족 but AI 추정만 (미검증)
 *   - FAIL          : 미충족
 */
import type { StockRecommendation } from './types';
import { isChecklistConditionMet } from '../../constants/gateConfig';
import { resolveConditionTier, isVerifiedTier } from '../../utils/dataQualityClassifier';
import { getQuantGateScore, classifyScoreConcordance, type ScoreConcordance } from '../../utils/recommendationScore';

export type ConditionDisplayStatus = 'VERIFIED_PASS' | 'AI_PASS' | 'FAIL';

export interface ConditionView {
  key: string;
  met: boolean;
  verified: boolean;
  status: ConditionDisplayStatus;
}

export interface RadarAxis {
  subject: string;
  /** 0~100 — 카테고리 내 '검증+충족' 비율 (AI 추정 제외). */
  A: number;
  fullMark: 100;
}

export interface StockAnalysisCanon {
  conditions: Record<string, ConditionView>;
  /** 충족(AI 추정 포함) 조건 수. */
  metCount: number;
  /** 실데이터 검증+충족 조건 수 (신뢰 가능 헤더 카운트). */
  verifiedPassCount: number;
  radar: RadarAxis[];
  /** 0~100 Gemini 정성 점수. */
  aiScore: number;
  /** 0~100 Quant(게이트) 점수 — gateEvaluation 없으면 confidence/ai 로 fallback (절대 null 아님). */
  quantScore: number;
  /** 표시용 최종 점수 (= quantScore). */
  finalScore: number;
  concordance: ScoreConcordance;
}

// 레이더 카테고리 → 27조건 매핑 (정본). 기존 MasterRadarChart 정의를 이리로 통일.
export const RADAR_CATEGORIES: ReadonlyArray<{ name: string; keys: readonly string[] }> = [
  { name: '기본적 분석', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration', 'interestCoverage', 'economicMoatVerified'] },
  { name: '기술적 분석', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'vcpPattern', 'divergenceCheck'] },
  { name: '수급 분석', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
  { name: '시장 주도력', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
  { name: '전략/심리', keys: ['mechanicalStop', 'psychologicalObjectivity', 'catalystAnalysis'] },
];

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}

/** 단일 조건의 표시 상태 (정본). */
export function conditionView(stock: StockRecommendation, key: string): ConditionView {
  const k = key as keyof StockRecommendation['checklist'];
  const met = isChecklistConditionMet(stock?.checklist?.[k]);
  const verified = isVerifiedTier(resolveConditionTier(stock, k));
  const status: ConditionDisplayStatus = !met ? 'FAIL' : verified ? 'VERIFIED_PASS' : 'AI_PASS';
  return { key, met, verified, status };
}

/** 종목 분석 표시 정본 빌드 — 모든 위젯의 단일 소스. */
export function buildStockAnalysisCanon(stock: StockRecommendation): StockAnalysisCanon {
  const cl = (stock?.checklist ?? {}) as Record<string, unknown>;
  const conditions: Record<string, ConditionView> = {};
  for (const key of Object.keys(cl)) conditions[key] = conditionView(stock, key);

  const all = Object.values(conditions);
  const metCount = all.filter((c) => c.met).length;
  const verifiedPassCount = all.filter((c) => c.status === 'VERIFIED_PASS').length;

  // 가중 점수: 검증통과=1.0 · AI추정통과=0.5 · 미달=0. 검증-only(0/27 빈 레이더)와 truthy
  // (전부 100%) 의 양극단을 피해, AI 추정도 절반은 반영하되 실데이터일수록 더 차오르게 한다.
  const radar: RadarAxis[] = RADAR_CATEGORIES.map((cat) => {
    const score = cat.keys.reduce((sum, key) => {
      const s = (conditions[key] ?? conditionView(stock, key)).status;
      return sum + (s === 'VERIFIED_PASS' ? 1 : s === 'AI_PASS' ? 0.5 : 0);
    }, 0);
    return { subject: cat.name, A: Math.round((score / cat.keys.length) * 100), fullMark: 100 };
  });

  const aiScore = clamp(stock?.aiConvictionScore?.totalScore ?? 0);
  // Quant 점수 정본: gate 기반 → 없으면 confidenceScore → 그래도 없으면 ai (표시 누락 방지).
  const quant = getQuantGateScore(stock);
  const quantScore = quant
    ? clamp(quant.normalized)
    : typeof stock?.confidenceScore === 'number'
      ? clamp(stock.confidenceScore)
      : aiScore;
  const concordance = classifyScoreConcordance(aiScore, quantScore);

  return {
    conditions,
    metCount,
    verifiedPassCount,
    radar,
    aiScore,
    quantScore,
    finalScore: quantScore,
    concordance,
  };
}
