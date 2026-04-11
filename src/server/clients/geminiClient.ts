import { GoogleGenAI } from '@google/genai';
import { AI_MODELS } from '../../constants/aiConfig.js';

export function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Gemini Flash 간단 호출 (서버사이드 전용, googleSearch 없음 — 비용 절감).
 * API 키 미설정 시 null 반환.
 */
export async function callGemini(prompt: string): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Gemini] API 키 미설정 — AI 기능 비활성화');
    return null;
  }
  try {
    const res = await ai.models.generateContent({
      model: AI_MODELS.SERVER_SIDE,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 1024 },
    });
    return res.text ?? null;
  } catch (e: unknown) {
    console.error('[Gemini] 호출 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}
