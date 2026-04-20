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
