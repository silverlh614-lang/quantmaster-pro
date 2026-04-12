/**
 * contradictionDetector.ts — 조건 간 상충 감지기 (Contradiction Detector)
 *
 * 핵심 개념:
 *   Gate 조건들이 서로 반대 신호를 동시에 보내면 점수를 합산하더라도
 *   신호 일관성이 훼손된다. 상충 쌍을 감지하고 Gate 3 점수 -20% 패널티와
 *   STRONG BUY 등급 금지를 자동 적용한다.
 *
 * 상충 쌍 정의:
 *   1. RSI 과매수(FOMO 고점) ↔ 터틀 돌파 신호
 *      psychologicalObjectivity(19) < 5 (과매수/FOMO 구간) AND turtleBreakout(20) ≥ 5
 *   2. 다이버전스 경고 ↔ 거래량 급증 돌파
 *      divergenceCheck(26) < 5 (다이버전스 경고 존재) AND volumeSurgeVerified(11) ≥ 5
 *   3. 엘리엇 5파 완성(비우호적 파동) ↔ VCP 매수 신호
 *      elliottWaveVerified(22) < 5 (5파 완성/비우호적 파동) AND vcpPattern(25) ≥ 5
 *
 * 핵심 통찰: 신호의 일관성 자체가 품질 지표다. 깨끗한 신호일 때만 최고 등급을 허용한다.
 */

import type { ConditionId, ContradictionDetectionResult, ContradictionPairResult } from '../../types/quant';

// ─── 상충 감지 임계값 ─────────────────────────────────────────────────────────

/** 조건 '통과' 기준 점수 (이 이상이면 신호 발동) */
const PASS_THRESHOLD = 5;

/** Gate 3 점수 패널티 배율 (1개 이상 상충 쌍 감지 시 적용) */
export const CONTRADICTION_GATE3_PENALTY = 0.8; // -20%

// ─── 내부 상충 쌍 정의 ───────────────────────────────────────────────────────

interface ContradictionPairDef {
  id: string;
  name: string;
  conditionAId: ConditionId;
  conditionAName: string;
  conditionAWarnWhen: 'LOW' | 'HIGH';
  conditionBId: ConditionId;
  conditionBName: string;
  conditionBWarnWhen: 'LOW' | 'HIGH';
  description: string;
}

const CONTRADICTION_PAIR_DEFS: ContradictionPairDef[] = [
  {
    id: 'RSI_OVERBOUGHT_VS_TURTLE',
    name: 'RSI 과매수 ↔ 터틀 돌파',
    conditionAId: 19,
    conditionAName: '심리적 객관성 (FOMO)',
    conditionAWarnWhen: 'LOW',   // < 5 → FOMO 고점 / RSI 과매수 구간
    conditionBId: 20,
    conditionBName: '터틀 돌파',
    conditionBWarnWhen: 'HIGH',  // ≥ 5 → 터틀 돌파 신호
    description: 'RSI 과매수(FOMO 고점) 구간에서 터틀 신고가 돌파가 동시 발생 — 추격 매수 위험',
  },
  {
    id: 'DIVERGENCE_VS_VOLUME_SURGE',
    name: '다이버전스 경고 ↔ 거래량 급증',
    conditionAId: 26,
    conditionAName: '다이버전스 (경고)',
    conditionAWarnWhen: 'LOW',   // < 5 → 다이버전스 경고 존재
    conditionBId: 11,
    conditionBName: '거래량 급증',
    conditionBWarnWhen: 'HIGH',  // ≥ 5 → 거래량 급증 돌파
    description: '보조지표 다이버전스 경고가 존재하는데 거래량 급증 돌파가 동시 발생 — 가짜 돌파 가능성',
  },
  {
    id: 'ELLIOTT_5WAVE_VS_VCP',
    name: '엘리엇 5파 완성 ↔ VCP 매수',
    conditionAId: 22,
    conditionAName: '엘리엇 파동 (비우호적)',
    conditionAWarnWhen: 'LOW',   // < 5 → 5파 완성/비우호적 파동 위치
    conditionBId: 25,
    conditionBName: 'VCP 매수 신호',
    conditionBWarnWhen: 'HIGH',  // ≥ 5 → VCP 매수 신호 발동
    description: '엘리엇 상승 5파 완성(하락 경고) 구간에서 VCP 매수 신호가 동시 발생 — 사이클 전환 위험',
  },
];

// ─── 핵심 공개 API ──────────────────────────────────────────────────────────────

/**
 * 27조건 점수 벡터를 입력받아 상충 쌍을 감지하고 결과를 반환한다.
 *
 * @param conditionScores — ConditionId → 점수(0~10) 매핑
 */
export function detectContradictions(
  conditionScores: Record<ConditionId, number>,
): ContradictionDetectionResult {
  const pairs: ContradictionPairResult[] = CONTRADICTION_PAIR_DEFS.map((def) => {
    const scoreA = conditionScores[def.conditionAId] ?? 0;
    const scoreB = conditionScores[def.conditionBId] ?? 0;

    // 상충 감지: A가 경고 신호이고 B가 매수 신호인 경우
    const aTriggered =
      def.conditionAWarnWhen === 'LOW' ? scoreA < PASS_THRESHOLD : scoreA >= PASS_THRESHOLD;
    const bTriggered =
      def.conditionBWarnWhen === 'HIGH' ? scoreB >= PASS_THRESHOLD : scoreB < PASS_THRESHOLD;

    const detected = aTriggered && bTriggered;

    return {
      id: def.id,
      name: def.name,
      conditionA: {
        id: def.conditionAId,
        name: def.conditionAName,
        score: scoreA,
        warnWhen: def.conditionAWarnWhen,
      },
      conditionB: {
        id: def.conditionBId,
        name: def.conditionBName,
        score: scoreB,
        warnWhen: def.conditionBWarnWhen,
      },
      detected,
      description: def.description,
    };
  });

  const detectedCount = pairs.filter((p) => p.detected).length;
  const hasContradiction = detectedCount > 0;
  const gate3PenaltyMultiplier = hasContradiction ? CONTRADICTION_GATE3_PENALTY : 1.0;
  const strongBuyBlocked = hasContradiction;

  let message: string;
  if (!hasContradiction) {
    message = '상충 신호 없음 — 조건 간 일관성 확인. 최고 등급 허용.';
  } else {
    const names = pairs.filter((p) => p.detected).map((p) => p.name).join(', ');
    message =
      `⚡ 상충 신호 ${detectedCount}쌍 감지: ${names} ` +
      `→ Gate 3 점수 -20% 패널티 적용, STRONG BUY 등급 금지.`;
  }

  return {
    contradictionPairs: pairs,
    detectedCount,
    hasContradiction,
    gate3PenaltyMultiplier,
    strongBuyBlocked,
    message,
  };
}
