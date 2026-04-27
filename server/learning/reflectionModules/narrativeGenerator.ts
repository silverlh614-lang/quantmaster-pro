// @responsibility narrativeGenerator 학습 엔진 모듈
/**
 * narrativeGenerator.ts — System Narrative Generator (#13).
 *
 * 일일 반성을 숫자가 아닌 200~300자 서사로 생성.
 * 30일 누적 → 참뮌 본인의 투자 다이어리. 몇 달 뒤 다시 읽으면 진화 궤적이 보임.
 *
 * 호출 비용: Gemini 1회 (temperature 낮음, maxOutputTokens 400 정도).
 * Budget Governor 의 호출 상한에서 차감된다.
 */

import { callReflectionGemini } from './reflectionGemini.js';
import type { ReflectionReport } from '../reflectionTypes.js';

export interface NarrativeContext {
  /** 오늘의 레짐 요약 (R2_BULL 등 짧은 라벨) */
  regime?: string;
  /** 오늘의 Ghost vs Real verdict 요약 */
  ghostVerdict?: string;
  /** 이번 주 누적 교훈 (distilled-weekly 최신 1~2줄) */
  recentDistilled?: string;
}

export interface GenerateNarrativeOptions {
  maxGeminiCalls: number;
  onCall?: (tokensEstimate: number) => void;
}

export async function generateSystemNarrative(
  report: ReflectionReport,
  context: NarrativeContext,
  opts: GenerateNarrativeOptions,
): Promise<string | null> {
  if (opts.maxGeminiCalls < 1) return null;

  const lessonBullets = report.keyLessons.slice(0, 3).map((c) => `- ${c.text}`).join('\n');
  const adjustBullets = report.tomorrowAdjustments.slice(0, 2).map((c) => `- ${c.text}`).join('\n');
  const confession = report.conditionConfession?.slice(0, 2).map((c) =>
    `조건 ${c.conditionId} 허위율 ${(c.falseSignalScore * 100).toFixed(0)}%`,
  ).join(', ');
  const stressTested = report.personaReview?.stressTested === true
    ? '4명 페르소나 모두 GREEN'
    : report.personaReview?.counterExample
      ? `반례: ${report.personaReview.counterExample}`
      : '';

  const prompt = [
    '너는 한국 주식 트레이더 "참뮌"의 투자 다이어리 작가이다.',
    '오늘 하루를 200~300자의 한국어 서사로 작성하라. 감정적 수식어 최소화, 사실 중심.',
    '',
    `날짜: ${report.date}`,
    `판정: ${report.dailyVerdict}`,
    context.regime ? `매크로 레짐: ${context.regime}` : '',
    context.ghostVerdict ? `고스트 판정: ${context.ghostVerdict}` : '',
    '',
    '## 핵심 교훈',
    lessonBullets || '(없음)',
    '',
    '## 내일 조정',
    adjustBullets || '(없음)',
    '',
    confession ? `## 조건 참회: ${confession}` : '',
    stressTested ? `## 스트레스 검증: ${stressTested}` : '',
    context.recentDistilled ? `## 최근 축적 교훈: ${context.recentDistilled}` : '',
    '',
    '출력: 본문만 200~300자. 머리표/번호 금지. 따옴표 금지.',
  ].filter(Boolean).join('\n');

  opts.onCall?.(Math.ceil(prompt.length / 3) + 400);
  const raw = await callReflectionGemini(prompt, 'nightlyReflection.narrative');
  if (!raw) return null;

  // 후처리 — 머리표/따옴표 제거 + 300자 트리밍
  const cleaned = raw
    .trim()
    .replace(/^["'「]/, '')
    .replace(/["'」]$/, '')
    .replace(/^\s*[-•]\s*/gm, '');
  return cleaned.length <= 300 ? cleaned : cleaned.slice(0, 297) + '...';
}
