// @responsibility 회귀 테스트 — learningLoopHealth (ADR-0130 PR-Diag) 7 지표 + Jaccard + variance + verdict 합성
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type {
  ReflectionReport,
  BiasHeatmapDailyEntry,
  BiasType,
} from './reflectionTypes.js';
import type { FailurePatternEntry } from '../persistence/failurePatternRepo.js';

const NOW = new Date('2026-04-30T06:00:00Z');
const TODAY = '2026-04-30';

function shiftDate(today: string, deltaDays: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function buildReflection(date: string, overrides: Partial<ReflectionReport> = {}): ReflectionReport {
  return {
    date,
    generatedAt: `${date}T10:00:00.000Z`,
    dailyVerdict: 'GOOD_DAY',
    keyLessons: [],
    questionableDecisions: [],
    tomorrowAdjustments: [],
    followUpActions: [],
    narrative: `${date} 본문 narrative`,
    mode: 'FULL',
    ...overrides,
  };
}

function writeReflection(tmpDir: string, report: ReflectionReport): void {
  const dir = path.join(tmpDir, 'reflections');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${report.date}.json`), JSON.stringify(report));
}

function writeBiasHeatmap(tmpDir: string, entries: BiasHeatmapDailyEntry[]): void {
  fs.writeFileSync(path.join(tmpDir, 'bias-heatmap.json'), JSON.stringify(entries));
}

function writeFailurePatterns(tmpDir: string, entries: FailurePatternEntry[]): void {
  fs.writeFileSync(path.join(tmpDir, 'failure-patterns.json'), JSON.stringify(entries));
}

function makePattern(id: string, exitDate: string, returnPct: number): FailurePatternEntry {
  return {
    id,
    stockCode: '005930',
    stockName: '삼성전자',
    entryDate: '2026-04-15T01:00:00Z',
    exitDate: `${exitDate}T01:00:00Z`,
    returnPct,
    conditionScores: { 1: 5, 2: 5, 3: 5 },
    gate1Score: 50,
    gate2Score: 50,
    gate3Score: 50,
    finalScore: 50,
    savedAt: `${exitDate}T01:00:00Z`,
  };
}

const ALL_BIAS_TYPES: BiasType[] = [
  'REGRET_AVERSION',
  'ENDOWMENT',
  'CONFIRMATION',
  'HERDING',
  'LOSS_AVERSION',
  'ANCHORING',
  'RECENCY',
  'OVERCONFIDENCE',
  'SUNK_COST',
  'FOMO',
];

describe('computeJaccardSimilarity', () => {
  let mod: typeof import('./learningLoopHealth.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./learningLoopHealth.js');
  });

  it('1. 동일 문자열 → 1.0', () => {
    expect(mod.computeJaccardSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('2. 완전히 다른 문자열 → 0', () => {
    expect(mod.computeJaccardSimilarity('aaa bbb', 'ccc ddd')).toBe(0);
  });

  it('3. 부분 겹침 → 0~1 사이', () => {
    const sim = mod.computeJaccardSimilarity('a b c d', 'a b e f');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('4. 둘 다 빈 문자열 → 1.0 (degenerate match)', () => {
    expect(mod.computeJaccardSimilarity('', '')).toBe(1);
  });

  it('5. 한쪽만 빈 문자열 → 0', () => {
    expect(mod.computeJaccardSimilarity('hello', '')).toBe(0);
    expect(mod.computeJaccardSimilarity('', 'hello')).toBe(0);
  });

  it('6. 한국어/영어 혼합 + 특수문자 정규화', () => {
    const sim = mod.computeJaccardSimilarity(
      '오늘은 GOOD_DAY 였다. 부분익절 +2.3%',
      '오늘은 GOOD_DAY 였다. 부분익절 +2.3%',
    );
    expect(sim).toBe(1);
  });

  it('7. NaN/null 입력 안전 fallback', () => {
    expect(mod.computeJaccardSimilarity(null as unknown as string, 'hello')).toBe(0);
    expect(mod.computeJaccardSimilarity('hello', undefined as unknown as string)).toBe(0);
  });
});

describe('computeVariance', () => {
  let mod: typeof import('./learningLoopHealth.js');
  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./learningLoopHealth.js');
  });

  it('1. 빈 배열 → 0', () => {
    expect(mod.computeVariance([])).toBe(0);
  });

  it('2. N=1 → 0', () => {
    expect(mod.computeVariance([5])).toBe(0);
  });

  it('3. 모두 동일값 → 0 (stateless 핵심 신호)', () => {
    expect(mod.computeVariance([1, 1, 1, 1, 1])).toBe(0);
  });

  it('4. 정규 분포 → 양수', () => {
    const v = mod.computeVariance([1, 2, 3, 4, 5]);
    expect(v).toBeGreaterThan(0);
  });

  it('5. NaN 포함 → 안전 fallback', () => {
    const v = mod.computeVariance([1, 2, NaN, Infinity, 3]);
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('collectLearningLoopHealth', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llh-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.LEARNING_FAILURE_PATTERN_INPUT_DISABLED;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. reflection 0건 → INSUFFICIENT_DATA', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.overallVerdict).toBe('INSUFFICIENT_DATA');
    expect(snap.silentVerdictRatio7d.totalReflections).toBe(0);
    expect(snap.warnings.some((w) => w.includes('부족'))).toBe(true);
  });

  it('2. 7일 동일 narrative + 동일 bias score → STATELESS verdict + warnings 다수', async () => {
    // 7일 같은 narrative + 같은 biasHeatmap 점수
    const sameNarrative = '오늘은 GOOD_DAY 였다 부분익절';
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(TODAY, -6 + i);
      writeReflection(tmpDir, buildReflection(date, {
        narrative: sameNarrative,
        tomorrowAdjustments: [{ text: sameNarrative, sourceIds: [] }],
      }));
    }
    const sameScores = ALL_BIAS_TYPES.map((b) => ({ bias: b, score: 1.0, evidence: 'static' }));
    const heatmap: BiasHeatmapDailyEntry[] = [];
    for (let i = 0; i < 7; i++) {
      heatmap.push({ date: shiftDate(TODAY, -6 + i), scores: sameScores });
    }
    writeBiasHeatmap(tmpDir, heatmap);

    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.overallVerdict).toBe('STATELESS');
    expect(snap.narrativeSimilarity7d.verdict).toBe('STATELESS');
    expect(snap.tomorrowVsNarrativeOverlap7d.verdict).toBe('COPY_PASTE');
    expect(snap.biasScoreVariance7d.verdict).toBe('STATELESS');
    expect(snap.biasScoreVariance7d.statelessCount).toBe(10);
    expect(snap.warnings.length).toBeGreaterThan(0);
  });

  it('3. 다양한 narrative + 다양한 bias score → HEALTHY 또는 DEGRADED (not STATELESS)', async () => {
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(TODAY, -6 + i);
      writeReflection(tmpDir, buildReflection(date, {
        narrative: `${date} 매우 다른 내용 ${i} 부분익절 ${i * 100}원 손실 ${i * 50}원`,
        tomorrowAdjustments: [{ text: `다른 조정 ${i}`, sourceIds: [] }],
      }));
    }
    const heatmap: BiasHeatmapDailyEntry[] = [];
    for (let i = 0; i < 7; i++) {
      heatmap.push({
        date: shiftDate(TODAY, -6 + i),
        scores: ALL_BIAS_TYPES.map((b) => ({ bias: b, score: i / 10, evidence: 'evolving' })),
      });
    }
    writeBiasHeatmap(tmpDir, heatmap);

    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(['HEALTHY', 'DEGRADED']).toContain(snap.overallVerdict);
    expect(snap.biasScoreVariance7d.statelessCount).toBe(0);
    expect(snap.biasScoreVariance7d.verdict).toBe('STATEFUL');
  });

  it('4. failurePatternIngestion ENV 우회 시 ingestedToReflection=false', async () => {
    writeFailurePatterns(tmpDir, [makePattern('p1', '2026-04-25', -8)]);
    process.env.LEARNING_FAILURE_PATTERN_INPUT_DISABLED = 'true';
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.failurePatternIngestion.activePatterns).toBe(1);
    expect(snap.failurePatternIngestion.ingestedToReflection).toBe(false);
  });

  it('5. failurePatternIngestion default 활성 시 ingestedToReflection=true (활성 패턴 ≥1)', async () => {
    writeFailurePatterns(tmpDir, [makePattern('p1', '2026-04-25', -8)]);
    delete process.env.LEARNING_FAILURE_PATTERN_INPUT_DISABLED;
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.failurePatternIngestion.activePatterns).toBe(1);
    expect(snap.failurePatternIngestion.ingestedToReflection).toBe(true);
  });

  it('6. reflectionImpactPhase phase2Active=false 영구 + reason 명시', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.reflectionImpactPhase.phase1Active).toBe(true);
    expect(snap.reflectionImpactPhase.phase2Active).toBe(false);
    expect(snap.reflectionImpactPhase.reason).toMatch(/Phase 2/);
  });

  it('7. signalScannerWeightLastUpdate 영구 false + reason 명시 (ADR-0130 §Non-scope)', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.signalScannerWeightLastUpdate.hasReflectionDriven).toBe(false);
    expect(snap.signalScannerWeightLastUpdate.reason.length).toBeGreaterThan(0);
  });

  it('8. SILENT 평결 비율 ≥0.5 시 warning 누적', async () => {
    // 5일 SILENT + 2일 GOOD_DAY
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(TODAY, -6 + i);
      writeReflection(tmpDir, buildReflection(date, {
        dailyVerdict: i < 5 ? 'SILENT' : 'GOOD_DAY',
        narrative: `다양한 ${date}`,
      }));
    }
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.silentVerdictRatio7d.silentCount).toBe(5);
    expect(snap.silentVerdictRatio7d.ratio).toBeCloseTo(5 / 7, 2);
    expect(snap.warnings.some((w) => w.includes('SILENT'))).toBe(true);
  });
});

describe('resolveWindowDays + resolveBiasStatelessThreshold (ADR-0130 옵션 B)', () => {
  let mod: typeof import('./learningLoopHealth.js');
  beforeEach(async () => {
    delete process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD;
    vi.resetModules();
    mod = await import('./learningLoopHealth.js');
  });
  afterEach(() => {
    delete process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD;
  });

  it('1. resolveWindowDays default — undefined → 7', () => {
    expect(mod.resolveWindowDays(undefined)).toBe(7);
  });
  it('2. resolveWindowDays clamp — 1 → 3 (MIN), 100 → 30 (MAX)', () => {
    expect(mod.resolveWindowDays(1)).toBe(3);
    expect(mod.resolveWindowDays(100)).toBe(30);
  });
  it('3. resolveWindowDays 정상 범위 통과 — 14 → 14', () => {
    expect(mod.resolveWindowDays(14)).toBe(14);
  });
  it('4. resolveWindowDays 정수화 — 14.7 → 14', () => {
    expect(mod.resolveWindowDays(14.7)).toBe(14);
  });
  it('5. resolveBiasStatelessThreshold default — undefined → 0', () => {
    expect(mod.resolveBiasStatelessThreshold(undefined)).toBe(0);
  });
  it('6. resolveBiasStatelessThreshold ENV 우선 — 0.02 명시 → 0.02', () => {
    process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD = '0.02';
    expect(mod.resolveBiasStatelessThreshold(0)).toBe(0.02);
    expect(mod.resolveBiasStatelessThreshold(undefined)).toBe(0.02);
  });
  it('7. resolveBiasStatelessThreshold opts 적용 (ENV 부재)', () => {
    expect(mod.resolveBiasStatelessThreshold(0.05)).toBe(0.05);
  });
  it('8. resolveBiasStatelessThreshold 음수 입력 → default 0', () => {
    expect(mod.resolveBiasStatelessThreshold(-1)).toBe(0);
  });
  it('9. resolveBiasStatelessThreshold ENV 잘못된 값 → opts fallback', () => {
    process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD = 'NaN';
    expect(mod.resolveBiasStatelessThreshold(0.03)).toBe(0.03);
  });
});

describe('collectLearningLoopHealth opts (windowDays + biasStatelessVarianceThreshold)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llh-opts-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    delete process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. windowDays opts 미지정 → default 7', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    expect(snap.windowDays).toBe(7);
    expect(snap.biasStatelessVarianceThreshold).toBe(0);
  });

  it('2. windowDays=14 명시 → snapshot 에 14 + clamp 통과', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW, { windowDays: 14 });
    expect(snap.windowDays).toBe(14);
  });

  it('3. windowDays=1 → clamp 3 (MIN)', async () => {
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW, { windowDays: 1 });
    expect(snap.windowDays).toBe(3);
  });

  it('4. biasStatelessVarianceThreshold=0.05 → variance ≤ 0.05 인 BiasType statelessCount', async () => {
    // 7일 다양 narrative + 모든 BiasType 분산 0.01 (작지만 0 아님)
    const sameNarrative = (d: string) => `${d} 다양 narrative`;
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(TODAY, -6 + i);
      writeReflection(tmpDir, buildReflection(date, { narrative: sameNarrative(date) }));
    }
    const heatmap: BiasHeatmapDailyEntry[] = [];
    for (let i = 0; i < 7; i++) {
      heatmap.push({
        date: shiftDate(TODAY, -6 + i),
        // 0.50, 0.51, 0.50, 0.51 ... 분산 ≈ 0.0003
        scores: ALL_BIAS_TYPES.map((b) => ({
          bias: b,
          score: i % 2 === 0 ? 0.50 : 0.51,
          evidence: 'tiny',
        })),
      });
    }
    writeBiasHeatmap(tmpDir, heatmap);
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    // threshold=0 (default) — 분산이 0 보다 크므로 statelessCount 0
    const strict = collectLearningLoopHealth(NOW);
    expect(strict.biasScoreVariance7d.statelessCount).toBe(0);
    // threshold=0.05 → 0.0003 ≤ 0.05 라 모두 stateless
    const lenient = collectLearningLoopHealth(NOW, { biasStatelessVarianceThreshold: 0.05 });
    expect(lenient.biasScoreVariance7d.statelessCount).toBe(10);
    expect(lenient.biasStatelessVarianceThreshold).toBe(0.05);
  });

  it('5. ENV LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD 우선 (opts 무시)', async () => {
    process.env.LEARNING_BIAS_STATELESS_VARIANCE_THRESHOLD = '0.02';
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW, { biasStatelessVarianceThreshold: 0 });
    expect(snap.biasStatelessVarianceThreshold).toBe(0.02);
  });

  it('6. windowDays=14 + 14일 fixture → 14건 narrative samples', async () => {
    for (let i = 0; i < 14; i++) {
      const date = shiftDate(TODAY, -13 + i);
      writeReflection(tmpDir, buildReflection(date, { narrative: `${date} 다양` }));
    }
    const { collectLearningLoopHealth } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW, { windowDays: 14 });
    expect(snap.windowDays).toBe(14);
    expect(snap.narrativeSimilarity7d.samples).toBeGreaterThanOrEqual(7);
  });
});

describe('parseWindowDaysArg (cmd 인자 파싱)', () => {
  beforeEach(() => vi.resetModules());

  it('1. args 부재 → undefined (cmd default 적용)', async () => {
    const mod = await import('../telegram/commands/system/learningLoopHealth.cmd.js');
    expect(mod.parseWindowDaysArg(undefined)).toBeUndefined();
    expect(mod.parseWindowDaysArg([])).toBeUndefined();
  });

  it('2. 숫자 인자 → 정수 반환', async () => {
    const mod = await import('../telegram/commands/system/learningLoopHealth.cmd.js');
    expect(mod.parseWindowDaysArg(['14'])).toBe(14);
    expect(mod.parseWindowDaysArg(['7.9'])).toBe(7);
  });

  it('3. 잘못된 인자 → undefined (cmd default fallback)', async () => {
    const mod = await import('../telegram/commands/system/learningLoopHealth.cmd.js');
    expect(mod.parseWindowDaysArg(['abc'])).toBeUndefined();
  });

  it('4. clamp 는 cmd 가 안 함 — collectLearningLoopHealth 위임', async () => {
    const mod = await import('../telegram/commands/system/learningLoopHealth.cmd.js');
    // 100 입력해도 cmd 는 100 그대로 — 내부 resolveWindowDays 가 clamp
    expect(mod.parseWindowDaysArg(['100'])).toBe(100);
  });
});

describe('formatLearningLoopHealthMessage', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llh-fmt-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. INSUFFICIENT_DATA 시 ⚪ 이모지 + 경고 라인 포함', async () => {
    const { collectLearningLoopHealth, formatLearningLoopHealthMessage } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    const msg = formatLearningLoopHealthMessage(snap);
    expect(msg).toContain('⚪');
    expect(msg).toContain('INSUFFICIENT_DATA');
    expect(msg).toContain('자기학습 루프 헬스');
  });

  it('2. STATELESS 시 🔴 이모지', async () => {
    const sameNarrative = '오늘은 GOOD_DAY';
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(TODAY, -6 + i);
      writeReflection(tmpDir, buildReflection(date, {
        narrative: sameNarrative,
        tomorrowAdjustments: [{ text: sameNarrative, sourceIds: [] }],
      }));
    }
    const { collectLearningLoopHealth, formatLearningLoopHealthMessage } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    const msg = formatLearningLoopHealthMessage(snap);
    expect(msg).toContain('🔴');
    expect(msg).toContain('STATELESS');
  });

  it('3. 7개 지표 라인 모두 노출', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    const { collectLearningLoopHealth, formatLearningLoopHealthMessage } = await import('./learningLoopHealth.js');
    const snap = collectLearningLoopHealth(NOW);
    const msg = formatLearningLoopHealthMessage(snap);
    expect(msg).toContain('narrative 유사도');
    expect(msg).toContain('biasHeatmap');
    expect(msg).toContain('failurePattern');
    expect(msg).toContain('reflectionImpact');
    expect(msg).toContain('tomorrow');
    expect(msg).toContain('signalScanner');
    expect(msg).toContain('SILENT 평결');
  });
});
