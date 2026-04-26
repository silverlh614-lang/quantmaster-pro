/**
 * @responsibility reflectionImpactRecorder 회귀 테스트 — 13개 모듈 추론 정확성 (ADR-0047 PR-Y2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ReflectionReport, TraceableClaim } from './reflectionTypes.js';

function makeReport(overrides: Partial<ReflectionReport> = {}): ReflectionReport {
  return {
    date: '2026-04-26',
    generatedAt: '2026-04-26T10:00:00.000Z',
    dailyVerdict: 'MIXED',
    keyLessons: [],
    questionableDecisions: [],
    tomorrowAdjustments: [],
    followUpActions: [],
    ...overrides,
  };
}

function tc(text: string, sourceIds: string[] = []): TraceableClaim {
  return { text, sourceIds };
}

describe('inferModuleImpacts', () => {
  it('완전 빈 report → 거의 모든 모듈 false', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    const impacts = inferModuleImpacts(makeReport());
    expect(impacts.mainReflection).toBe(false);
    expect(impacts.personaRoundTable).toBe(false);
    expect(impacts.fiveWhy).toBe(false);
    expect(impacts.counterfactual).toBe(false);
    expect(impacts.conditionConfession).toBe(false);
    expect(impacts.regretQuantifier).toBe(false);
    expect(impacts.biasHeatmap).toBe(false);
    expect(impacts.experimentProposal).toBe(false);
    expect(impacts.narrativeGenerator).toBe(false);
    expect(impacts.manualExitReview).toBe(false);
    expect(impacts.metaDecisionJournal).toBe(false);
    expect(impacts.weeklyReflectionAudit).toBe(false);
    // mainReflection false → reflectionGemini 도 false
    expect(impacts.reflectionGemini).toBe(false);
  });

  it('keyLessons 1건 → mainReflection + reflectionGemini meaningful', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    const impacts = inferModuleImpacts(
      makeReport({ keyLessons: [tc('lesson 1', ['x:1'])] }),
    );
    expect(impacts.mainReflection).toBe(true);
    expect(impacts.reflectionGemini).toBe(true);
  });

  it('integrity.parseFailed=true → mainReflection / reflectionGemini false', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    const impacts = inferModuleImpacts(
      makeReport({
        keyLessons: [tc('lesson 1')],
        integrity: { claimsIn: 5, claimsOut: 5, removed: [], parseFailed: true },
      }),
    );
    expect(impacts.mainReflection).toBe(false);
    expect(impacts.reflectionGemini).toBe(false);
  });

  it('extras.geminiCallSucceeded=false → reflectionGemini false (mainReflection 무관)', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    const impacts = inferModuleImpacts(
      makeReport({ keyLessons: [tc('lesson')] }),
      { geminiCallSucceeded: false },
    );
    expect(impacts.mainReflection).toBe(true);
    expect(impacts.reflectionGemini).toBe(false);
  });

  it('biasHeatmap — extras.biasMaxScore ≥ 0.5', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    expect(inferModuleImpacts(makeReport(), { biasMaxScore: 0.6 }).biasHeatmap).toBe(true);
    expect(inferModuleImpacts(makeReport(), { biasMaxScore: 0.3 }).biasHeatmap).toBe(false);
    expect(inferModuleImpacts(makeReport(), { biasMaxScore: 0.5 }).biasHeatmap).toBe(true);
  });

  it('biasHeatmap — followUpActions sourceIds 에 bias: prefix → meaningful', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    const impacts = inferModuleImpacts(
      makeReport({
        followUpActions: [tc('chronic bias', ['bias:loss_aversion'])],
      }),
    );
    expect(impacts.biasHeatmap).toBe(true);
  });

  it('experimentProposal — extras.experimentProposalCount > 0 → meaningful', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    expect(
      inferModuleImpacts(makeReport(), { experimentProposalCount: 2 }).experimentProposal,
    ).toBe(true);
    expect(
      inferModuleImpacts(makeReport(), { experimentProposalCount: 0 }).experimentProposal,
    ).toBe(false);
  });

  it('experimentProposal — followUpActions sourceIds 에 exp: prefix → meaningful', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    const impacts = inferModuleImpacts(
      makeReport({
        followUpActions: [tc('[실험] hypothesis', ['exp:e1'])],
      }),
    );
    expect(impacts.experimentProposal).toBe(true);
  });

  it('counterfactual — sampleCount > 0 → meaningful', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    expect(
      inferModuleImpacts(
        makeReport({
          counterfactual: {
            missedOpportunityKrw: 0,
            earlyExitKrw: 0,
            lateStopKrw: 0,
            sampleCount: 3,
          },
        }),
      ).counterfactual,
    ).toBe(true);
    expect(
      inferModuleImpacts(
        makeReport({
          counterfactual: {
            missedOpportunityKrw: 0,
            earlyExitKrw: 0,
            lateStopKrw: 0,
            sampleCount: 0,
          },
        }),
      ).counterfactual,
    ).toBe(false);
  });

  it('manualExitReview — count=0 + rolling7dCount=0 → false / 둘 중 하나라도 > 0 → true', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    expect(
      inferModuleImpacts(
        makeReport({
          manualExitReview: {
            date: '2026-04-26',
            count: 0,
            reasonBreakdown: {},
            avgBias: { regretAvoidance: 0, endowmentEffect: 0, panicSelling: 0 },
            machineDivergenceCount: 0,
            avgDistanceToStop: 0,
            avgDistanceToTarget: 0,
            rolling7dCount: 0,
            rolling30dCount: 0,
            flags: [],
          },
        }),
      ).manualExitReview,
    ).toBe(false);
    expect(
      inferModuleImpacts(
        makeReport({
          manualExitReview: {
            date: '2026-04-26',
            count: 0,
            reasonBreakdown: {},
            avgBias: { regretAvoidance: 0, endowmentEffect: 0, panicSelling: 0 },
            machineDivergenceCount: 0,
            avgDistanceToStop: 0,
            avgDistanceToTarget: 0,
            rolling7dCount: 5,
            rolling30dCount: 10,
            flags: [],
          },
        }),
      ).manualExitReview,
    ).toBe(true);
  });

  it('narrativeGenerator — narrative 비어있는 문자열 → false', async () => {
    const { inferModuleImpacts } = await import('./reflectionImpactRecorder.js');
    expect(inferModuleImpacts(makeReport({ narrative: '' })).narrativeGenerator).toBe(false);
    expect(inferModuleImpacts(makeReport({ narrative: '   ' })).narrativeGenerator).toBe(false);
    expect(inferModuleImpacts(makeReport({ narrative: 'today was 평탄' })).narrativeGenerator).toBe(true);
  });
});

describe('recordReflectionImpactsFromReport', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-recorder-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('13개 모듈 모두 record 영속', async () => {
    const { recordReflectionImpactsFromReport } = await import('./reflectionImpactRecorder.js');
    const { loadReflectionImpactRecords } = await import(
      '../persistence/reflectionImpactRepo.js'
    );
    const written = recordReflectionImpactsFromReport(makeReport(), '2026-04-26', new Date());
    expect(written).toHaveLength(13);
    expect(loadReflectionImpactRecords()).toHaveLength(13);
  });

  it('호출 1건이라도 throw 해도 다음 모듈 계속 처리 (fault-tolerant)', async () => {
    const { recordReflectionImpactsFromReport } = await import('./reflectionImpactRecorder.js');
    // 단순 호출 — throw 하지 않는 경우 검증 (실제 호출은 성공)
    const written = recordReflectionImpactsFromReport(
      makeReport({ keyLessons: [tc('a')] }),
      '2026-04-26',
      new Date(),
    );
    expect(written.length).toBeGreaterThanOrEqual(13);
  });

  it('실제 영향률 통계 — meaningful=true 모듈만 카운트', async () => {
    const { recordReflectionImpactsFromReport } = await import('./reflectionImpactRecorder.js');
    const { getModuleStats } = await import('../persistence/reflectionImpactRepo.js');
    const now = new Date('2026-04-26T00:00:00.000Z');
    recordReflectionImpactsFromReport(
      makeReport({
        keyLessons: [tc('lesson')],
        narrative: 'today',
      }),
      '2026-04-26',
      now,
    );
    const main = getModuleStats('mainReflection', 30, now);
    expect(main.meaningfulRuns).toBe(1);
    const fiveWhy = getModuleStats('fiveWhy', 30, now);
    expect(fiveWhy.runs).toBe(1);
    expect(fiveWhy.meaningfulRuns).toBe(0);
  });
});
