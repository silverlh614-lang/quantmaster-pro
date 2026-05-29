// @responsibility A2 회귀 — gate1 forensic hydrated 집계 정직성 (finite 숫자 기준, 실행 분기 불변).

import { describe, it, expect } from 'vitest';
import {
  summarizeGate1ForensicInputCompletenessAdr0507,
  type Gate1ForensicInputCompletenessSummaryAdr0507,
} from './gate1ForensicInputsCollectorAdr0507.js';
import type { CandidateEntryTrace } from './entryFilterDecomposition.js';

function trace(patch: Partial<CandidateEntryTrace>): CandidateEntryTrace {
  return {
    symbol: 'T1',
    stageReached: 'WATCHLIST',
    blockers: [],
    executionImpact: 'NONE',
    ...patch,
  } as CandidateEntryTrace;
}

function summarize(traces: CandidateEntryTrace[]): Gate1ForensicInputCompletenessSummaryAdr0507 {
  return summarizeGate1ForensicInputCompletenessAdr0507({ candidateTraces: traces });
}

describe('A2 summarizeGate1ForensicInputCompletenessAdr0507 — 정직한 hydrated 집계', () => {
  it('quote 객체는 있으나 숫자 미충전이면 traceWithQuoteCount(=finite) 로 카운트되지 않는다', () => {
    // quote 객체 셸만 존재, scorer-read 숫자 키 전부 비어있음.
    const t = trace({ quote: {} });
    const summary = summarize([t]);

    expect(summary.candidateTraceCount).toBe(1);
    // 정직성: 숫자 미충전 → finite 기준 hydrated 0
    expect(summary.traceWithQuoteCount).toBe(0);
    // 객체 셸은 존재 → object 기준 1
    expect(summary.traceWithQuoteObjectCount).toBe(1);
  });

  it('quote 에 finite 숫자가 있으면 traceWithQuoteCount 로 카운트된다', () => {
    const t = trace({ quote: { volume: 1_000_000, avgVolume: 800_000 } });
    const summary = summarize([t]);

    expect(summary.traceWithQuoteCount).toBe(1);
    expect(summary.traceWithQuoteObjectCount).toBe(1);
  });

  it('quoteNumericFieldCoverage 로 어느 키가 비는지 정직 노출한다 (avgVolume 결손 가시화)', () => {
    // volume 은 있고 avgVolume 은 결손 — A1 배선 단절 재현.
    const t = trace({ quote: { volume: 1_000_000 } });
    const summary = summarize([t]);

    expect(summary.quoteNumericFieldCoverage.volume).toBe(1);
    expect(summary.quoteNumericFieldCoverage.avgVolume).toBe(0);
  });

  it('top-level / symbolFeatures 숫자도 hydrated 로 정직 집계한다', () => {
    const tTop = trace({ avgVolume: 500_000 });
    const tFeat = trace({ symbolFeatures: { volume: 700_000 } as CandidateEntryTrace['symbolFeatures'] });
    const summary = summarize([tTop, tFeat]);

    expect(summary.traceWithQuoteCount).toBe(2);
    expect(summary.quoteNumericFieldCoverage.avgVolume).toBe(1);
    expect(summary.quoteNumericFieldCoverage.volume).toBe(1);
  });

  it('NaN/Infinity 는 finite 가 아니므로 hydrated 로 카운트되지 않는다', () => {
    const t = trace({ quote: { volume: Number.NaN, avgVolume: Number.POSITIVE_INFINITY } as CandidateEntryTrace['quote'] });
    const summary = summarize([t]);

    expect(summary.traceWithQuoteCount).toBe(0);
    expect(summary.quoteNumericFieldCoverage.volume).toBe(0);
    expect(summary.quoteNumericFieldCoverage.avgVolume).toBe(0);
  });

  it('정직성 강화가 dominantFailureReason 판정(실행 분기)을 바꾸지 않는다 (behavior-neutral)', () => {
    // 핵심: traceWithQuoteCount 를 finite 기준으로 강화했지만, TRACE_HYDRATION_MISSING 판정은
    // quote *객체* 셸(traceWithQuoteObjectCount) 기준으로 보존된다.
    // quote 객체 셸 존재 + 숫자 미충전 케이스에서 finite 기준이면 traceWithQuoteCount=0 이지만,
    // 객체 셸 기준 판정 덕분에 과거와 동일하게 dominantFailureReason 은 미설정으로 유지된다.
    const withShell = trace({ quote: {} });
    const summary = summarize([withShell]);
    expect(summary.traceWithQuoteCount).toBe(0); // 정직: 숫자 미충전
    expect(summary.traceWithQuoteObjectCount).toBe(1); // 객체 셸 존재
    expect(summary.dominantFailureReason).toBeUndefined(); // 판정 불변 (과거와 동일)

    // 빈 후보 배열 → candidateTraceCount=0 → 판정 미설정 (경계 보존).
    expect(summarize([]).dominantFailureReason).toBeUndefined();
  });
});
