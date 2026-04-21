import { GoogleGenAI } from '@google/genai';
import { AI_MODELS } from '../constants.js';
import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';
import { buildPersonaPrelude, hasPersonaPrelude } from '../persona/personaIdentity.js';

// Gemini Flash 모델 (Google Search 지원) — supplyChainAgent 전용
const SEARCH_MODEL = AI_MODELS.PRIMARY;

// ── 페르소나 주입 가드 ────────────────────────────────────────────────────────
// 모든 Gemini 호출에 QuantMaster 시스템 아키텍트 페르소나를 자동 prepend 한다.
// 환경변수 DISABLE_PERSONA_PREPEND=true 로 비활성화 가능 (테스트·디버깅용).
// 이미 prepend 된 prompt(예: 재시도) 는 중복 적용 안 함.
function withPersona(prompt: string): string {
  if ((process.env.DISABLE_PERSONA_PREPEND ?? 'false').toLowerCase() === 'true') {
    return prompt;
  }
  if (hasPersonaPrelude(prompt)) return prompt;
  return buildPersonaPrelude(prompt);
}

// ── Idea 13: 월 예산 하드리밋 회로차단기 ──────────────────────────────────────
//
// "손절은 실패가 아니라 운영 비용" 원칙을 비용에 적용:
//   - MONTHLY_AI_BUDGET_USD (기본 10,000달러 = 사실상 무제한)
//   - 90% 도달 시 1회 WARN + Telegram
//   - 100% 도달 시 모든 호출 즉시 null + Telegram, 익월 1일 자동 재개
//
// 기본값을 10,000 USD 로 상향 — 참뮌의 운영 리듬에 맞춰 필요 시
// env MONTHLY_AI_BUDGET_USD 로 하향 조정 가능.
//
// gemini-2.5-flash 가격(2025): input $0.30/M, output $2.50/M.
// totalTokenCount는 input+output 합계라 단가 평균 ~$1.40/M으로 보수적 추정.
// (실제 input 비중 70%면 평균 $0.96/M, output 비중 50%면 $1.40/M)
const MONTHLY_BUDGET_USD = parseFloat(process.env.MONTHLY_AI_BUDGET_USD ?? '10000');
const TOKEN_PRICE_USD_PER_M = parseFloat(process.env.AI_TOKEN_PRICE_USD_PER_M ?? '1.40');

interface BudgetState {
  yyyymm: string;          // 'YYYY-MM' — 월 변경 시 자동 리셋
  totalTokens: number;     // 누적 토큰 (input+output)
  warned: boolean;         // 90% 경고 1회 발송 플래그
  blocked: boolean;        // 100% 도달 시 true → 호출 차단
  blockedAt?: string;      // ISO timestamp
}

let _budgetState: BudgetState = {
  yyyymm: new Date().toISOString().slice(0, 7),
  totalTokens: 0,
  warned: false,
  blocked: false,
};

function resetIfNewMonth(): void {
  const yyyymm = new Date().toISOString().slice(0, 7);
  if (_budgetState.yyyymm !== yyyymm) {
    console.log(`[Gemini/Budget] 월 변경 (${_budgetState.yyyymm} → ${yyyymm}) — 예산 리셋`);
    _budgetState = { yyyymm, totalTokens: 0, warned: false, blocked: false };
  }
}

function tokensToUsd(tokens: number): number {
  return (tokens / 1_000_000) * TOKEN_PRICE_USD_PER_M;
}

/** 외부에서 예산 상태 확인 (대시보드/디버깅) */
export function getBudgetState(): BudgetState & { spentUsd: number; budgetUsd: number; pctUsed: number } {
  resetIfNewMonth();
  const spentUsd = tokensToUsd(_budgetState.totalTokens);
  return {
    ..._budgetState,
    spentUsd: parseFloat(spentUsd.toFixed(4)),
    budgetUsd: MONTHLY_BUDGET_USD,
    pctUsed: parseFloat(((spentUsd / MONTHLY_BUDGET_USD) * 100).toFixed(2)),
  };
}

/** 호출 직전 차단 여부 검사 — true면 호출 거부 */
export function isBudgetBlocked(): boolean {
  resetIfNewMonth();
  return _budgetState.blocked;
}

