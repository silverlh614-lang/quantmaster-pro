import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-canary-'));
process.env.PERSIST_DATA_DIR = tmpDir;

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(0),
}));

const { sendTelegramAlert } = await import('../alerts/telegramClient.js');
const canary = await import('./determinismCanary.js');
const { runDeterminismCanary, getCanaryHistory, __testOnly } = canary;

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

beforeEach(() => {
  try { fs.rmSync(path.join(tmpDir, 'determinism-canary.json'), { force: true }); } catch { /* noop */ }
  vi.mocked(sendTelegramAlert).mockClear();
});

describe('determinismCanary helpers', () => {
  it('hashWeights — 같은 입력 → 같은 해시 (결정적)', () => {
    const a = __testOnly.hashWeights({ momentum: 1.0, breakout: 0.5 });
    const b = __testOnly.hashWeights({ breakout: 0.5, momentum: 1.0 });
    expect(a).toBe(b);
  });

  it('hashWeights — 가중치 변경 → 다른 해시', () => {
    const a = __testOnly.hashWeights({ momentum: 1.0 });
    const b = __testOnly.hashWeights({ momentum: 1.1 });
    expect(a).not.toBe(b);
  });

  it('diffResults — 같은 결과 false, 다른 점수 true', () => {
    const r = { label: 'x', gateScore: 1.0, conditionKeys: ['a', 'b'], signalType: 'NORMAL' };
    expect(__testOnly.diffResults(r, { ...r })).toBe(false);
    expect(__testOnly.diffResults(r, { ...r, gateScore: 1.1 })).toBe(true);
    expect(__testOnly.diffResults(r, { ...r, conditionKeys: ['a'] })).toBe(true);
    expect(__testOnly.diffResults(r, { ...r, signalType: 'STRONG' })).toBe(true);
  });

  it('compareRuns — 어제 데이터 없으면 모든 fixture matched 처리', () => {
    const today = {
      date: '2026-04-26',
      weightsHash: 'abc',
      results: [
        { label: 'x', gateScore: 1.0, conditionKeys: ['m'], signalType: 'NORMAL' },
        { label: 'y', gateScore: 2.0, conditionKeys: ['b'], signalType: 'STRONG' },
      ],
    };
    const report = __testOnly.compareRuns(today, null);
    expect(report.previousDate).toBeNull();
    expect(report.matched).toBe(2);
    expect(report.mismatched).toBe(0);
    expect(report.unexpectedDrift).toEqual([]);
  });

  it('compareRuns — 가중치 미변경 + 결과 다름 → unexpectedDrift', () => {
    const yesterday = {
      date: '2026-04-25',
      weightsHash: 'same',
      results: [{ label: 'x', gateScore: 1.0, conditionKeys: ['m'], signalType: 'NORMAL' }],
    };
    const today = {
      date: '2026-04-26',
      weightsHash: 'same',
      results: [{ label: 'x', gateScore: 1.5, conditionKeys: ['m'], signalType: 'NORMAL' }],
    };
    const report = __testOnly.compareRuns(today, yesterday);
    expect(report.weightsChanged).toBe(false);
    expect(report.unexpectedDrift.length).toBe(1);
    expect(report.intendedDrift.length).toBe(0);
  });

  it('compareRuns — 가중치 변경 + 결과 다름 → intendedDrift', () => {
    const yesterday = {
      date: '2026-04-25',
      weightsHash: 'old',
      results: [{ label: 'x', gateScore: 1.0, conditionKeys: ['m'], signalType: 'NORMAL' }],
    };
    const today = {
      date: '2026-04-26',
      weightsHash: 'new',
      results: [{ label: 'x', gateScore: 1.5, conditionKeys: ['m'], signalType: 'NORMAL' }],
    };
    const report = __testOnly.compareRuns(today, yesterday);
    expect(report.weightsChanged).toBe(true);
    expect(report.unexpectedDrift.length).toBe(0);
    expect(report.intendedDrift.length).toBe(1);
  });
});

describe('runDeterminismCanary 통합', () => {
  it('첫 실행 — fixture 5건 결과 영속, drift 없음 (이전 데이터 없음)', async () => {
    const report = await runDeterminismCanary();
    expect(report.totalFixtures).toBe(5);
    expect(report.previousDate).toBeNull();
    expect(report.unexpectedDrift.length).toBe(0);
    expect(getCanaryHistory().length).toBe(1);
  });

  it('연속 실행 (같은 가중치, 같은 fixture) — 모든 결과 일치, 알림 0건', async () => {
    // Day 1
    await runDeterminismCanary(new Date('2026-04-25T17:00:00Z'));
    vi.mocked(sendTelegramAlert).mockClear();
    // Day 2 — 같은 코드/가중치/fixture
    const day2 = await runDeterminismCanary(new Date('2026-04-26T17:00:00Z'));
    expect(day2.previousDate).toBe('2026-04-25');
    expect(day2.matched).toBe(5);
    expect(day2.mismatched).toBe(0);
    expect(day2.unexpectedDrift.length).toBe(0);
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });

  it('같은 날 재실행 시 history 가 늘지 않고 마지막 entry 교체', async () => {
    await runDeterminismCanary(new Date('2026-04-26T17:00:00Z'));
    await runDeterminismCanary(new Date('2026-04-26T17:30:00Z'));
    expect(getCanaryHistory().length).toBe(1);
  });

  it('history 30개 cap', async () => {
    for (let i = 0; i < 35; i++) {
      const d = new Date(2026, 0, i + 1);
      await runDeterminismCanary(d);
    }
    expect(getCanaryHistory(50).length).toBe(30);
  });
});
