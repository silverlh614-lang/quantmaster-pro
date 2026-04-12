import { GoogleGenAI } from '@google/genai';
import { AI_MODELS } from '../constants.js';

// Gemini Flash 모델 (Google Search 지원) — supplyChainAgent 전용
const SEARCH_MODEL = 'gemini-3.0-flash';

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

/**
 * Gemini + Google Search 그라운딩 호출 (공급망 뉴스 스캔 전용).
 * 실시간 웹 검색 결과를 바탕으로 응답 — 비용이 높으므로 1일 1회만 사용.
 * API 키 미설정 또는 실패 시 null 반환.
 */
export async function callGeminiWithSearch(prompt: string): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Gemini] API 키 미설정 — 검색 기능 비활성화');
    return null;
  }
  try {
    const res = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
        maxOutputTokens: 2048,
      } as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    return res.text ?? null;
  } catch (e: unknown) {
    console.error('[Gemini+Search] 호출 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}
