import { GoogleGenAI } from '@google/genai';
import { AI_MODELS } from '../constants.js';
import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';

// Gemini Flash 모델 (Google Search 지원) — supplyChainAgent 전용
const SEARCH_MODEL = AI_MODELS.PRIMARY;

// ── 안정성: 서킷 브레이커 + 재시도 정책 ────────────────────────────────────
// 5xx/네트워크 오류 누적 시 일정 시간 호출 차단 — quota burn 방지.
const _cb = createCircuitBreaker({
  name: 'gemini',
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 60_000,
});
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 800;

function isTransient(e: unknown): boolean {
  if (!(e instanceof Error)) return true;
  const msg = e.message.toLowerCase();
  // 4xx (인증/입력 오류) 는 재시도 무의미
  if (/\b4\d{2}\b/.test(msg) || msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('forbidden')) return false;
  return true;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await _cb.exec(fn);
    } catch (e) {
      lastErr = e;
      if (e instanceof CircuitOpenError) {
        console.warn(`[Gemini] ${label} 서킷 OPEN — 즉시 null 반환 (${e.retryAfterMs}ms 후 회복)`);
        return null;
      }
      if (!isTransient(e) || attempt === MAX_RETRIES) break;
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      console.warn(`[Gemini] ${label} retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error(`[Gemini] ${label} 최종 실패:`, lastErr instanceof Error ? lastErr.message : lastErr);
  return null;
}

export function getGeminiCircuitStats() {
  return _cb.getStats();
}

// ── 일별 호출 카운터 ───────────────────────────────────────────────────────────

interface CallerStat { count: number; tokens: number; date: string }
const _dailyCounter: Record<string, CallerStat> = {};

function recordCall(caller: string, tokens: number): void {
  const today = new Date().toISOString().slice(0, 10);
  const stat   = _dailyCounter[caller];
  if (!stat || stat.date !== today) {
    _dailyCounter[caller] = { count: 0, tokens: 0, date: today };
  }
  _dailyCounter[caller].count++;
  _dailyCounter[caller].tokens += tokens;
}

/** GET /api/system/api-usage 로 노출되는 일별 호출 통계 */
export function getApiUsageStats(): Record<string, CallerStat> {
  return { ..._dailyCounter };
}

// ── Gemini 클라이언트 ─────────────────────────────────────────────────────────

export function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY ?? process.env.API_KEY;
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key });
}

/**
 * Gemini Flash 간단 호출 (서버사이드 전용, googleSearch 없음 — 비용 절감).
 * @param prompt 프롬프트
 * @param caller 호출처 식별자 (사용량 추적용, 예: 'dart-fast' / 'global-scan')
 */
export async function callGemini(prompt: string, caller = 'unknown'): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Gemini] API 키 미설정 — AI 기능 비활성화');
    return null;
  }
  return withRetry(`callGemini[${caller}]`, async () => {
    const res = await ai.models.generateContent({
      model: AI_MODELS.SERVER_SIDE,
      contents: prompt,
      config: { temperature: 0.4, maxOutputTokens: 2048 },
    });
    const tokens = (res as { usageMetadata?: { totalTokenCount?: number } })
      .usageMetadata?.totalTokenCount ?? 0;
    recordCall(caller, tokens);
    return res.text ?? null;
  });
}

/**
 * Gemini + Google Search 그라운딩 호출 (공급망 뉴스 스캔 전용).
 * 실시간 웹 검색 결과를 바탕으로 응답 — 비용이 높으므로 1일 1회만 사용.
 */
export async function callGeminiWithSearch(prompt: string, caller = 'search'): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Gemini] API 키 미설정 — 검색 기능 비활성화');
    return null;
  }
  return withRetry(`callGeminiWithSearch[${caller}]`, async () => {
    const res = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.2,
        maxOutputTokens: 2048,
      } as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    const tokens = (res as { usageMetadata?: { totalTokenCount?: number } })
      .usageMetadata?.totalTokenCount ?? 0;
    recordCall(caller, tokens);
    return res.text ?? null;
  });
}
