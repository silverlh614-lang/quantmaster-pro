import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ReflectionReport, BiasHeatmapDailyEntry, ExperimentProposal } from './reflectionTypes.js';

// fixed reference: 2026-04-25 (KST). UTC = 2026-04-24T15:00:00Z 가 KST 자정.
const NOW = new Date('2026-04-25T06:00:00Z'); // KST 15:00
const TODAY = '2026-04-25';

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
    keyLessons: [{ text: 'lesson 1', sourceIds: ['t1'] }],
    questionableDecisions: [],
    tomorrowAdjustments: [],
    followUpActions: [],
    narrative: '오늘은 부분익절이 누적 +2.3% 기여했고 STRONG_BUY 등급은 보수적이었다.',
    fiveWhy: [],
    integrity: { claimsIn: 5, claimsOut: 5, removed: [] },
    mode: 'FULL',
    ...overrides,
  };
}

function writeReflection(tmpDir: string, report: ReflectionReport): void {
  const reflectionsDir = path.join(tmpDir, 'reflections');
  fs.mkdirSync(reflectionsDir, { recursive: true });
  fs.writeFileSync(path.join(reflectionsDir, `${report.date}.json`), JSON.stringify(report));
}

function writeBiasHeatmap(tmpDir: string, entries: BiasHeatmapDailyEntry[]): void {
  fs.writeFileSync(path.join(tmpDir, 'bias-heatmap.json'), JSON.stringify(entries));
}

function writeExperiments(tmpDir: string, proposals: ExperimentProposal[]): void {
  fs.writeFileSync(path.join(tmpDir, 'experiment-proposals.json'), JSON.stringify(proposals));
}

describe('learningHistorySummary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-history-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('1. reflection 0건이면 healthy=false 이고 missing 경고 포함', async () => {
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const s = getLearningStatus(NOW);
    expect(s.lastReflection).toBeNull();
    expect(s.consecutiveMissingDays).toBeGreaterThanOrEqual(2);
    expect(s.diagnostics.healthy).toBe(false);
    expect(s.diagnostics.warnings.some(w => w.includes('reflection 없음'))).toBe(true);
  });

  it('2. 오늘 FULL reflection 정상이면 healthy=true', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const s = getLearningStatus(NOW);
    expect(s.lastReflection?.date).toBe(TODAY);
    expect(s.lastReflection?.mode).toBe('FULL');
    expect(s.lastReflection?.narrativeLength).toBeGreaterThan(0);
    expect(s.consecutiveMissingDays).toBe(0);
    expect(s.diagnostics.healthy).toBe(true);
  });

  it('3. mode=TEMPLATE_ONLY + narrativeLength=0 이면 템플릿 폴백 경고', async () => {
    writeReflection(tmpDir, buildReflection(TODAY, { mode: 'TEMPLATE_ONLY', narrative: '' }));
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const s = getLearningStatus(NOW);
    expect(s.diagnostics.healthy).toBe(false);
    expect(s.diagnostics.warnings.some(w => w.includes('템플릿 폴백'))).toBe(true);
  });

  it('4. integrityParseFailed=true 이면 Integrity 경고', async () => {
    writeReflection(tmpDir, buildReflection(TODAY, {
      integrity: { claimsIn: 0, claimsOut: 0, removed: [], parseFailed: true },
    }));
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const s = getLearningStatus(NOW);
    expect(s.lastReflection?.integrityParseFailed).toBe(true);
    expect(s.diagnostics.warnings.some(w => w.includes('Integrity'))).toBe(true);
  });

  it('5. LOSS_AVERSION 3일 [0.51,0.58,0.62] 이면 escalating', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    const dates = [shiftDate(TODAY, -2), shiftDate(TODAY, -1), TODAY];
    const scoresByDay = [0.51, 0.58, 0.62];
    const heatmap: BiasHeatmapDailyEntry[] = dates.map((d, i) => ({
      date: d,
      scores: [{ bias: 'LOSS_AVERSION', score: scoresByDay[i], evidence: 'test' }],
    }));
    writeBiasHeatmap(tmpDir, heatmap);
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const s = getLearningStatus(NOW);
    expect(s.diagnostics.warnings.some(w => w.includes('LOSS_AVERSION') && w.includes('escalating'))).toBe(true);
  });

  it('6. SILENCE_MONDAY 는 missing 카운트에서 제외 + mode 그대로 표기', async () => {
    const monday = shiftDate(TODAY, -1);
    writeReflection(tmpDir, buildReflection(monday, { mode: 'SILENCE_MONDAY', narrative: '' }));
    writeReflection(tmpDir, buildReflection(TODAY));
    const { getLearningHistory } = await import('./learningHistorySummary.js');
    const h = getLearningHistory(7, NOW);
    const monEntry = h.days.find(d => d.date === monday);
    expect(monEntry?.hasReflection).toBe(true);
    expect(monEntry?.silenceMonday).toBe(true);
    expect(monEntry?.mode).toBe('SILENCE_MONDAY');
    // SILENCE_MONDAY 는 totalReflections 에 안 들어감
    expect(h.totalReflections).toBe(1); // TODAY 만
  });

  it('7. days=7 요청 시 7개 일자 모두 반환, 없는 날은 hasReflection=false', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    writeReflection(tmpDir, buildReflection(shiftDate(TODAY, -3)));
    const { getLearningHistory } = await import('./learningHistorySummary.js');
    const h = getLearningHistory(7, NOW);
    expect(h.days.length).toBe(7);
    expect(h.days.filter(d => d.hasReflection).length).toBe(2);
    expect(h.missingDays).toBe(5);
  });

  it('8. ExperimentProposal 활성/완료 분류 + GOOGLE 잡은 케이스 확인', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    const proposals: ExperimentProposal[] = [
      { id: 'e1', proposedAt: '2026-04-20T00:00:00Z', hypothesis: 'h1', rationale: 'r1', method: 'm1', terminationCondition: 't1', track: 'YELLOW_AUTO', state: 'RUNNING' },
      { id: 'e2', proposedAt: '2026-04-21T00:00:00Z', hypothesis: 'h2', rationale: 'r2', method: 'm2', terminationCondition: 't2', track: 'RED_APPROVE', state: 'AWAIT_APPROVAL' },
      { id: 'e3', proposedAt: '2026-04-15T00:00:00Z', hypothesis: 'h3', rationale: 'r3', method: 'm3', terminationCondition: 't3', track: 'YELLOW_AUTO', state: 'COMPLETED' },
      { id: 'e4', proposedAt: '2026-04-10T00:00:00Z', hypothesis: 'h4', rationale: 'r4', method: 'm4', terminationCondition: 't4', track: 'RED_APPROVE', state: 'REJECTED' },
    ];
    writeExperiments(tmpDir, proposals);
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const s = getLearningStatus(NOW);
    expect(s.experimentProposalsActive.length).toBe(2);
    expect(s.experimentProposalsActive.map(p => p.id).sort()).toEqual(['e1', 'e2']);
    expect(s.experimentProposalsCompletedRecent.map(p => p.id)).toEqual(['e3']);
  });
});

