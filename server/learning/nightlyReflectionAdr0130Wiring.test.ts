// @responsibility 회귀 테스트 — nightlyReflectionEngine 의 ADR-0130 누적 컨텍스트 wiring
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ReflectionReport, BiasHeatmapDailyEntry } from './reflectionTypes.js';
import type { FailurePatternEntry } from '../persistence/failurePatternRepo.js';

function shiftDate(today: string, deltaDays: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** loadRecentReflections 가 new Date() 기반이라 테스트는 *실제 오늘* 기준으로 fixture 생성 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildReflection(date: string, overrides: Partial<ReflectionReport> = {}): ReflectionReport {
  return {
    date,
    generatedAt: `${date}T10:00:00.000Z`,
    dailyVerdict: 'GOOD_DAY',
    keyLessons: [{ text: '교훈 1', sourceIds: [] }],
    questionableDecisions: [],
    tomorrowAdjustments: [{ text: '내일 조정 텍스트', sourceIds: [] }],
    followUpActions: [],
    narrative: '오늘 narrative',
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
    conditionScores: {},
    gate1Score: 50, gate2Score: 50, gate3Score: 50, finalScore: 50,
    savedAt: `${exitDate}T01:00:00Z`,
  };
}

// loadRecentReflections 가 new Date() 기반이라 테스트의 TODAY 는 실제 오늘이어야 한다.
const TODAY = todayIso();

describe('buildRecentReflectionContexts (ADR-0130 PR-Fix-1)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nre-recent-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 영속 reflection 0건 → 빈 배열', async () => {
    const { buildRecentReflectionContexts } = await import('./nightlyReflectionEngine.js');
    const out = buildRecentReflectionContexts(TODAY, 7);
    expect(out).toEqual([]);
  });

  it('2. 7일 reflection + biasHeatmap → 7건 + biasTop3 score 내림차순', async () => {
    // loadRecentReflections 는 new Date() 기준 직전 7일 (오늘 포함). 테스트는
    // currentDate 를 *내일* 로 설정해 오늘 포함 7일이 모두 < currentDate 가 되게 한다.
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(TODAY, -6 + i);
      writeReflection(tmpDir, buildReflection(date));
    }
    const heatmap: BiasHeatmapDailyEntry[] = [];
    for (let i = 0; i < 7; i++) {
      heatmap.push({
        date: shiftDate(TODAY, -6 + i),
        scores: [
          { bias: 'HERDING', score: 1.0, evidence: 'h' },
          { bias: 'RECENCY', score: 0.95, evidence: 'r' },
          { bias: 'FOMO', score: 0.8, evidence: 'f' },
          { bias: 'ANCHORING', score: 0.5, evidence: 'a' },
        ],
      });
    }
    writeBiasHeatmap(tmpDir, heatmap);
    const { buildRecentReflectionContexts } = await import('./nightlyReflectionEngine.js');
    const tomorrow = shiftDate(TODAY, 1);
    const out = buildRecentReflectionContexts(tomorrow, 7);
    expect(out.length).toBe(7);
    expect(out[0].biasTop3.length).toBe(3);
    expect(out[0].biasTop3[0].bias).toBe('HERDING');
    expect(out[0].biasTop3[0].score).toBe(1.0);
    expect(out[0].biasTop3[1].bias).toBe('RECENCY');
    expect(out[0].biasTop3[2].bias).toBe('FOMO');
  });

  it('3. currentDate 자체는 제외 (직전 일자만)', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    writeReflection(tmpDir, buildReflection(shiftDate(TODAY, -1)));
    const { buildRecentReflectionContexts } = await import('./nightlyReflectionEngine.js');
    // currentDate=TODAY 로 호출 → 자기 자신 제외, 직전 일자만 노출
    const out = buildRecentReflectionContexts(TODAY, 7);
    expect(out.length).toBe(1);
    expect(out[0].date).toBe(shiftDate(TODAY, -1));
  });

  it('4. tomorrowAdjustments text 만 추출 (sourceIds 제외) + Top 3 절삭', async () => {
    writeReflection(tmpDir, buildReflection(shiftDate(TODAY, -1), {
      tomorrowAdjustments: [
        { text: 'A', sourceIds: ['s1'] },
        { text: 'B', sourceIds: ['s2'] },
        { text: 'C', sourceIds: ['s3'] },
        { text: 'D', sourceIds: ['s4'] },
      ],
    }));
    const { buildRecentReflectionContexts } = await import('./nightlyReflectionEngine.js');
    const out = buildRecentReflectionContexts(TODAY, 7);
    expect(out[0].tomorrowAdjustments).toEqual(['A', 'B', 'C']);
  });

  it('5. narrative 첫 문장 추출 + 200자 상한', async () => {
    const longNarrative = 'A'.repeat(500) + '.두번째 문장';
    writeReflection(tmpDir, buildReflection(shiftDate(TODAY, -1), {
      narrative: longNarrative,
    }));
    const { buildRecentReflectionContexts } = await import('./nightlyReflectionEngine.js');
    const out = buildRecentReflectionContexts(TODAY, 7);
    expect(out[0].narrativeFirstSentence?.length).toBeLessThanOrEqual(200);
  });
});

describe('buildActiveFailurePatternSummaries (ADR-0130 PR-Fix-2)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nre-fp-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. 영속 패턴 0건 → 빈 배열', async () => {
    const { buildActiveFailurePatternSummaries } = await import('./nightlyReflectionEngine.js');
    expect(buildActiveFailurePatternSummaries(5)).toEqual([]);
  });

  it('2. 패턴 8건 + topN=5 → 5건 + exitDate 내림차순', async () => {
    const patterns = [
      makePattern('p1', '2026-04-20', -5),
      makePattern('p2', '2026-04-22', -7),
      makePattern('p3', '2026-04-25', -3),
      makePattern('p4', '2026-04-15', -10),
      makePattern('p5', '2026-04-28', -8),
      makePattern('p6', '2026-04-29', -2),
      makePattern('p7', '2026-04-10', -6),
      makePattern('p8', '2026-04-26', -4),
    ];
    writeFailurePatterns(tmpDir, patterns);
    const { buildActiveFailurePatternSummaries } = await import('./nightlyReflectionEngine.js');
    const out = buildActiveFailurePatternSummaries(5);
    expect(out.length).toBe(5);
    expect(out[0].id).toBe('p6'); // 04-29
    expect(out[1].id).toBe('p5'); // 04-28
    expect(out[2].id).toBe('p8'); // 04-26
    expect(out[3].id).toBe('p3'); // 04-25
    expect(out[4].id).toBe('p2'); // 04-22
  });

  it('3. exitDate ISO → YYYY-MM-DD 추출', async () => {
    writeFailurePatterns(tmpDir, [makePattern('p1', '2026-04-25', -8)]);
    const { buildActiveFailurePatternSummaries } = await import('./nightlyReflectionEngine.js');
    const out = buildActiveFailurePatternSummaries(5);
    expect(out[0].exitDate).toBe('2026-04-25');
  });

  it('4. topN=0 → 빈 배열 / 음수 → 빈 배열 (안전 fallback)', async () => {
    writeFailurePatterns(tmpDir, [makePattern('p1', '2026-04-25', -8)]);
    const { buildActiveFailurePatternSummaries } = await import('./nightlyReflectionEngine.js');
    expect(buildActiveFailurePatternSummaries(0)).toEqual([]);
    expect(buildActiveFailurePatternSummaries(-1)).toEqual([]);
  });
});
