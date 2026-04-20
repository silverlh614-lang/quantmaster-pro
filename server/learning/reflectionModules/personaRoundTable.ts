/**
 * personaRoundTable.ts — Persona Round-Table (#4).
 *
 * 하나의 거래에 대해 4명 페르소나가 독립 평가:
 *   - QUANT_LEAD     : 데이터·통계 관점
 *   - RISK_MANAGER   : 최악의 시나리오 관점
 *   - BEHAVIORAL     : 인지 편향 관점 (보유 효과, 후회 회피 등)
 *   - SKEPTIC        : 반대 증거 제시
 *
 * 4명 모두 🟢 → "Stress-tested" 로 승격.
 * 🔴 가 1명이라도 → counterExample 을 RAG 반례 사례로 저장 (Phase 3 합류).
 *
 * 호출: Gemini 4회 (거래 1건당). 병렬 실행 — 비용 동일하되 latency 절감.
 */

import { callReflectionGemini } from './reflectionGemini.js';
import type {
  PersonaReviewSummary,
  PersonaRole,
  PersonaSignal,
  PersonaVote,
} from '../reflectionTypes.js';
import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';

const PERSONA_INSTRUCTIONS: Record<PersonaRole, string> = {
  QUANT_LEAD:
    '너는 수석 퀀트이다. 데이터·통계·조건 기여도 관점에서 이 거래를 평가하라. 조건 점수 분포, 진입 타이밍의 통계적 우위 유무를 본다.',
  RISK_MANAGER:
    '너는 리스크 매니저이다. 최악의 시나리오, 손절 크기, 포지션 사이징이 합당했는지 본다. -10% 시나리오에 대한 방어력을 평가하라.',
  BEHAVIORAL:
    '너는 행동경제학자이다. 이 거래에 어떤 인지 편향(보유 효과·후회 회피·확신 편향·군중 추종 등)이 작용했는지 검출하라.',
  SKEPTIC:
    '너는 회의론자이다. 이 거래 결정의 논리에 반대되는 증거가 있었는지, 간과된 반례가 있었는지 찾아내라.',
};

function buildPrompt(role: PersonaRole, trade: ServerShadowTrade): string {
  const instructions = PERSONA_INSTRUCTIONS[role];
  const summary = [
    `거래 ID: ${trade.id}`,
    `종목: ${trade.stockName}(${trade.stockCode})`,
    `상태: ${trade.status}`,
    `진입가: ${trade.shadowEntryPrice.toLocaleString()}원`,
    trade.exitPrice != null ? `청산가: ${trade.exitPrice.toLocaleString()}원` : '',
    `손절선: ${trade.stopLoss.toLocaleString()}원`,
    `목표가: ${trade.targetPrice.toLocaleString()}원`,
    `수익률: ${(trade.returnPct ?? 0).toFixed(2)}%`,
    trade.entryRegime ? `진입 레짐: ${trade.entryRegime}` : '',
    trade.exitRuleTag ? `청산 규칙: ${trade.exitRuleTag}` : '',
    trade.preMortem ? `Pre-Mortem: ${trade.preMortem}` : '',
  ].filter(Boolean).join('\n');

  return [
    instructions,
    '',
    '아래 거래를 평가하여 JSON 으로만 답하라. 다른 텍스트 금지.',
    '스키마: {"signal": "GREEN" | "YELLOW" | "RED", "comment": "1~2문장 한국어"}',
    '',
    summary,
  ].join('\n');
}

function parseVote(role: PersonaRole, raw: string | null): PersonaVote {
  const fallback: PersonaVote = { role, signal: 'YELLOW', comment: '응답 없음 — 검토 필요.' };
  if (!raw) return fallback;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) return fallback;
  try {
    const parsed = JSON.parse(cleaned.slice(first, last + 1)) as { signal?: string; comment?: string };
    const signal = (['GREEN', 'YELLOW', 'RED'] as const).includes(parsed.signal as PersonaSignal)
      ? (parsed.signal as PersonaSignal)
      : 'YELLOW';
    const comment = typeof parsed.comment === 'string' && parsed.comment.trim().length > 0
      ? parsed.comment.trim()
      : '코멘트 없음.';
    return { role, signal, comment };
  } catch {
    return fallback;
  }
}

export interface RunPersonaOptions {
  /** 전체 페르소나 라운드에 사용 가능한 Gemini 호출 상한 */
  maxGeminiCalls: number;
  onCall?: (tokensEstimate: number) => void;
}

const ALL_ROLES: PersonaRole[] = ['QUANT_LEAD', 'RISK_MANAGER', 'BEHAVIORAL', 'SKEPTIC'];

export async function runPersonaRoundTable(
  trade: ServerShadowTrade,
  opts: RunPersonaOptions,
): Promise<PersonaReviewSummary | null> {
  const allow = Math.min(ALL_ROLES.length, Math.max(0, opts.maxGeminiCalls));
  if (allow === 0) return null;

  const roles = ALL_ROLES.slice(0, allow);
  const prompts = roles.map((role) => ({ role, prompt: buildPrompt(role, trade) }));
  const responses = await Promise.all(
    prompts.map(async ({ role, prompt }) => {
      const raw = await callReflectionGemini(prompt, `personaRoundTable[${trade.id}:${role}]`);
      opts.onCall?.(Math.ceil(prompt.length / 3) + 200);
      return parseVote(role, raw);
    }),
  );

  const allGreen = responses.length === ALL_ROLES.length && responses.every((v) => v.signal === 'GREEN');
  const red = responses.find((v) => v.signal === 'RED');

  return {
    tradeId: trade.id,
    votes:   responses,
    stressTested: allGreen,
    ...(red ? { counterExample: red.comment } : {}),
  };
}
