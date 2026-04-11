import { GoogleGenAI } from "@google/genai";
import { debugLog } from '../../utils/debug';

// ─── AI Client & 유틸리티 ──────────────────────────────────────────────────────
// stockService.ts에서 추출된 AI 클라이언트, 캐시, 재시도, JSON 파서 모듈

export const getAI = () => {
  // 1. Legacy direct key (k-stock-api-key)
  const userKey = typeof window !== 'undefined' ? localStorage.getItem('k-stock-api-key') : null;
  // 2. Zustand persisted settings store (k-stock-settings)
  let zustandKey: string | null = null;
  if (!userKey && typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('k-stock-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        zustandKey = parsed?.state?.userApiKey || null;
      }
    } catch {}
  }
  // 3. Environment variables
  const apiKey = userKey || zustandKey || (typeof process !== 'undefined' ? (process.env.API_KEY || process.env.GEMINI_API_KEY) : undefined);

  if (!apiKey) {
    throw new Error("API Key is missing. Please provide an API key in settings.");
  }

  return new GoogleGenAI({ apiKey });
};

// ─── AI 응답 캐시 (메모리 + localStorage 이중 계층) ─────────────────────────────
//
// 계층 1: 메모리 캐시 — 같은 세션 내 즉각 응답 (무한 TTL → 탭 닫으면 소멸)
// 계층 2: localStorage — 새로고침/탭 재오픈 후에도 유지 (4시간 TTL)
//
// 효과: 앱 시작 시 12개 AI 쿼리 → 첫 실행 1회 후 새로고침해도 localStorage 히트
export const aiCache: Record<string, { data: any; timestamp: number }> = {};
const AI_CACHE_TTL    = 4 * 60 * 60 * 1000; // 4시간 (기존 30분 → 8배 연장)
const LS_CACHE_PREFIX = 'qm:ai:';            // localStorage 키 네임스페이스
const LS_MAX_KEYS     = 30;                  // 최대 보관 키 수 (용량 제한)

/** localStorage 안전 읽기 (SSR / 용량 초과 대비) */
export function lsGet(key: string): { data: any; timestamp: number } | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** localStorage 안전 쓰기 (QuotaExceededError 대비: 가장 오래된 항목 제거 후 재시도) */
export function lsSet(key: string, value: { data: any; timestamp: number }): void {
  try {
    localStorage.setItem(LS_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // 용량 초과 시: LS_CACHE_PREFIX 키 중 가장 오래된 것 제거
    try {
      const allKeys = Object.keys(localStorage)
        .filter((k) => k.startsWith(LS_CACHE_PREFIX))
        .map((k) => ({ k, ts: (() => { try { return JSON.parse(localStorage.getItem(k)!).timestamp; } catch { return 0; } })() }))
        .sort((a, b) => a.ts - b.ts);
      // 오래된 항목 절반 제거
      allKeys.slice(0, Math.max(1, Math.floor(allKeys.length / 2))).forEach((e) => localStorage.removeItem(e.k));
      localStorage.setItem(LS_CACHE_PREFIX + key, JSON.stringify(value));
    } catch {
      // localStorage 쓰기 완전 실패 → 무시 (메모리 캐시만 사용)
    }
  }
}

/** localStorage 키 수가 LS_MAX_KEYS 초과 시 오래된 것부터 정리 */
function lsEvictIfNeeded(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_CACHE_PREFIX));
    if (keys.length <= LS_MAX_KEYS) return;
    keys
      .map((k) => ({ k, ts: (() => { try { return JSON.parse(localStorage.getItem(k)!).timestamp; } catch { return 0; } })() }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, keys.length - LS_MAX_KEYS)
      .forEach((e) => localStorage.removeItem(e.k));
  } catch {
    // localStorage 접근 불가 시 무시
  }
}

