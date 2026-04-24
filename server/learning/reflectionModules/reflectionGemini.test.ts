/**
 * @responsibility callReflectionGemini 옵션 pass-through 스모크 — ADR-0009
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderOpts = {
  caller?: string;
  temperature?: number;
  maxOutputTokens?: number;
  prependPersona?: boolean;
  stripPreamble?: boolean;
};

const providerSpy = vi.fn<(prompt: string, opts: ProviderOpts) => Promise<string | null>>();
const callGeminiSpy = vi.fn<(prompt: string, caller: string) => Promise<string | null>>();

vi.mock('../../ai/aiProvider.js', () => ({
  getAiProvider: () => ({
    name: 'gemini',
    isConfigured: () => true,
    textOnly: providerSpy,
  }),
}));

vi.mock('../../clients/geminiClient.js', () => ({
  callGemini: (prompt: string, caller: string) => callGeminiSpy(prompt, caller),
}));

// reset modules so mocks take effect before loading subject
let callReflectionGemini: (prompt: string, caller: string) => Promise<string | null>;

beforeEach(async () => {
  providerSpy.mockReset();
  callGeminiSpy.mockReset();
  ({ callReflectionGemini } = await import('./reflectionGemini.js'));
});

afterEach(() => {
  vi.resetModules();
});

describe('callReflectionGemini — ADR-0009 옵션 pass-through', () => {
  it('provider 경로에 prependPersona:false / stripPreamble:false / maxOutputTokens:4096 전달', async () => {
    providerSpy.mockResolvedValue('{"ok":true}');
    const out = await callReflectionGemini('prompt-1', 'mainReflection');
    expect(out).toBe('{"ok":true}');
    expect(providerSpy).toHaveBeenCalledTimes(1);
    const [, opts] = providerSpy.mock.calls[0];
    expect(opts.caller).toBe('mainReflection');
    expect(opts.temperature).toBe(0.2);
    expect(opts.maxOutputTokens).toBe(4096);
    expect(opts.prependPersona).toBe(false);
    expect(opts.stripPreamble).toBe(false);
  });

  it('provider 가 throw 하면 callGemini fallback 호출', async () => {
    providerSpy.mockRejectedValue(new Error('provider down'));
    callGeminiSpy.mockResolvedValue('{"fallback":1}');
    const out = await callReflectionGemini('prompt-2', 'fiveWhy');
    expect(out).toBe('{"fallback":1}');
    expect(callGeminiSpy).toHaveBeenCalledTimes(1);
    const [, caller] = callGeminiSpy.mock.calls[0];
    expect(caller).toBe('fiveWhy');
  });
});
