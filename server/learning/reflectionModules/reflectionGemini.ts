// @responsibility reflectionGemini 학습 엔진 모듈
/**
 * reflectionGemini.ts — Reflection Engine 전용 Gemini 호출 래퍼.
 *
 * 역할 (#14 Integrity Guard 연장):
 *   - 반성 엔진의 모든 LLM 호출에 고정 temperature=0.2 를 적용해
 *     창의성 최소화 → 할루시네이션 감소.
 *   - aiProvider 경유 (config 시) — fallback 은 기본 callGemini (temperature 0.4).
 *
 * 호출자:
 *   mainReflection / fiveWhy / personaRoundTable / narrativeGenerator /
 *   silentKnowledgeDistillation.
 */

import { callGemini } from '../../clients/geminiClient.js';
import { getAiProvider } from '../../ai/aiProvider.js';
import {
  REFLECTION_TEMPERATURE,
  REFLECTION_MAX_OUTPUT_TOKENS,
} from '../reflectionIntegrity.js';

/**
 * temperature=0.2 고정 Gemini 호출.
 * 반환: 텍스트 또는 null (네트워크·예산·파싱 실패 모두 null).
 *
 * ADR-0009: reflection 프롬프트는 JSON 스키마 지시문을 자체 포함하므로 페르소나
 *           prepend 및 응답 서문 stripper 를 모두 OFF 해 JSON 원문을 그대로 돌려받는다.
 *           응답 토큰 상한은 4096 (reflectionIntegrity.REFLECTION_MAX_OUTPUT_TOKENS).
 *           fallback 은 API 키 미설정 등 provider 미구성 경로 전용으로, 기본 옵션(2048,
 *           persona prepend) 이 적용되지만 실제 운영에서는 provider 경로가 항상 우선한다.
 */
export async function callReflectionGemini(
  prompt: string,
  caller: string,
): Promise<string | null> {
  try {
    const provider = getAiProvider();
    if (provider && provider.isConfigured()) {
      return await provider.textOnly(prompt, {
        caller,
        temperature: REFLECTION_TEMPERATURE,
        maxOutputTokens: REFLECTION_MAX_OUTPUT_TOKENS,
        prependPersona: false,
        stripPreamble: false,
      });
    }
  } catch (e) {
    console.warn(`[ReflectionGemini/${caller}] provider 경로 실패, callGemini fallback:`, e instanceof Error ? e.message : e);
  }
  try {
    return await callGemini(prompt, caller);
  } catch (e) {
    console.warn(`[ReflectionGemini/${caller}] callGemini 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}
