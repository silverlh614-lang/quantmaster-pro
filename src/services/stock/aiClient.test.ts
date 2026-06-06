/**
 * @responsibility getAI() thinking 주입 회귀 — 클라 generateContent 가 thinkingConfig 를
 *   기본 주입(thinking 토큰이 maxOutputTokens 잠식해 빈/잘린 응답 되는 것 방지)하고
 *   호출자가 명시하면 보존.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentSpy = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContentSpy(...args) };
  },
  ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}));

let getAI: typeof import('./aiClient').getAI;

beforeEach(async () => {
  generateContentSpy.mockReset();
  generateContentSpy.mockResolvedValue({ text: 'OK' });
  process.env.GEMINI_API_KEY = 'test-key';
  vi.resetModules();
  ({ getAI } = await import('./aiClient'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function injectedThinking(): unknown {
  return (generateContentSpy.mock.calls[0][0] as { config: { thinkingConfig?: unknown } }).config.thinkingConfig;
}

describe('getAI() — thinking 기본 주입', () => {
  it('기본 모델(gemini-3.5-flash) → thinkingLevel:LOW 주입', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAI().models.generateContent({ model: 'gemini-3.5-flash', contents: 'x', config: { maxOutputTokens: 100 } } as any);
    expect(injectedThinking()).toEqual({ thinkingLevel: 'LOW' });
  });

  it('gemini-2.x 모델 → thinkingBudget:0 주입', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAI().models.generateContent({ model: 'gemini-2.5-flash', contents: 'x', config: {} } as any);
    expect(injectedThinking()).toEqual({ thinkingBudget: 0 });
  });

  it('호출자가 thinkingConfig 명시 → 보존(덮어쓰지 않음)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await getAI().models.generateContent({ model: 'gemini-3.5-flash', contents: 'x', config: { thinkingConfig: { thinkingLevel: 'HIGH' } } } as any);
    expect(injectedThinking()).toEqual({ thinkingLevel: 'HIGH' });
  });
});
