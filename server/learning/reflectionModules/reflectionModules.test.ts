/**
 * reflectionModules.test.ts — Phase 2 Five-Why / Persona / Main integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Phase 2 — personaRoundTable', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../../clients/geminiClient.js');
  });

  it('4명 모두 GREEN → stressTested=true', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('{"signal":"GREEN","comment":"좋은 거래."}'),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { runPersonaRoundTable } = await import('./personaRoundTable.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, targetPrice: 77_000,
      status: 'HIT_TARGET', exitPrice: 77_000, returnPct: 10,
    };
    const res = await runPersonaRoundTable(trade, { maxGeminiCalls: 4 });
    expect(res?.votes).toHaveLength(4);
    expect(res?.stressTested).toBe(true);
    expect(res?.counterExample).toBeUndefined();
  });

  it('RED 가 1명이라도 있으면 stressTested=false + counterExample 기록', async () => {
    const responses = [
      '{"signal":"GREEN","comment":"ok"}',
      '{"signal":"RED","comment":"사이즈 과대"}',
      '{"signal":"GREEN","comment":"ok"}',
      '{"signal":"YELLOW","comment":"불확실"}',
    ];
    const callGemini = vi.fn();
    responses.forEach((r) => callGemini.mockResolvedValueOnce(r));
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini,
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { runPersonaRoundTable } = await import('./personaRoundTable.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, targetPrice: 77_000,
      status: 'HIT_TARGET', exitPrice: 77_000, returnPct: 10,
    };
    const res = await runPersonaRoundTable(trade, { maxGeminiCalls: 4 });
    expect(res?.stressTested).toBe(false);
    expect(res?.counterExample).toBe('사이즈 과대');
  });

  it('JSON 아닌 응답 → YELLOW fallback', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('이것은 JSON 이 아닙니다'),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { runPersonaRoundTable } = await import('./personaRoundTable.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, targetPrice: 77_000,
      status: 'HIT_STOP', exitPrice: 65_000, returnPct: -7,
    };
    const res = await runPersonaRoundTable(trade, { maxGeminiCalls: 4 });
    expect(res?.votes.every((v) => v.signal === 'YELLOW')).toBe(true);
    expect(res?.stressTested).toBe(false);
  });

  it('maxGeminiCalls=0 → null 반환', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn(),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { runPersonaRoundTable } = await import('./personaRoundTable.js');
    const trade: any = { id: 't1', stockCode: '005930', stockName: '삼성전자', shadowEntryPrice: 70000, stopLoss: 66000, targetPrice: 77000, status: 'HIT_STOP' };
    const res = await runPersonaRoundTable(trade, { maxGeminiCalls: 0 });
    expect(res).toBeNull();
  });
});

describe('Phase 2 — fiveWhy', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fivewhy-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../../clients/geminiClient.js');
    vi.doUnmock('../../rag/localRag.js');
  });

  it('5단계 모두 응답 + RAG 히트 없음 → YELLOW_NEW_INSIGHT + generalPrinciple 기록', async () => {
    let idx = 0;
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockImplementation(() => Promise.resolve(`depth${++idx} answer`)),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../../rag/localRag.js', () => ({
      queryRag: vi.fn().mockResolvedValue([]),
    }));
    const { runFiveWhyFor } = await import('./fiveWhy.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, targetPrice: 77_000,
      status: 'HIT_STOP', exitPrice: 65_000, returnPct: -7.14,
    };
    const res = await runFiveWhyFor(trade, { maxGeminiCalls: 5 });
    expect(res?.steps).toHaveLength(5);
    expect(res?.tag).toBe('YELLOW_NEW_INSIGHT');
    expect(res?.generalPrinciple).toBe('depth5 answer');
  });

  it('RAG 히트 score≥0.75 → GREEN_EXISTING', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('generic answer'),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../../rag/localRag.js', () => ({
      queryRag: vi.fn().mockResolvedValue([{ score: 0.9, chunk: { content: '기존 원칙' } }]),
    }));
    const { runFiveWhyFor } = await import('./fiveWhy.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, targetPrice: 77_000,
      status: 'HIT_STOP', exitPrice: 65_000, returnPct: -7,
    };
    const res = await runFiveWhyFor(trade, { maxGeminiCalls: 5 });
    expect(res?.tag).toBe('GREEN_EXISTING');
    expect(res?.generalPrinciple).toBeUndefined();
  });

  it('maxGeminiCalls=3 → 3단계까지만 수행 → YELLOW (검토 유도)', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('answer'),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../../rag/localRag.js', () => ({ queryRag: vi.fn().mockResolvedValue([]) }));
    const { runFiveWhyFor } = await import('./fiveWhy.js');
    const trade: any = {
      id: 't1', stockCode: '005930', stockName: '삼성전자',
      shadowEntryPrice: 70_000, stopLoss: 66_000, targetPrice: 77_000,
      status: 'HIT_STOP', exitPrice: 65_000, returnPct: -7,
    };
    const res = await runFiveWhyFor(trade, { maxGeminiCalls: 3 });
    expect(res?.steps).toHaveLength(3);
    expect(res?.tag).toBe('YELLOW_NEW_INSIGHT');
  });
});

describe('Phase 2 — mainReflection', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.doUnmock('../../clients/geminiClient.js'); });

  it('JSON 스키마 응답 파싱 → Partial<ReflectionReport>', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue(
        '```json\n{"dailyVerdict":"GOOD_DAY","keyLessons":[{"text":"손절 기계화 유효","sourceIds":["t1"]}],"questionableDecisions":[],"tomorrowAdjustments":[],"followUpActions":[]}\n```',
      ),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { generateMainReflection } = await import('./mainReflection.js');
    const res = await generateMainReflection({
      date: '2026-04-21',
      closedTrades: [],
      attributionToday: [],
      incidentsToday: [],
      missedSignals: [],
    });
    expect(res?.dailyVerdict).toBe('GOOD_DAY');
    expect(res?.keyLessons).toHaveLength(1);
    expect(res?.keyLessons?.[0].sourceIds).toEqual(['t1']);
  });

  it('Gemini null → null 반환 → fallback 유도', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue(null),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { generateMainReflection } = await import('./mainReflection.js');
    const res = await generateMainReflection({
      date: '2026-04-21', closedTrades: [], attributionToday: [], incidentsToday: [], missedSignals: [],
    });
    expect(res).toBeNull();
  });

  it('buildShortNarrative — 300자 트리밍', async () => {
    const { buildShortNarrative } = await import('./mainReflection.js');
    const lesson = 'A'.repeat(500);
    const short = buildShortNarrative('2026-04-21', 'GOOD_DAY', 'FULL', [{ text: lesson, sourceIds: ['x'] }], []);
    expect(short.length).toBeLessThanOrEqual(300);
    expect(short.endsWith('...')).toBe(true);
  });
});
