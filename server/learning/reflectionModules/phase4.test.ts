/**
 * phase4.test.ts — Phase 4 Meta-Decision / Bias / Experiment / Narrative.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── #10 Meta-Decision Journal ────────────────────────────────────────────────
describe('Phase 4 #10 — Meta-Decision Journal', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('recordMetaDecision → JSONL append + summarize 통계 정확', async () => {
    const { recordMetaDecision, summarizeMetaDecisions, computeDecisionHash } =
      await import('./metaDecisionJournal.js');
    const hash = computeDecisionHash({ engineVersion: 'v1', weightsSignature: 'w1', macroSnapshot: 'R2' });
    recordMetaDecision({
      decidedAt: '2026-04-20T10:43:00Z',
      candidateCount: 12, gatePassCounts: { gate0: 7, gate1: 3, gate2: 1 },
      finalSelection: '005930', decisionHash: hash, fillLatencyMs: 1320,
    });
    recordMetaDecision({
      decidedAt: '2026-04-20T11:00:00Z',
      candidateCount: 10, gatePassCounts: { gate0: 5, gate1: 2, gate2: 0 },
      finalSelection: null, decisionHash: hash, fillLatencyMs: null,
    });
    const sum = summarizeMetaDecisions('202604');
    expect(sum.totalDecisions).toBe(2);
    expect(sum.selectedCount).toBe(1);
    expect(sum.selectionRatePct).toBe(50);
    expect(sum.topHashes[0].hash).toBe(hash);
    expect(sum.topHashes[0].count).toBe(2);
    expect(sum.avgFillLatencyMs).toBe(1320);
  });
});

// ── #11 Bias Heatmap ─────────────────────────────────────────────────────────
describe('Phase 4 #11 — biasHeatmap', () => {
  it('REGRET_AVERSION — 지연 손절 비율 높을수록 score 상승', async () => {
    const { computeBiasHeatmap } = await import('./biasHeatmap.js');
    const scores = computeBiasHeatmap({
      activePositions: [],
      closedToday: [
        { status: 'HIT_STOP', stopLoss: 66000, exitPrice: 65000, quantity: 10, shadowEntryPrice: 70000 } as any,
        { status: 'HIT_STOP', stopLoss: 50000, exitPrice: 49500, quantity: 10, shadowEntryPrice: 55000 } as any,
      ],
      attributionToday: [], missedSignalCount: 0,
      watchlistCount: 0, availableSlots: 10,
    });
    const s = scores.find((x) => x.bias === 'REGRET_AVERSION');
    expect(s?.score).toBe(1); // 2/2 지연
  });

  it('SUNK_COST — 20일+ 보유 & -10% 이하 포지션 탐지', async () => {
    const { computeBiasHeatmap } = await import('./biasHeatmap.js');
    const old = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
    const scores = computeBiasHeatmap({
      activePositions: [{ status: 'ACTIVE', signalTime: old, shadowEntryPrice: 100000, exitPrice: 88000, stockCode: '005930' } as any],
      closedToday: [], attributionToday: [], missedSignalCount: 0,
      watchlistCount: 0, availableSlots: 10,
    });
    const s = scores.find((x) => x.bias === 'SUNK_COST');
    expect(s?.score).toBeGreaterThan(0);
  });

  it('findChronicBiases — 3일 연속 ≥ 0.70 편향만 반환', async () => {
    const { findChronicBiases } = await import('./biasHeatmap.js');
    const d1: any = { scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }, { bias: 'HERDING', score: 0.2, evidence: '' }] };
    const d2: any = { scores: [{ bias: 'FOMO', score: 0.75, evidence: '' }] };
    const d3: any = { scores: [{ bias: 'FOMO', score: 0.90, evidence: '' }, { bias: 'HERDING', score: 0.9, evidence: '' }] };
    expect(findChronicBiases([d1, d2, d3])).toEqual(['FOMO']);
  });
});

// ── #12 Experiment Proposal ──────────────────────────────────────────────────
describe('Phase 4 #12 — experimentProposal', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('만성 조건 → 🟡 YELLOW_AUTO 제안 + autoStartAt 24h 후', async () => {
    const { proposeExperiments } = await import('./experimentProposal.js');
    const props = proposeExperiments({
      chronicConditions: [17],
      confession: [{ conditionId: 17, passedCount: 3, winCount: 0, lossCount: 3, expiredCount: 0, falseSignalScore: 1.0 }],
      lossRatio: 0.3,
    });
    const yellow = props.find((p) => p.track === 'YELLOW_AUTO');
    expect(yellow).toBeDefined();
    expect(yellow?.state).toBe('PROPOSED');
    expect(yellow?.hypothesis).toContain('조건 17');
  });

  it('손절 비율 ≥ 0.6 + 참회 2건+ → 🔴 RED_APPROVE 제안', async () => {
    const { proposeExperiments } = await import('./experimentProposal.js');
    const props = proposeExperiments({
      chronicConditions: [],
      confession: [
        { conditionId: 17, passedCount: 3, winCount: 0, lossCount: 3, expiredCount: 0, falseSignalScore: 1 },
        { conditionId: 21, passedCount: 3, winCount: 0, lossCount: 3, expiredCount: 0, falseSignalScore: 1 },
      ],
      lossRatio: 0.7,
    });
    const red = props.find((p) => p.track === 'RED_APPROVE');
    expect(red?.state).toBe('AWAIT_APPROVAL');
  });

  it('promoteYellowExperiments — autoStartAt 경과 후 AUTO_STARTED', async () => {
    const { proposeExperiments, promoteYellowExperiments } = await import('./experimentProposal.js');
    proposeExperiments({
      chronicConditions: [5],
      confession: [{ conditionId: 5, passedCount: 3, winCount: 0, lossCount: 3, expiredCount: 0, falseSignalScore: 1 }],
      lossRatio: 0.3,
    });
    // 24h 경과 시뮬
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const promoted = promoteYellowExperiments(later);
    expect(promoted.length).toBe(1);
    expect(promoted[0].state).toBe('AUTO_STARTED');
  });
});

// ── #13 System Narrative Generator ───────────────────────────────────────────
describe('Phase 4 #13 — narrativeGenerator', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.doUnmock('../../clients/geminiClient.js'); });

  it('Gemini 성공 → 서사 반환 + 300자 트리밍', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue('오늘은 관망세로 출발해 오후 외인 순매도로 KOSPI -1%. 신규 진입 없음. 어제 도출한 섹터 집중 40% 상한 원칙은 정상 작동. 내일 FOMC 결과 후 방산 재진입 타이밍 관찰.'),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { generateSystemNarrative } = await import('./narrativeGenerator.js');
    const report: any = {
      date: '2026-04-20', dailyVerdict: 'MIXED',
      keyLessons: [{ text: 'A', sourceIds: ['t1'] }],
      tomorrowAdjustments: [{ text: 'B', sourceIds: ['t1'] }],
    };
    const narrative = await generateSystemNarrative(report, { regime: 'R4_NEUTRAL' }, { maxGeminiCalls: 1 });
    expect(narrative).toBeTruthy();
    expect(narrative!.length).toBeLessThanOrEqual(300);
    expect(narrative).toContain('KOSPI');
  });

  it('maxGeminiCalls=0 → null', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn(),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { generateSystemNarrative } = await import('./narrativeGenerator.js');
    const report: any = { date: '2026-04-20', dailyVerdict: 'SILENT', keyLessons: [], tomorrowAdjustments: [] };
    expect(await generateSystemNarrative(report, {}, { maxGeminiCalls: 0 })).toBeNull();
  });

  it('Gemini null → null', async () => {
    vi.doMock('../../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue(null),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    const { generateSystemNarrative } = await import('./narrativeGenerator.js');
    const report: any = { date: '2026-04-20', dailyVerdict: 'SILENT', keyLessons: [], tomorrowAdjustments: [] };
    expect(await generateSystemNarrative(report, {}, { maxGeminiCalls: 1 })).toBeNull();
  });
});
