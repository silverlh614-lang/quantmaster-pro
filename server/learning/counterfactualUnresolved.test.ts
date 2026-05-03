/**
 * @responsibility ADR-0182 summarizeUnresolvedCounterfactuals SSOT 회귀 테스트
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import { COUNTERFACTUAL_FILE } from '../persistence/paths.js';
import {
  recordCounterfactual,
  summarizeUnresolvedCounterfactuals,
  loadCounterfactuals,
} from './counterfactualShadow.js';

const _backup = fs.existsSync(COUNTERFACTUAL_FILE)
  ? fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8')
  : null;

function reset() {
  if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(COUNTERFACTUAL_FILE, _backup);
  else if (fs.existsSync(COUNTERFACTUAL_FILE)) fs.unlinkSync(COUNTERFACTUAL_FILE);
});

describe('summarizeUnresolvedCounterfactuals (ADR-0182)', () => {
  beforeEach(reset);

  it('빈 영속 — 모든 카운트 0 + oldestSignalDate undefined', () => {
    const summary = summarizeUnresolvedCounterfactuals();
    expect(summary).toEqual({
      totalCount: 0,
      resolved30dCount: 0,
      resolved60dCount: 0,
      resolved90dCount: 0,
      pending30dCount: 0,
      pending60dCount: 0,
      pending90dCount: 0,
      awaitingHorizonCount: 0,
      oldestSignalDate: undefined,
    });
  });

  it('30 일 미경과 entry — awaitingHorizonCount 1 + 다른 카운트 0', () => {
    const signal = new Date('2026-04-15T00:00:00Z');
    const code = `${Date.now()}A`.padStart(6, '0').slice(0, 6);
    recordCounterfactual({
      stockCode: code, stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: signal,
    });
    const now = new Date('2026-04-30T00:00:00Z'); // 15일 경과
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.totalCount).toBe(1);
    expect(s.awaitingHorizonCount).toBe(1);
    expect(s.pending30dCount).toBe(0);
    expect(s.resolved30dCount).toBe(0);
  });

  it('30 일 정확 경과 + return30d 부재 — pending30dCount 1', () => {
    const signal = new Date('2026-03-01T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: signal,
    });
    const now = new Date('2026-03-31T00:00:00Z'); // 정확 30일
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.totalCount).toBe(1);
    expect(s.awaitingHorizonCount).toBe(0);
    expect(s.pending30dCount).toBe(1);
    expect(s.resolved30dCount).toBe(0);
  });

  it('30 일 경과 + return30d 채워짐 — resolved30dCount 1', () => {
    const signal = new Date('2026-02-01T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: signal,
    });
    // return30d 직접 영속 갱신
    const entries = loadCounterfactuals();
    entries[0].return30d = 5.0;
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(entries, null, 2));

    const now = new Date('2026-03-15T00:00:00Z'); // 42일 경과
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.resolved30dCount).toBe(1);
    expect(s.pending30dCount).toBe(0);
  });

  it('60 일 경과 + return30d 채워짐 + return60d 부재 — pending60dCount 1', () => {
    const signal = new Date('2026-01-01T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: signal,
    });
    const entries = loadCounterfactuals();
    entries[0].return30d = 5.0;  // 30d 만 채워짐
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(entries, null, 2));

    const now = new Date('2026-03-10T00:00:00Z'); // 68일 경과
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.resolved30dCount).toBe(1);
    expect(s.resolved60dCount).toBe(0);
    expect(s.pending60dCount).toBe(1);
  });

  it('90 일 경과 + 모두 해결 — resolved 30/60/90 모두 1', () => {
    const signal = new Date('2026-01-01T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: signal,
    });
    const entries = loadCounterfactuals();
    entries[0].return30d = 5.0;
    entries[0].return60d = 7.0;
    entries[0].return90d = 10.0;
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(entries, null, 2));

    const now = new Date('2026-04-15T00:00:00Z'); // 104일 경과
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.resolved30dCount).toBe(1);
    expect(s.resolved60dCount).toBe(1);
    expect(s.resolved90dCount).toBe(1);
    expect(s.pending30dCount).toBe(0);
    expect(s.pending60dCount).toBe(0);
    expect(s.pending90dCount).toBe(0);
  });

  it('oldestSignalDate — 최오래된 signalDate 반환', () => {
    const oldSignal = new Date('2026-01-15T00:00:00Z');
    const newSignal = new Date('2026-03-15T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: oldSignal,
    });
    recordCounterfactual({
      stockCode: '000660', stockName: 'b', priceAtSignal: 20_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: newSignal,
    });
    const s = summarizeUnresolvedCounterfactuals(new Date('2026-04-30T00:00:00Z'));
    expect(s.oldestSignalDate).toBe('2026-01-15');
  });

  it('혼재 시나리오 — pending30d=2, resolved30d=1, awaiting=1 (총 4건)', () => {
    // entry A: 35일 경과, return30d 부재
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: new Date('2026-03-01T00:00:00Z'),
    });
    // entry B: 40일 경과, return30d 채워짐
    recordCounterfactual({
      stockCode: '000660', stockName: 'b', priceAtSignal: 20_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: new Date('2026-02-25T00:00:00Z'),
    });
    // entry C: 32일 경과, return30d 부재
    recordCounterfactual({
      stockCode: '035720', stockName: 'c', priceAtSignal: 30_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: new Date('2026-03-04T00:00:00Z'),
    });
    // entry D: 10일 경과 — awaiting
    recordCounterfactual({
      stockCode: '035420', stockName: 'd', priceAtSignal: 40_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: new Date('2026-03-26T00:00:00Z'),
    });

    const entries = loadCounterfactuals();
    entries[1].return30d = 5.0;  // entry B 만 해결
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(entries, null, 2));

    const now = new Date('2026-04-05T00:00:00Z');
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.totalCount).toBe(4);
    expect(s.resolved30dCount).toBe(1);
    expect(s.pending30dCount).toBe(2);
    expect(s.awaitingHorizonCount).toBe(1);
  });

  it('잘못된 signalTime — elapsed 0 fallback, awaitingHorizonCount 1', () => {
    const signal = new Date('2026-04-15T00:00:00Z');
    recordCounterfactual({
      stockCode: '005930', stockName: 'a', priceAtSignal: 10_000,
      gateScore: 5, regime: 'R2_BULL', conditionKeys: [], skipReason: 'X',
      now: signal,
    });
    // signalTime 오염
    const entries = loadCounterfactuals();
    entries[0].signalTime = 'not-a-date';
    fs.writeFileSync(COUNTERFACTUAL_FILE, JSON.stringify(entries, null, 2));

    const now = new Date('2026-04-30T00:00:00Z');
    const s = summarizeUnresolvedCounterfactuals(now);
    expect(s.totalCount).toBe(1);
    expect(s.awaitingHorizonCount).toBe(1);  // elapsed=0 → < 30 → awaiting
  });
});
