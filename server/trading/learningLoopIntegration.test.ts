import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

vi.setConfig({ testTimeout: 15000 });

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

describe('learning loop integration boundaries', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-loop-int-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.LEARNING_LOOP_KILL_SWITCH_DISABLED;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reflection confession flows through F2W into loadConditionWeights', async () => {
    const report = {
      date: day(0),
      generatedAt: `${day(0)}T10:00:00Z`,
      dailyVerdict: 'BAD_DAY',
      keyLessons: [],
      questionableDecisions: [],
      tomorrowAdjustments: [],
      followUpActions: [],
      conditionConfession: [{ conditionId: 2, passedCount: 1, winCount: 0, lossCount: 1, expiredCount: 0, falseSignalScore: 0.8 }],
      mode: 'FULL',
    };
    writeJson(path.join(tmpDir, 'reflections', `${day(-1)}.json`), { ...report, date: day(-1), generatedAt: `${day(-1)}T10:00:00Z` });
    writeJson(path.join(tmpDir, 'reflections', `${day(0)}.json`), report);

    const { runF2WReverseLoop } = await import('../learning/failureToWeight.js');
    const { loadConditionWeights } = await import('../persistence/conditionWeightsRepo.js');
    await runF2WReverseLoop();

    expect(loadConditionWeights().momentum).toBeCloseTo(0.95, 5);
  });

  it('biasHeatmap sustained heat reduces the bias position multiplier used by preflight sizing', async () => {
    writeJson(path.join(tmpDir, 'bias-heatmap.json'), [
      { date: day(-2), scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }] },
      { date: day(-1), scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }] },
      { date: day(0), scores: [{ bias: 'FOMO', score: 0.8, evidence: '' }] },
    ]);

    const { computeBiasPositionPenalty } = await import('../learning/biasPositionPenalty.js');
    expect(computeBiasPositionPenalty().multiplier).toBe(0.5);

    // ADR-0157/0168 SSOT: biasMultiplier 가 computeEffectiveKelly() 인자로 전달되어
    // Kelly 사이징에 자연 반영. 기존 인라인 곱셈(accountKellyMultiplier * biasMultiplier)은
    // computeEffectiveKelly SSOT 단일 통로로 통합 — wiring 자체(biasMultiplier 가 Kelly 산출에
    // 들어감)는 보존, 호출 구조만 SSOT 위임.
    const preflightSource = fs.readFileSync('server/trading/signalScanner/preflight.ts', 'utf-8');
    expect(preflightSource).toMatch(/const\s+biasMultiplier\s*=\s*biasPositionPenalty\.multiplier/);
    expect(preflightSource).toMatch(/computeEffectiveKelly\(\{[\s\S]*?biasMultiplier[\s\S]*?\}\)/);
    expect(preflightSource).toMatch(/computeEffectiveKelly\(\{[\s\S]*?accountMultiplier:\s*accountKellyMultiplier[\s\S]*?\}\)/);
  });

  it('STATELESS health flows into killSwitch trigger and env can disable it', async () => {
    const { assessKillSwitch } = await import('./killSwitch.js');
    expect(assessKillSwitch({ learningLoopLevel: 'STATELESS' }).triggers).toContain('LEARNING_LOOP_STATELESS');
    process.env.LEARNING_LOOP_KILL_SWITCH_DISABLED = 'true';
    expect(assessKillSwitch({ learningLoopLevel: 'STATELESS' }).triggers).not.toContain('LEARNING_LOOP_STATELESS');
  });

  it('server learning/trading does not import client recommendation channels', () => {
    const output = execFileSync(process.execPath, ['scripts/check_learning_channel_boundary.js'], {
      encoding: 'utf-8',
    });
    expect(output).toContain('ok');
  });
});
