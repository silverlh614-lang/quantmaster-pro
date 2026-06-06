/**
 * @responsibility callGeminiText thinking 설정 회귀 — gemini-2.x/3.x thinking 토큰이
 *   maxOutputTokens 를 잠식해 빈 응답(EMPTY_RESPONSE)이 되는 문제 방지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentSpy = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContentSpy(...args) };
  },
  ThinkingLevel: {
    THINKING_LEVEL_UNSPECIFIED: 'THINKING_LEVEL_UNSPECIFIED',
    MINIMAL: 'MINIMAL',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
  },
}));

let callGeminiText: typeof import('./geminiClient.js').callGeminiText;
let getGeminiRuntimeState: typeof import('./geminiClient.js').getGeminiRuntimeState;

beforeEach(async () => {
  generateContentSpy.mockReset();
  process.env.GEMINI_API_KEY = 'test-key';
  // 페르소나 prepend 비활성 — 프롬프트 변형 없이 config 만 검증.
  process.env.DISABLE_PERSONA_PREPEND = 'true';
  vi.resetModules();
  ({ callGeminiText, getGeminiRuntimeState } = await import('./geminiClient.js'));
});

afterEach(() => {
  delete process.env.DISABLE_PERSONA_PREPEND;
  vi.restoreAllMocks();
});

function firstConfig(): Record<string, unknown> {
  return (generateContentSpy.mock.calls[0][0] as { config: Record<string, unknown> }).config;
}

describe('callGeminiText — thinking 설정 (EMPTY_RESPONSE 방지)', () => {
  it('gemini-2.x(기본 서버 모델) → thinkingConfig.thinkingBudget=0', async () => {
    generateContentSpy.mockResolvedValue({ text: 'OK', usageMetadata: { totalTokenCount: 3 } });
    const out = await callGeminiText('ping', { caller: 'test', maxOutputTokens: 16 });
    expect(out).toBe('OK');
    expect(firstConfig().thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(firstConfig().maxOutputTokens).toBe(16);
  });

  it('gemini-3.x 모델 → thinkingConfig.thinkingLevel=LOW (thinkingBudget 미전달)', async () => {
    generateContentSpy.mockResolvedValue({ text: 'OK', usageMetadata: {} });
    await callGeminiText('ping', { caller: 'test', model: 'gemini-3.5-flash' });
    expect(firstConfig().thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('빈 text 응답 → null + EMPTY_RESPONSE 런타임 사유', async () => {
    generateContentSpy.mockResolvedValue({ text: '', usageMetadata: {} });
    const out = await callGeminiText('ping', { caller: 'probe' });
    expect(out).toBeNull();
    expect(getGeminiRuntimeState().reason).toBe('EMPTY_RESPONSE');
  });
});
