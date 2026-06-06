// @responsibility /gemini_check formatGeminiCheckLines 회귀 — probe verdict + Google 크레딧 vs 내부 예산 구분.
import { describe, it, expect } from 'vitest';
import { formatGeminiCheckLines, type GeminiCheckInput } from './geminiCheck.cmd.js';

function input(over: Partial<GeminiCheckInput> = {}): GeminiCheckInput {
  return {
    probeOk: false,
    latencyMs: 0,
    runtime: { status: 'IDLE', label: null, caller: null, reason: null, updatedAt: '2026-06-06T00:00:00.000Z' },
    circuit: { state: 'CLOSED', failures: 0, openedAt: null },
    budget: { spentUsd: 1.2, budgetUsd: 10000, pctUsed: 0.01, blocked: false },
    ...over,
  };
}

describe('formatGeminiCheckLines', () => {
  it('probe 성공 → ✅ 연결 정상 + latency', () => {
    const lines = formatGeminiCheckLines(input({ probeOk: true, latencyMs: 742 }));
    expect(lines.some((l) => l.includes('✅ 연결 정상') && l.includes('742ms'))).toBe(true);
  });

  it('MISSING_API_KEY → 키 미설정', () => {
    const lines = formatGeminiCheckLines(input({ runtime: { ...input().runtime, status: 'BLOCKED', reason: 'MISSING_API_KEY' } }));
    expect(lines.some((l) => l.includes('GEMINI_API_KEY') && l.includes('미설정'))).toBe(true);
  });

  it('BUDGET_BLOCKED → 내부 월예산 HARD_BLOCK', () => {
    const lines = formatGeminiCheckLines(input({
      runtime: { ...input().runtime, status: 'BLOCKED', reason: 'BUDGET_BLOCKED' },
      budget: { spentUsd: 10000, budgetUsd: 10000, pctUsed: 100, blocked: true },
    }));
    expect(lines.some((l) => l.includes('내부 월예산 HARD_BLOCK'))).toBe(true);
  });

  it('CIRCUIT_OPEN → 서킷 OPEN', () => {
    const lines = formatGeminiCheckLines(input({ runtime: { ...input().runtime, status: 'BLOCKED', reason: 'CIRCUIT_OPEN' } }));
    expect(lines.some((l) => l.includes('서킷 OPEN'))).toBe(true);
  });

  it('RESOURCE_EXHAUSTED(429) → Google 크레딧 소진, 내부 예산과 별개 명시', () => {
    const lines = formatGeminiCheckLines(input({
      runtime: { ...input().runtime, status: 'FAILED', reason: '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}' },
    }));
    expect(lines.some((l) => l.includes('Google 크레딧 소진') && l.includes('별개'))).toBe(true);
  });

  it('알 수 없는 사유 → 원문 노출', () => {
    const lines = formatGeminiCheckLines(input({ runtime: { ...input().runtime, status: 'FAILED', reason: 'EMPTY_RESPONSE' } }));
    expect(lines.some((l) => l.includes('연결 실패') && l.includes('EMPTY_RESPONSE'))).toBe(true);
  });

  it('항상 서킷·예산 라인 + /ai_status 안내 포함', () => {
    const lines = formatGeminiCheckLines(input());
    expect(lines.some((l) => l.startsWith('서킷:'))).toBe(true);
    expect(lines.some((l) => l.includes('내부 월예산:'))).toBe(true);
    expect(lines.some((l) => l.includes('/ai_status'))).toBe(true);
  });
});