async function recordBudgetUsage(tokens: number): Promise<void> {
  resetIfNewMonth();
  _budgetState.totalTokens += tokens;
  const spentUsd = tokensToUsd(_budgetState.totalTokens);
  const pct = (spentUsd / MONTHLY_BUDGET_USD) * 100;

  // 100% 도달 → HARD_BLOCK + Telegram (1회만)
  if (!_budgetState.blocked && pct >= 100) {
    _budgetState.blocked = true;
    _budgetState.blockedAt = new Date().toISOString();
    console.error(
      `[Gemini/Budget] 🚫 HARD_BLOCK — 월 예산 100% 도달 ` +
      `($${spentUsd.toFixed(2)}/$${MONTHLY_BUDGET_USD}). 익월 1일까지 모든 Gemini 호출 차단.`,
    );
    // Telegram 알림 — best-effort, 실패 무시
    try {
      const { sendTelegramAlert } = await import('../alerts/telegramClient.js');
      await sendTelegramAlert(
        `🚫 <b>[AI 예산 HARD_BLOCK]</b>\n` +
        `${_budgetState.yyyymm} 누적 $${spentUsd.toFixed(2)} / $${MONTHLY_BUDGET_USD} (100%)\n` +
        `익월까지 모든 Gemini 호출이 차단됩니다.`,
        { priority: 'CRITICAL', dedupeKey: `ai-budget-block:${_budgetState.yyyymm}` },
      );
    } catch { /* noop */ }
    return;
  }

  // 90% 도달 → WARN + Telegram (1회만)
  if (!_budgetState.warned && pct >= 90) {
    _budgetState.warned = true;
    console.warn(
      `[Gemini/Budget] ⚠️ 월 예산 90% 도달 ` +
      `($${spentUsd.toFixed(2)}/$${MONTHLY_BUDGET_USD}). 100% 도달 시 호출 차단됨.`,
    );
    try {
      const { sendTelegramAlert } = await import('../alerts/telegramClient.js');
      await sendTelegramAlert(
        `⚠️ <b>[AI 예산 90% 경고]</b>\n` +
        `${_budgetState.yyyymm} 누적 $${spentUsd.toFixed(2)} / $${MONTHLY_BUDGET_USD} (${pct.toFixed(1)}%)\n` +
        `남은 예산이 부족합니다.`,
        { priority: 'HIGH', dedupeKey: `ai-budget-warn:${_budgetState.yyyymm}` },
      );
    } catch { /* noop */ }
  }
}

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
  // Idea 13: 월 예산 누적 — 90%/100% 도달 시 자동 경보/차단
  void recordBudgetUsage(tokens);
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
  if (isBudgetBlocked()) {
    console.warn(`[Gemini] 월 예산 HARD_BLOCK 상태 — callGemini[${caller}] 호출 차단`);
    return null;
  }
  return withRetry(`callGemini[${caller}]`, async () => {
    const res = await ai.models.generateContent({
      model: AI_MODELS.SERVER_SIDE,
      contents: withPersona(prompt),
      config: { temperature: 0.4, maxOutputTokens: 2048 },
    });
    const tokens = (res as { usageMetadata?: { totalTokenCount?: number } })
      .usageMetadata?.totalTokenCount ?? 0;
    recordCall(caller, tokens);
    return res.text ?? null;
  });
}

/**
 * Gemini "해석 전용" 호출 (아이디어 3).
 *
 * 호출자는 KIS(현재가·수급) · Yahoo(기술지표) · DART(재무)에서 실데이터를
 * 먼저 수집하여 `prefetchedContext` 블록으로 주입한다. 모델에게는
 *   "검색 금지, 아래 실데이터만으로 정성 판단"
 * 지시가 프롬프트 상단에 강제 삽입되어 googleSearch 호출과 토큰을 모두 절감한다.
 *
 * 기존 callGemini() 와 같은 예산/서킷/재시도 계층을 재사용한다.
 */
const INTERPRET_PREAMBLE =
  '# 중요 규칙 (반드시 준수)\n' +
  '- 외부 검색, URL 접근, 네이버/구글 조회를 절대 하지 마라.\n' +
  '- 아래 "사전 수집 실데이터" 블록에 없는 숫자·사실은 추측하지 말고\n' +
  '  "데이터 없음"으로 표기하라.\n' +
  '- 모든 수치 해석은 [사전 수집 실데이터] 블록 안의 값만 사용한다.\n';

export async function callGeminiInterpret(
  prefetchedContext: string,
  instruction: string,
  caller = 'interpret',
): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Gemini] API 키 미설정 — 해석 기능 비활성화');
    return null;
  }
  if (isBudgetBlocked()) {
    console.warn(`[Gemini] 월 예산 HARD_BLOCK 상태 — callGeminiInterpret[${caller}] 호출 차단`);
    return null;
  }
  const fullPrompt =
    INTERPRET_PREAMBLE + '\n' +
    '[사전 수집 실데이터]\n' +
    prefetchedContext.trim() + '\n' +
    '\n[해석 지시]\n' +
    instruction.trim();

  return withRetry(`callGeminiInterpret[${caller}]`, async () => {
    const res = await ai.models.generateContent({
      model: AI_MODELS.SERVER_SIDE,
      contents: withPersona(fullPrompt),
      config: { temperature: 0.2, maxOutputTokens: 1536 },
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
  if (isBudgetBlocked()) {
    console.warn(`[Gemini] 월 예산 HARD_BLOCK 상태 — callGeminiWithSearch[${caller}] 호출 차단`);
    return null;
  }
  return withRetry(`callGeminiWithSearch[${caller}]`, async () => {
    const res = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: withPersona(prompt),
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