describe('learningHistoryFormatter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-format-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('formatLearningStatusMessage — 정상 케이스에 ✅ 진단', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const { formatLearningStatusMessage } = await import('./learningHistoryFormatter.js');
    const msg = formatLearningStatusMessage(getLearningStatus(NOW));
    expect(msg).toContain('자기학습 상태');
    expect(msg).toContain(TODAY);
    expect(msg).toContain('✅ 진단: 정상');
  });

  it('formatLearningStatusMessage — reflection 0건이면 ⚠️ 진단', async () => {
    const { getLearningStatus } = await import('./learningHistorySummary.js');
    const { formatLearningStatusMessage } = await import('./learningHistoryFormatter.js');
    const msg = formatLearningStatusMessage(getLearningStatus(NOW));
    expect(msg).toContain('마지막 reflection: 없음');
    expect(msg).toContain('⚠️ 진단');
  });

  it('formatLearningHistoryMessage — 미실행 일자에 ❌ 미실행 표시', async () => {
    writeReflection(tmpDir, buildReflection(TODAY));
    const { getLearningHistory } = await import('./learningHistorySummary.js');
    const { formatLearningHistoryMessage } = await import('./learningHistoryFormatter.js');
    const msg = formatLearningHistoryMessage(getLearningHistory(7, NOW));
    expect(msg).toContain('자기학습 이력');
    expect(msg).toContain('❌ 미실행');
    expect(msg).toContain('총 reflection: 1/7일');
  });

  it('formatLearningHistoryMessage — SILENCE_MONDAY 는 ⏸️ 표기', async () => {
    const monday = shiftDate(TODAY, -1);
    writeReflection(tmpDir, buildReflection(monday, { mode: 'SILENCE_MONDAY', narrative: '' }));
    const { getLearningHistory } = await import('./learningHistorySummary.js');
    const { formatLearningHistoryMessage } = await import('./learningHistoryFormatter.js');
    const msg = formatLearningHistoryMessage(getLearningHistory(3, NOW));
    expect(msg).toContain('⏸️ SILENCE_MONDAY');
  });
});
