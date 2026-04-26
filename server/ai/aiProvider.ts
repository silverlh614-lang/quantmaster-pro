// @responsibility aiProvider AI provider 모듈
/**
 * aiProvider.ts — AI 공급자 어댑터 (Idea 10)
 *
 * 단일 인터페이스 `AiProvider` 뒤에 Gemini/OpenAI/Groq/자체호스팅 구현을 둔다.
 * `AI_PROVIDER` 환경변수로 런타임 스왑.
 *
 * 현재 구현: Gemini만 (OpenAI/Groq은 stub).
 *   - 어댑터 패턴 자체가 가격 변동 헤지 가치를 갖는다.
 *   - 추후 Groq Llama 3.3 70B / OpenAI gpt-4o-mini 추가 시 이 파일에서만 구현 추가.
 *
 * 호출 규약:
 *   - 모든 구현은 textOnly()를 제공해야 한다.
 *   - 실패는 throw 하지 말고 null 반환 (서킷 OPEN, 예산 차단 등 횡단 정책).
 *   - 토큰/비용 추적은 상위 레이어(geminiClient.ts::recordCall)에 일임.
 */

import { callGemini, callGeminiText } from '../clients/geminiClient.js';

export type ProviderName = 'gemini' | 'openai' | 'groq' | 'self-hosted';

export interface TextOnlyOptions {
  /** 호출처 식별자 — 사용량 추적/디버깅용 */
  caller?: string;
  /** 0~1 — 응답 무작위성. Gemini 기본 0.4 */
  temperature?: number;
  /** 응답 토큰 상한. Gemini 기본 2048 */
  maxOutputTokens?: number;
  /**
   * QuantMaster 페르소나 프리앰블을 prepend 할지 여부 (기본 true).
   * reflection 모듈처럼 JSON 스키마 프롬프트가 자체 지시문을 갖는 경우 false.
   */
  prependPersona?: boolean;
  /**
   * 응답 상단의 페르소나 메타 서문을 자동 제거할지 여부 (기본 true).
   * JSON 파싱 경로는 본문이 `{` 로 시작해 자동 stripper 가 노터치지만,
   * 안전을 위해 false 로 끌 수 있다.
   */
  stripPreamble?: boolean;
}

export interface AiProvider {
  /** 공급자 식별자 — 로깅/지표용 */
  readonly name: ProviderName;
  /** 키/엔드포인트 등 호출 가능 여부 (필수 환경변수 점검) */
  isConfigured(): boolean;
  /** 단순 텍스트 in → 텍스트 out 호출. 실패 시 null. */
  textOnly(prompt: string, opts?: TextOnlyOptions): Promise<string | null>;
}

// ── Gemini 어댑터 — 기존 callGemini 재사용 (예산/서킷/사용량 모두 상속) ──────

class GeminiProvider implements AiProvider {
  readonly name: ProviderName = 'gemini';
  isConfigured(): boolean {
    return !!(process.env.GEMINI_API_KEY ?? process.env.API_KEY);
  }
  async textOnly(prompt: string, opts?: TextOnlyOptions): Promise<string | null> {
    // 단순 호출은 기본 callGemini 사용 (서킷·예산·재시도 모두 자동 적용).
    // ADR-0009: prependPersona / stripPreamble 가 지정되면 세밀 제어 경로(callGeminiText)
    //          로 전환해 그대로 pass-through 한다.
    const hasFineOpts =
      opts &&
      (opts.temperature !== undefined ||
       opts.maxOutputTokens !== undefined ||
       opts.prependPersona !== undefined ||
       opts.stripPreamble !== undefined);
    if (!hasFineOpts) {
      return callGemini(prompt, opts?.caller ?? 'aiProvider');
    }
    return callGeminiText(prompt, {
      caller: opts!.caller ?? 'aiProvider',
      model: 'gemini-2.5-flash',
      temperature: opts!.temperature ?? 0.4,
      maxOutputTokens: opts!.maxOutputTokens ?? 2048,
      ...(opts!.prependPersona !== undefined ? { prependPersona: opts!.prependPersona } : {}),
      ...(opts!.stripPreamble !== undefined ? { stripPreamble: opts!.stripPreamble } : {}),
    });
  }
}

// ── 미구현 stubs — env 스왑만으로 즉시 활성화 가능한 형태로 자리만 마련 ──────

class StubProvider implements AiProvider {
  constructor(public readonly name: ProviderName, private readonly reason: string) {}
  isConfigured(): boolean { return false; }
  async textOnly(): Promise<string | null> {
    console.warn(`[AiProvider/${this.name}] 미구현: ${this.reason} — null 반환`);
    return null;
  }
}

// ── 팩토리: env 기반 단일 인스턴스 캐싱 ─────────────────────────────────────

let _cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (_cached) return _cached;
  const name = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase() as ProviderName;
  switch (name) {
    case 'gemini':
      _cached = new GeminiProvider();
      break;
    case 'openai':
      _cached = new StubProvider('openai', 'OpenAI 클라이언트 미설치 — Gemini로 폴백 권장');
      break;
    case 'groq':
      _cached = new StubProvider('groq', 'Groq 클라이언트 미설치 — Llama 3.3 70B 전환 필요');
      break;
    case 'self-hosted':
      _cached = new StubProvider('self-hosted', 'RunPod Phi-3 14B 엔드포인트 URL 미설정');
      break;
    default:
      console.warn(`[AiProvider] 알 수 없는 AI_PROVIDER='${name}' — Gemini로 폴백`);
      _cached = new GeminiProvider();
  }
  return _cached;
}

/** 테스트용 — 캐시 초기화. */
export function resetAiProviderCache(): void {
  _cached = null;
}