export async function getCachedAIResponse<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
  const now = Date.now();

  // 1) 메모리 캐시 확인 (TTL 무제한 — 탭 생존 기간 동안 유효)
  const memHit = aiCache[cacheKey];
  if (memHit) {
    debugLog(`[AI캐시] 메모리 히트: ${cacheKey.substring(0, 50)}...`);
    return memHit.data as T;
  }

  // 2) localStorage 캐시 확인 (4시간 TTL)
  const lsHit = lsGet(cacheKey);
  if (lsHit && now - lsHit.timestamp < AI_CACHE_TTL) {
    debugLog(`[AI캐시] localStorage 히트 (${Math.floor((now - lsHit.timestamp) / 60000)}분 전 캐시): ${cacheKey.substring(0, 50)}...`);
    aiCache[cacheKey] = lsHit; // 메모리에도 복사 → 이후 즉각 응답
    return lsHit.data as T;
  }

  // 3) AI API 실제 호출
  const data = await fetchFn();
  const entry = { data, timestamp: now };
  aiCache[cacheKey] = entry;
  lsEvictIfNeeded();
  lsSet(cacheKey, entry);
  return data;
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Extract error details from potential nested structures
    let errObj = error?.error || error;
    let message = "";
    let status: string | number = "";
    let code: string | number = "";

    if (typeof error === 'string') {
      message = error;
      try {
        const parsed = JSON.parse(error);
        errObj = parsed.error || parsed;
      } catch (e) {
        // Not JSON, just use the string
      }
    }

    if (typeof errObj === 'object' && errObj !== null) {
      message = errObj.message || message || "";
      status = errObj.status || "";
      code = errObj.code || "";
    } else if (typeof errObj === 'string') {
      message = errObj;
    }

    const msgLower = message.toLowerCase();
    const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
    const isServerError = message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504') ||
                        status === 500 || status === 502 || status === 503 || status === 504 ||
                        code === 500 || code === 502 || code === 503 || code === 504 ||
                        status === 'UNKNOWN' || status === 'Internal Server Error' || (typeof status === 'string' && status.includes('500'));
    const isXhrError = msgLower.includes('xhr error') || msgLower.includes('rpc failed') ||
                      msgLower.includes('failed to fetch') || msgLower.includes('networkerror') ||
                      msgLower.includes('aborted') || msgLower.includes('timeout') ||
                      msgLower.includes('deadline exceeded');
    const isAiError = message.includes('No response from AI') || message.includes('Failed to parse AI response');
    const isInvalidArg = message.includes('400') || status === 400 || code === 400 ||
                        status === 'INVALID_ARGUMENT' || msgLower.includes('invalid') ||
                        msgLower.includes('not found') || msgLower.includes('not supported');
    const isGroundingError = msgLower.includes('grounding') || msgLower.includes('google_search') ||
                            msgLower.includes('googlesearch') || msgLower.includes('search tool');

    if (isRateLimit) {
      throw new Error('API 할당량 초과. 잠시 후 다시 시도해주세요.');
    }

    if (isInvalidArg || isGroundingError) {
      console.error(`API 설정 오류 (${message || status || code}). 모델 또는 도구 설정을 확인해주세요.`);
      throw new Error(`API 호출 오류: ${message || '잘못된 요청 설정입니다. API 키와 모델 설정을 확인해주세요.'}`);
    }

    if ((isServerError || isXhrError || isAiError) && retries > 0) {
      const waitTime = delay;
      console.warn(`Transient error hit (${message || status || code}). Retrying in ${waitTime}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return withRetry(fn, retries - 1, waitTime * 1.5);
    }
    throw error;
  }
}

export function safeJsonParse(text: string | undefined): any {
  if (!text) return {};
  try {
    // 0. Extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    let cleaned = jsonMatch ? jsonMatch[1].trim() : text.trim();

    // If it's still not starting with [ or {, find the first occurrence
    if (!cleaned.startsWith('[') && !cleaned.startsWith('{')) {
      const firstBracket = cleaned.indexOf('[');
      const firstBrace = cleaned.indexOf('{');
      let startIndex = -1;
      if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        startIndex = firstBracket;
      } else if (firstBrace !== -1) {
        startIndex = firstBrace;
      }

      if (startIndex !== -1) {
        cleaned = cleaned.substring(startIndex);
      }
    }

    // 0.5. Remove JavaScript-style comments (outside of strings)
    cleaned = removeJsonComments(cleaned);

    // 0.6. Fix unquoted property names (e.g., { key: "value" } -> { "key": "value" })
    cleaned = fixUnquotedKeys(cleaned);

    // 0.7. Replace single-quoted strings with double-quoted strings
    cleaned = fixSingleQuotes(cleaned);

    // 0.8. Remove control characters (except \n, \r, \t) that break JSON parsing
    cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

    // 1. Handle unclosed strings if truncated
    let isInsideString = false;
    let escaped = false;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '\\' && !escaped) {
        escaped = true;
      } else if (cleaned[i] === '"' && !escaped) {
        isInsideString = !isInsideString;
        escaped = false;
      } else {
        escaped = false;
      }
    }

    if (isInsideString) {
      cleaned += '"';
    }

    // 2. Strip trailing partial content (like "key": or "key": "part...)
    // If it's NOT inside a string, we can safely check for trailing colons/commas
    if (!isInsideString) {
      // Remove trailing colon and the key preceding it
      // Matches: , "key" : or just "key" : at the end
      const keyTrailingMatch = cleaned.match(/(?:,\s*)?"[^"]*"\s*:\s*$/);
      if (keyTrailingMatch) {
        cleaned = cleaned.substring(0, cleaned.length - keyTrailingMatch[0].length);
      }

      // Remove trailing comma
      cleaned = cleaned.replace(/,\s*$/, '');
    }

    // 3. Attempt to fix truncated JSON by adding missing closing braces/brackets
    let stack: string[] = [];
    isInsideString = false;
    escaped = false;

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (char === '\\' && !escaped) {
        escaped = true;
        continue;
      }

      if (char === '"' && !escaped) {
        isInsideString = !isInsideString;
      }

      if (!isInsideString) {
        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '}') stack.pop();
        } else if (char === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === ']') stack.pop();
        }
      }
      escaped = false;
    }

    const originalCleaned = cleaned;
    if (stack.length > 0) {
      cleaned += stack.reverse().join('');
    }

    try {
      return JSON.parse(cleaned);
    } catch (innerError) {
      // If simple fix failed, try more aggressive cleanup
      try {
        // Try to find the last complete object in an array if it's an array
        if (originalCleaned.startsWith('[')) {
          let tempCleaned = originalCleaned;
          let attempts = 0;
          while (attempts < 5) {
            const braceIdx = tempCleaned.lastIndexOf('}');
            if (braceIdx === -1) break;

            const truncated = tempCleaned.substring(0, braceIdx + 1) + ']';
            try {
              return JSON.parse(truncated);
            } catch (e) {
              tempCleaned = tempCleaned.substring(0, braceIdx);
              attempts++;
            }
          }
        }

        // Final attempt: aggressive comma cleanup
        let aggressiveCleaned = cleaned.replace(/,\s*([\]\}])/g, '$1');
        return JSON.parse(aggressiveCleaned);
      } catch (finalError) {
        throw innerError;
      }
    }
  } catch (e) {
    console.error("JSON Parse Error. Original text:", text);
    throw new Error(`Failed to parse AI response as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Remove JavaScript-style comments from JSON text while preserving strings.
 */
function removeJsonComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (ch === '\\' && !escaped) {
        escaped = true;
      } else if (ch === '"' && !escaped) {
        inString = false;
      } else {
        escaped = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      i++;
    } else if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
      // Single-line comment: skip until end of line
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
      // Block comment: skip until */
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip closing */
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

/**
 * Fix unquoted property names in JSON-like text.
 * Converts { key: "value" } to { "key": "value" }
 */
function fixUnquotedKeys(text: string): string {
  // Match unquoted keys: after { or , followed by optional whitespace, then an identifier, then :
  // But only outside of strings
  let result = '';
  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (inString) {
      result += ch;
      if (ch === '\\' && !escaped) {
        escaped = true;
      } else if (ch === '"' && !escaped) {
        inString = false;
      } else {
        escaped = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      escaped = false;
      result += ch;
      i++;
      continue;
    }

    // Check if we're at a position where an unquoted key could start
    // (after { or , or start of line, with optional whitespace)
    if (/[a-zA-Z_$]/.test(ch)) {
      // Look back to see if this could be a key position
      const prevNonSpace = result.replace(/\s+$/, '').slice(-1);
      if (prevNonSpace === '{' || prevNonSpace === ',') {
        // Capture the identifier
        let key = '';
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_$]/.test(text[j])) {
          key += text[j];
          j++;
        }
        // Skip whitespace after identifier
        let k = j;
        while (k < text.length && /\s/.test(text[k])) k++;
        // Check if followed by ':'
        if (k < text.length && text[k] === ':') {
          // It's an unquoted key — wrap in quotes
          result += '"' + key + '"';
          i = j;
          continue;
        }
      }
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Replace single-quoted strings with double-quoted strings in JSON-like text.
 * Handles escaped quotes within strings.
 */
function fixSingleQuotes(text: string): string {
  let result = '';
  let i = 0;
  let inDouble = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      result += ch;
      i++;
      continue;
    }

    if (inDouble) {
      result += ch;
      if (ch === '"') {
        inDouble = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      // Start of single-quoted string — convert to double-quoted
      result += '"';
      i++;
      while (i < text.length) {
        const sc = text[i];
        if (sc === '\\' && i + 1 < text.length) {
          if (text[i + 1] === "'") {
            // Escaped single quote -> just output the single quote
            result += "'";
            i += 2;
          } else {
            result += sc;
            i++;
          }
        } else if (sc === "'") {
          result += '"';
          i++;
          break;
        } else if (sc === '"') {
          // Unescaped double quote inside single-quoted string -> escape it
          result += '\\"';
          i++;
        } else {
          result += sc;
          i++;
        }
      }
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}
