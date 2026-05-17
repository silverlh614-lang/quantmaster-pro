// @responsibility DART AI 자문해석 어댑터
import { aiEstimatedFact, summarizeDataConfidence } from './dartDataConfidence.js';
import type { DartAiInterpretation, DartCatalystCategory, DartExtractedFact } from './dartPreNewsTypes.js';

export interface DartAiInterpretationInput {
  disclosureTitle: string;
  disclosureType: string;
  extractedFacts: DartExtractedFact[];
  catalystCategory: DartCatalystCategory;
  catalystScore: number;
  riskScore: number;
  missingData: string[];
}

export function buildDartAiInterpretation(input: DartAiInterpretationInput): DartAiInterpretation {
  const confidence = summarizeDataConfidence(input.extractedFacts);
  const riskMode = input.riskScore >= input.catalystScore;
  return {
    summary: `${input.disclosureTitle} 공시는 ${input.catalystCategory} 후보로 분류되었습니다. 이 문장은 AI_ESTIMATED 자문 요약입니다.`,
    possibleMarketImplication: riskMode
      ? ['리스크 공시로 후속 정정, 자금조달 조건, 지분 변동 확인이 필요합니다.']
      : ['뉴스 확산 전 구조적 촉매 후보일 수 있으나 매수 신호로 사용하지 않습니다.'],
    cautionPoints: [
      '매수/매도 추천, 목표가, 손절가를 생성하지 않습니다.',
      `검증 fact=${confidence.verified}, 누락 fact=${confidence.missing} 상태이므로 DART 원문 재확인이 필요합니다.`,
    ],
    followUpChecks: input.missingData.length > 0
      ? input.missingData.map((m) => `${m} 보강 필요`)
      : ['공시 원문 숫자와 추후 뉴스/가격 반응 사후 추적'],
    confidence: 'AI_ESTIMATED',
  };
}

export function aiInterpretationConfidenceFact(): DartExtractedFact {
  return aiEstimatedFact('aiInterpretation', 'AI 해석 신뢰도', 'AI_ESTIMATED');
}
