/**
 * @responsibility Gemini API 호출 + 페르소나 주입/서문 스트립 + 월예산·서킷·재시도
 *
 * 모든 서버 측 Gemini 호출은 이 모듈을 통과한다. 응답은 기본적으로 페르소나
 * 메타 서문이 제거된 상태로 반환된다 (PR-20).
 */
import { GoogleGenAI } from '@google/genai';
import { AI_MODELS } from '../constants.js';
import { createCircuitBreaker, CircuitOpenError } from '../utils/circuitBreaker.js';
import { buildPersonaPrelude, hasPersonaPrelude } from '../persona/personaIdentity.js';
import { compactError, emitProviderWarn } from '../observability/providerWarn.js';

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

// ── 응답 페르소나 서문 제거 (PR-20) ────────────────────────────────────────
//
// Gemini 는 페르소나 prepend 에 반응해 응답 상단에 "QuantMaster 시스템
// 아키텍트로서 …을 제시한다" 같은 메타 서문을 자주 붙인다. 이는 텔레그램
// 메시지 글자 수만 차지하고 영양가가 없으므로 기본적으로 제거한다.
//
// 규칙:
//   - 첫 문장·문단 (빈 줄 전까지) 에서 메타 패턴을 탐지.
//   - 다음 중 하나라도 매치되면 해당 덩어리를 삭제:
//       · "QuantMaster", "시스템 아키텍트", "아키텍트로서"
//       · "…제시한다|분석한다|답변한다|설명한다" 로만 끝나는 자기소개 문장
//   - 번호 리스트 (①②③, 1./2./3., - , •) 또는 볼드(**)·이모지(📊📈🔥) 가
//     먼저 등장하면 메타 서문 영역 종료로 간주하고 이후 본문은 그대로 유지.
//   - 본문이 사라져 빈 문자열이 되면 원문을 그대로 반환 (안전 fallback).
const PERSONA_META_PATTERNS = [
  /QuantMaster/i,
  /시스템\s*아키텍트/,
  /아키텍트로서/,
  /인사이트를\s*제시한다/,
  /분석한다\.?$/,
  /답변한다\.?$/,
  /답하겠다\.?$/,
];
// JSON 응답(`{`, `[`) 또는 코드블록(```) 이 먼저 등장하면 서문 영역 종료 간주 —
// mainReflection 등 JSON 파싱 경로의 안전장치.
const BODY_START_PATTERN = /^(\s*[①②③④⑤]|\s*\d{1,2}[.)]|\s*[-•]|\s*\*\*|\s*[{[]|\s*```|\s*[📊📈📉🔥✅❌⚠️💡🎯🌅🌙🕛])/;

export function stripPersonaPreamble(raw: string): string {
  if (!raw) return raw;
  // 구분선 (--- / ━━━) 으로 시작하는 서문은 그대로 컷.
  const lines = raw.split('\n');
  let cutAt = 0;
  let stripped = false;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i].trim();
    if (!line) { cutAt = i + 1; continue; }
    // 구분선(---, ━━━, ─) 은 본문 신호보다 우선 — "-" 가 불릿으로 오인되지 않도록.
    if (/^[-─━]{3,}$/.test(line)) { cutAt = i + 1; stripped = true; continue; }
    // 본문 신호 (번호/불릿/볼드/이모지/JSON) 가 먼저 오면 서문 영역 끝.
    if (BODY_START_PATTERN.test(line)) break;
    // 메타 패턴 문장은 제거.
    if (PERSONA_META_PATTERNS.some((re) => re.test(line))) {
      cutAt = i + 1;
      stripped = true;
      continue;
    }
    // 패턴 아닌 첫 문장이 나오면 서문 영역 끝.
    break;
  }
  if (!stripped) return raw;
  const remainder = lines.slice(cutAt).join('\n').trim();
  // 본문이 사라지면 원문 유지 — 잘못된 스트립 방지.
  return remainder.length > 0 ? remainder : raw;
}

// ── 데이터 신뢰도 태그 제거 (사용자 대면 리포트/다이제스트 전용) ──────────────
//
// 페르소나는 모든 주장에 [REALTIME]/[CALCULATED]/[ESTIMATED]/[INFERRED]/[MANUAL]
// 신뢰도 태그를 붙이도록 지시한다(personaIdentity). 진단·쿼리 응답에선 출처
// 투명성에 유용하지만, 장마감 종합 같은 사용자 대면 다이제스트 본문에선 노이즈다.
// 태그만 제거하고 남는 이중 공백·구두점 앞 공백을 정리한다. (레짐 태그 [CRISIS] 등은 보존)
const RELIABILITY_TAG_PATTERN = /\s?\[(?:REALTIME|CALCULATED|ESTIMATED|INFERRED|MANUAL)\]/g;
export function stripReliabilityTags(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(RELIABILITY_TAG_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?:)\]])/g, '$1');
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

export interface GeminiRuntimeState {
  status: 'IDLE' | 'SUCCESS' | 'FAILED' | 'BLOCKED';
  label: string | null;
  caller: string | null;
  reason: string | null;
  updatedAt: string | null;
}

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

let _runtimeState: GeminiRuntimeState = {
  status: 'IDLE',
  label: null,
  caller: null,
  reason: null,
  updatedAt: null,
};

function setRuntimeState(
  status: GeminiRuntimeState['status'],
  label: string,
  caller: string,
  reason: string | null = null,
): void {
  _runtimeState = {
    status,
    label,
    caller,
    reason,
    updatedAt: new Date().toISOString(),
  };
}

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
    emitProviderWarn({
      source: 'GEMINI',
      message: 'Gemini monthly budget reached 90%; AI calls continue with budget pressure.',
      dedupKey: `p2:provider:GEMINI:budget-warn:${_budgetState.yyyymm}`,
      details: { spentUsd: Number(spentUsd.toFixed(2)), monthlyBudgetUsd: MONTHLY_BUDGET_USD, pct: Number(pct.toFixed(1)) },
    });
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
// PR-3 #6: 매일 "Gemini 응답 실패 — 템플릿 fallback" 반복 발생을 줄이기 위해
// MAX_RETRIES 2 → 3, BACKOFF_BASE 800 → 1500 으로 상향.
// 전형적 실패 원인: (a) 일시적 503/504 (b) 토큰 초과 파싱 실패 (c) Flash preview 불안정.
// 총 백오프 시간: 1.5 + 3 + 6 ≈ 10.5s (이전 0.8 + 1.6 + 3.2 ≈ 5.6s)
// 더 긴 대기가 수용 가능한 이유: nightly 배치 경로는 사용자 동기 응답이 아님.
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1500;

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
        setRuntimeState('BLOCKED', label, label, 'CIRCUIT_OPEN');
        emitProviderWarn({
          source: 'GEMINI',
          message: 'Gemini circuit open; returning null without execution impact.',
          dedupKey: `p2:provider:GEMINI:circuit:${label}`,
          fallbackUsed: true,
          details: { label, retryAfterMs: e.retryAfterMs },
        });
        return null;
      }
      if (!isTransient(e) || attempt === MAX_RETRIES) break;
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      emitProviderWarn({
        source: 'GEMINI',
        message: 'Gemini transient failure retry scheduled.',
        dedupKey: `p2:provider:GEMINI:retry:${label}`,
        fallbackUsed: false,
        details: { label, attempt: attempt + 1, maxRetries: MAX_RETRIES, delayMs: delay, compactError: compactError(e) },
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error(`[Gemini] ${label} 최종 실패:`, lastErr instanceof Error ? lastErr.message : lastErr);
  setRuntimeState('FAILED', label, label, lastErr instanceof Error ? lastErr.message : String(lastErr));
  return null;
}

export function getGeminiCircuitStats() {
  return _cb.getStats();
}

export function getGeminiRuntimeState(): GeminiRuntimeState {
  return { ..._runtimeState };
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

export interface GeminiTextOptions {
  caller?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  useSearch?: boolean;
  prependPersona?: boolean;
  /**
   * gemini-2.5-flash 의 thinking 토큰이 maxOutputTokens 예산을 잠식해 가시 본문이
   * 문장 중간에서 잘리는 것을 막는다. 0 이면 thinking 비활성 — 짧은 리포트/다이제스트
   * 텍스트 전용. 미지정 시 모델 기본(dynamic thinking) 유지 — 해석·reflection 경로 보존.
   */
  thinkingBudget?: number;
  /**
   * 사용자 대면 리포트/다이제스트에서 페르소나 데이터 신뢰도 태그([REALTIME] 등)를
   * 제거한다. 기본 false (진단·쿼리 응답은 출처 투명성 위해 태그 유지).
   */
  stripReliabilityTags?: boolean;
  /**
   * PR-20: 응답 상단의 페르소나 메타 서문("QuantMaster 시스템 아키텍트로서…")을
   * 자동 제거할지 여부. 기본 true — 텔레그램 메시지 노이즈 축소 목적.
   * JSON 파싱 경로(mainReflection 등)에서 원문이 필요한 경우 false 로 끌 수 있다.
   */
  stripPreamble?: boolean;
}

export async function callGeminiText(prompt: string, opts: GeminiTextOptions = {}): Promise<string | null> {
  const ai = getGeminiClient() as GoogleGenAI;
  const caller = opts.caller ?? 'unknown';
  const label = `callGeminiText[${caller}]`;
  if (!ai) {
    emitProviderWarn({ source: 'GEMINI', message: 'Gemini API key missing; AI feature disabled.', dedupKey: `p2:provider:GEMINI:missing-key:${caller}`, fallbackUsed: true, details: { caller } });
    setRuntimeState('BLOCKED', label, caller, 'MISSING_API_KEY');
    return null;
  }
  if (isBudgetBlocked()) {
    emitProviderWarn({ source: 'GEMINI', message: 'Gemini monthly budget hard block; call skipped.', dedupKey: `p2:provider:GEMINI:budget-block:${caller}`, fallbackUsed: true, details: { caller, label } });
    setRuntimeState('BLOCKED', label, caller, 'BUDGET_BLOCKED');
    return null;
  }
  return withRetry(label, async () => {
    const res = await ai.models.generateContent({
      model: opts.model ?? AI_MODELS.SERVER_SIDE,
      contents: opts.prependPersona === false ? prompt : withPersona(prompt),
      config: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxOutputTokens ?? 2048,
        // thinkingBudget=0 → 본문 잘림 방지(리포트 경로). 미지정 시 모델 기본 thinking 유지.
        ...(opts.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } } : {}),
        ...(opts.useSearch ? { tools: [{ googleSearch: {} }] } : {}),
      } as Parameters<typeof ai.models.generateContent>[0]['config'],
    });
    const tokens = (res as { usageMetadata?: { totalTokenCount?: number } })
      .usageMetadata?.totalTokenCount ?? 0;
    recordCall(caller, tokens);
    const raw = res.text ?? null;
    if (!raw) {
      setRuntimeState('FAILED', label, caller, 'EMPTY_RESPONSE');
      return null;
    }
    setRuntimeState('SUCCESS', label, caller, null);
    // PR-20: 기본적으로 페르소나 서문 제거. JSON 응답 경로는 stripPreamble=false.
    const preambleStripped = opts.stripPreamble === false ? raw : stripPersonaPreamble(raw);
    return opts.stripReliabilityTags ? stripReliabilityTags(preambleStripped) : preambleStripped;
  });
}

/**
 * Gemini Flash 간단 호출 (서버사이드 전용, googleSearch 없음 — 비용 절감).
 * @param prompt 프롬프트
 * @param caller 호출처 식별자 (사용량 추적용, 예: 'dart-fast' / 'global-scan')
 */
export async function callGemini(prompt: string, caller = 'unknown'): Promise<string | null> {
  return callGeminiText(prompt, {
    caller,
    model: AI_MODELS.SERVER_SIDE,
    temperature: 0.4,
    maxOutputTokens: 2048,
    // gemini-2.5-flash thinking 토큰이 출력 예산을 잠식해 리포트 본문이 문장 중간에서
    // 잘리던 문제 수정 — 짧은 한국어 리포트/다이제스트엔 thinking 불필요(비용·지연도 절감).
    thinkingBudget: 0,
    // 사용자 대면 리포트/다이제스트에선 [REALTIME]/[CALCULATED] 등 신뢰도 태그 제거.
    stripReliabilityTags: true,
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
  return callGeminiText(
    INTERPRET_PREAMBLE + '\n' +
    '[?ъ쟾 ?섏쭛 ?ㅻ뜲?댄꽣]\n' +
    prefetchedContext.trim() + '\n' +
    '\n[?댁꽍 吏??\n' +
    instruction.trim(),
    {
      caller,
      model: AI_MODELS.SERVER_SIDE,
      temperature: 0.2,
      maxOutputTokens: 1536,
    },
  );
  const ai = getGeminiClient() as GoogleGenAI;
  if (!ai) {
    emitProviderWarn({ source: 'GEMINI', message: 'Gemini API key missing; interpret feature disabled.', dedupKey: `p2:provider:GEMINI:interpret-missing-key:${caller}`, fallbackUsed: true, details: { caller } });
    return null;
  }
  if (isBudgetBlocked()) {
    emitProviderWarn({ source: 'GEMINI', message: 'Gemini monthly budget hard block; interpret call skipped.', dedupKey: `p2:provider:GEMINI:interpret-budget-block:${caller}`, fallbackUsed: true, details: { caller } });
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
  return callGeminiText(prompt, {
    caller,
    model: SEARCH_MODEL,
    temperature: 0.2,
    maxOutputTokens: 2048,
    useSearch: true,
  });
  const ai = getGeminiClient() as GoogleGenAI;
  if (!ai) {
    emitProviderWarn({ source: 'GEMINI', message: 'Gemini API key missing; search feature disabled.', dedupKey: `p2:provider:GEMINI:search-missing-key:${caller}`, fallbackUsed: true, details: { caller } });
    return null;
  }
  if (isBudgetBlocked()) {
    emitProviderWarn({ source: 'GEMINI', message: 'Gemini monthly budget hard block; search call skipped.', dedupKey: `p2:provider:GEMINI:search-budget-block:${caller}`, fallbackUsed: true, details: { caller } });
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
