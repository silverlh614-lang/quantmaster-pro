// @responsibility fiveWhy 학습 엔진 모듈
/**
 * fiveWhy.ts — Five-Why Auto-Interrogator (#2).
 *
 * 각 손절 거래에 대해 5번의 Why 를 순차 질문. 마지막 단계는 반드시 "일반화 가능한 원칙?"
 * 5차 답이 기존 knowledge/*.txt 원칙과 일치하면 🟢, 새 발견이면 🟡 로 태그.
 * 🟡 는 rag-embeddings.json 에 자동 추가되어 내일 판단의 맥락이 된다.
 *
 * 호출 비용:
 *   - 손절 거래 1건당 Gemini 5회 (temperature=0.2 고정).
 *   - Budget Governor 가 상한을 결정 — 초과 시 호출 생략.
 */

import { callReflectionGemini } from './reflectionGemini.js';
import { queryRag } from '../../rag/localRag.js';
import type { FiveWhyResult, FiveWhyStep } from '../reflectionTypes.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

const WHY_QUESTIONS: Array<(prior: string) => string> = [
  () => '이 손절의 직접 원인은 무엇인가?',
  (prior) => `직전 답: "${prior}". 그 원인의 원인은 무엇인가?`,
  (prior) => `직전 답: "${prior}". 더 깊은 원인은 무엇인가?`,
  (prior) => `직전 답: "${prior}". 이 패턴이 처음인가, 과거에도 있었는가?`,
  (prior) => `직전 답: "${prior}". 이것이 일반화 가능한 원칙인가? 있다면 한 문장으로.`,
];

function buildFirstPrompt(trade: ServerShadowTrade): string {
  const summary = [
    `종목: ${trade.stockName}(${trade.stockCode})`,
    `진입: ${trade.shadowEntryPrice.toLocaleString()}원`,
    trade.exitPrice != null ? `청산: ${trade.exitPrice.toLocaleString()}원` : '청산: N/A',
    `손절선: ${trade.stopLoss.toLocaleString()}원`,
    `수익률: ${(trade.returnPct ?? 0).toFixed(2)}%`,
    trade.exitRuleTag ? `청산 규칙: ${trade.exitRuleTag}` : '',
    trade.preMortem ? `Pre-Mortem 체크: ${trade.preMortem}` : '',
  ].filter(Boolean).join('\n');
  return `다음 손절 거래에 대한 Five-Why 분석의 1단계 답을 한국어 1~2문장으로 작성하라.\n\n${summary}\n\nQ1: ${WHY_QUESTIONS[0]('')}`;
}

function buildFollowUpPrompt(depth: 2 | 3 | 4 | 5, priorAnswer: string): string {
  return `Five-Why 분석 ${depth}단계. 이전 답을 받아 한 단계 더 깊이 파고들어라. 한국어 1~2문장.\n\nQ${depth}: ${WHY_QUESTIONS[depth - 1](priorAnswer)}`;
}

/** 5차 답이 기존 원칙과 일치하는지 RAG 유사도 검색. */
async function classifyPrinciple(fifthAnswer: string): Promise<'GREEN_EXISTING' | 'YELLOW_NEW_INSIGHT'> {
  try {
    const hits = await queryRag(fifthAnswer, 3);
    // 코사인 유사도 0.75 이상 히트가 있으면 기존 원칙과 일치 판정.
    const existing = hits.find((h) => (h.score ?? 0) >= 0.75);
    return existing ? 'GREEN_EXISTING' : 'YELLOW_NEW_INSIGHT';
  } catch {
    // RAG 인덱스 미구축 — 보수적으로 YELLOW 로 태그 (검토 유도)
    return 'YELLOW_NEW_INSIGHT';
  }
}

export interface RunFiveWhyOptions {
  /** 최대 Gemini 호출 횟수 (Budget Governor 에서 결정) */
  maxGeminiCalls: number;
  /** 거래 1건당 호출 callback — 소비량 추적용 */
  onCall?: (tokensEstimate: number) => void;
}

/**
 * 손절 거래 1건에 대한 5-Why 심문을 수행한다.
 * - maxGeminiCalls 에 도달하면 중간에 종료 → tag 는 YELLOW (검토 유도).
 * - Gemini 응답 null 이면 해당 depth 에 "응답 없음" 기록 후 계속.
 */
export async function runFiveWhyFor(
  trade: ServerShadowTrade,
  opts: RunFiveWhyOptions,
): Promise<FiveWhyResult | null> {
  if (opts.maxGeminiCalls < 1) return null;

  const steps: FiveWhyStep[] = [];
  let priorAnswer = '';
  let callsUsed = 0;

  for (const depth of [1, 2, 3, 4, 5] as const) {
    if (callsUsed >= opts.maxGeminiCalls) break;
    const prompt = depth === 1 ? buildFirstPrompt(trade) : buildFollowUpPrompt(depth, priorAnswer);
    const answer = await callReflectionGemini(prompt, `fiveWhy[${trade.id}#${depth}]`);
    callsUsed++;
    opts.onCall?.(Math.ceil(prompt.length / 3) + 200); // 개략적 토큰 추정
    const safe = answer?.trim() || '응답 없음';
    steps.push({ depth, question: WHY_QUESTIONS[depth - 1](priorAnswer), answer: safe });
    priorAnswer = safe;
  }

  // 5단계 모두 완료된 경우에만 원칙 분류 — 중단 시 YELLOW (검토 유도).
  const fifth = steps.find((s) => s.depth === 5);
  const tag: 'GREEN_EXISTING' | 'YELLOW_NEW_INSIGHT' =
    fifth && fifth.answer !== '응답 없음'
      ? await classifyPrinciple(fifth.answer)
      : 'YELLOW_NEW_INSIGHT';

  return {
    tradeId:   trade.id,
    stockCode: trade.stockCode,
    steps,
    tag,
    ...(tag === 'YELLOW_NEW_INSIGHT' && fifth ? { generalPrinciple: fifth.answer } : {}),
  };
}
