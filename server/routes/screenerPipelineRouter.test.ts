/**
 * @responsibility buildPipelineSummary 단위 테스트 — ADR-0033 PR-F
 */
import { describe, it, expect } from 'vitest';
import { buildPipelineSummary } from './screenerPipelineRouter.js';
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

function makeSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    time: '14:30 KST',
    candidates: 100,
    trackB: 50,
    swing: 30,
    catalyst: 20,
    momentum: 50,
    yahooFails: 10,
    gateMisses: 20,
    rrrMisses: 15,
    entries: 5,
    ...overrides,
  };
}

describe('buildPipelineSummary — ADR-0033 PR-F', () => {
  it('summary=null → 모든 stage count=0 + lastScanTime=null', () => {
    const r = buildPipelineSummary(null);
    expect(r.lastScanTime).toBeNull();
    expect(r.stages).toHaveLength(6);
    expect(r.stages.every(s => s.count === 0)).toBe(true);
    expect(r.totals.candidates).toBe(0);
    expect(r.totals.entries).toBe(0);
    expect(r.totals.conversionRate).toBe(0);
  });

  it('정상 입력 → 단계별 카운트 정확 산출', () => {
    const summary = makeSummary({
      candidates: 100, yahooFails: 10, gateMisses: 20, rrrMisses: 15, entries: 5,
    });
    const r = buildPipelineSummary(summary);

    expect(r.lastScanTime).toBe('14:30 KST');

    const stage = (id: string) => r.stages.find(s => s.id === id);
    expect(stage('CANDIDATES')?.count).toBe(100);
    expect(stage('MOMENTUM_PASS')?.count).toBe(90);  // 100 - 10
    expect(stage('GATE1_PASS')?.count).toBe(70);     // 90 - 20
    expect(stage('RRR_PASS')?.count).toBe(55);       // 70 - 15
    expect(stage('ENTRIES')?.count).toBe(5);
  });

  it('단계별 droppedAtThisStep 정확', () => {
    const summary = makeSummary({
      candidates: 100, yahooFails: 10, gateMisses: 20, rrrMisses: 15, entries: 5,
    });
    const r = buildPipelineSummary(summary);

    const stage = (id: string) => r.stages.find(s => s.id === id);
    expect(stage('MOMENTUM_PASS')?.droppedAtThisStep).toBe(10);
    expect(stage('GATE1_PASS')?.droppedAtThisStep).toBe(20);
    expect(stage('RRR_PASS')?.droppedAtThisStep).toBe(15);
    // ENTRIES — RRR_PASS 55 - entries 5 = 50 dropped
    expect(stage('ENTRIES')?.droppedAtThisStep).toBe(50);
  });

  it('conversionRate = entries / candidates', () => {
    const r = buildPipelineSummary(makeSummary({ candidates: 200, entries: 10 }));
    expect(r.totals.conversionRate).toBeCloseTo(0.05, 5);
  });

  it('candidates=0 → conversionRate=0 (분모 0 안전)', () => {
    const r = buildPipelineSummary(makeSummary({ candidates: 0, entries: 0 }));
    expect(r.totals.conversionRate).toBe(0);
  });

  it('음수 입력 → 0 으로 절삭', () => {
    const summary = { ...makeSummary(), yahooFails: -5, gateMisses: -3 } as ScanSummary;
    const r = buildPipelineSummary(summary);
    expect(r.stages.every(s => s.count >= 0)).toBe(true);
  });

  it('NaN/Infinity 입력 → 0 처리', () => {
    const summary = { ...makeSummary(), candidates: NaN, entries: Infinity } as ScanSummary;
    const r = buildPipelineSummary(summary);
    expect(r.totals.candidates).toBe(0);
    expect(r.totals.entries).toBe(0);
  });

  it('yahooFails > candidates → MOMENTUM_PASS=0 (음수 회피)', () => {
    const r = buildPipelineSummary(makeSummary({ candidates: 10, yahooFails: 50 }));
    expect(r.stages.find(s => s.id === 'MOMENTUM_PASS')?.count).toBe(0);
    expect(r.stages.find(s => s.id === 'GATE1_PASS')?.count).toBe(0);
    expect(r.stages.find(s => s.id === 'RRR_PASS')?.count).toBe(0);
  });

  it('UNIVERSE 단계는 정확 인프라 부재로 count=0 (후속 PR)', () => {
    const r = buildPipelineSummary(makeSummary());
    expect(r.stages.find(s => s.id === 'UNIVERSE')?.count).toBe(0);
    expect(r.totals.universeSize).toBeNull();
  });

  it('6 stages 정확 순서 유지', () => {
    const r = buildPipelineSummary(makeSummary());
    expect(r.stages.map(s => s.id)).toEqual([
      'UNIVERSE',
      'CANDIDATES',
      'MOMENTUM_PASS',
      'GATE1_PASS',
      'RRR_PASS',
      'ENTRIES',
    ]);
  });

  it('stage label 한국어 표시', () => {
    const r = buildPipelineSummary(makeSummary());
    expect(r.stages.find(s => s.id === 'CANDIDATES')?.label).toBe('거래 가능');
    expect(r.stages.find(s => s.id === 'ENTRIES')?.label).toBe('매수 후보');
  });
});
