/**
 * @responsibility ADR-0124 텔레그램 리포트 BE 가시화 회귀 테스트
 *
 * ADR-0123 후속 PR — 학습 SSOT 의 BE 격리 (nightlyReflection + biasHeatmap)
 * 위에 텔레그램 포맷 함수 3개 (shadowProgressBriefing / weeklyIntegrityReport /
 * weeklySelfCritiqueReport) 의 BE 라인 조건부 표시 검증.
 *
 * 검증 패턴:
 * - 정적 grep: 3 파일 모두 옵셔널 BE 필드 + 포맷 라인 + propagate
 * - 동작: format 함수가 beFills > 0 시 BE 라인 노출, 0 또는 미전달 시 미노출
 * - 후방호환: ADR-0123 학습 SSOT 무회귀 (beFills 옵셔널)
 * - ENV 우회: BE_CLASSIFICATION_DISABLED=true 시 자동 0 → silent
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { formatShadowProgress, type ShadowProgress } from './shadowProgressBriefing.js';
import { formatWeeklyIntegrityReport, type WeeklyIntegrityStats } from './weeklyIntegrityReport.js';
import { formatWeeklySelfCritique, type WeeklySelfCritiqueInputs } from './weeklySelfCritiqueReport.js';

// ─────────────────────────────────────────────────────────────────────────────
// 정적 grep: 3 파일에 ADR-0124 wiring 명시 (drift 차단)
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0124 정적 grep — 3 파일 wiring 명시', () => {
  const root = path.resolve(__dirname);

  it('shadowProgressBriefing.ts — ShadowProgress.fillBeFills? + ADR-0124 주석', () => {
    const src = fs.readFileSync(path.join(root, 'shadowProgressBriefing.ts'), 'utf-8');
    expect(src).toMatch(/fillBeFills\?\s*:\s*number/);
    expect(src).toMatch(/ADR-0124/);
    // 포맷 함수 BE 라인 존재
    expect(src).toMatch(/beFills > 0.*본절/);
    // computeShadowProgress 가 fillBeFills propagate
    expect(src).toMatch(/fillBeFills:\s*fillAgg\.beFills/);
  });

  it('weeklyIntegrityReport.ts — WeeklyIntegrityStats.beFills? + ADR-0124 주석', () => {
    const src = fs.readFileSync(path.join(root, 'weeklyIntegrityReport.ts'), 'utf-8');
    expect(src).toMatch(/beFills\?\s*:\s*number/);
    expect(src).toMatch(/ADR-0124/);
    // 포맷 함수 BE 라인 존재
    expect(src).toMatch(/stats\.beFills.*>\s*0.*본절 fill/);
    // computeWeeklyIntegrityStats 가 beFills propagate
    expect(src).toMatch(/beFills:\s*fillAgg\.beFills/);
  });

  it('weeklySelfCritiqueReport.ts — WeeklySelfCritiqueInputs.fillStats.beFills? + ADR-0124 주석', () => {
    const src = fs.readFileSync(path.join(root, 'weeklySelfCritiqueReport.ts'), 'utf-8');
    expect(src).toMatch(/beFills\?\s*:\s*number/);
    expect(src).toMatch(/ADR-0124/);
    // formatWeeklySelfCritique 본절 라인
    expect(src).toMatch(/beFills > 0.*본절/);
    // runWeeklySelfCritique 가 fillStats.beFills propagate
    expect(src).toMatch(/beFills:\s*fillStats\.beFills/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 동작: 포맷 함수 BE 라인 조건부 표시
// ─────────────────────────────────────────────────────────────────────────────

function makeShadowProgress(overrides: Partial<ShadowProgress> = {}): ShadowProgress {
  return {
    dayElapsed: 5,
    totalDays: 60,
    winCount: 2,
    lossCount: 1,
    activeCount: 3,
    totalClosed: 3,
    totalSamples: 6,
    targetSamples: 30,
    winRatePct: 66.7,
    newToday: 1,
    etaDate: '2026-05-26',
    etaDaysRemain: 26,
    fillWins: 4,
    fillLosses: 2,
    fillBeFills: 0,
    fillWeightedReturnPct: 1.5,
    fillRealizedKrw: 150000,
    partialOnlyCount: 1,
    ...overrides,
  };
}

describe('formatShadowProgress — BE 라인 조건부 표시', () => {
  it('fillBeFills > 0 시 "/N본절" 라인 노출', () => {
    const msg = formatShadowProgress(makeShadowProgress({ fillBeFills: 3 }));
    expect(msg).toContain('🎯 실현 fill: 4익 / 2손 / 3본절');
  });

  it('fillBeFills === 0 시 본절 라인 미노출 (기존 형식 보존)', () => {
    const msg = formatShadowProgress(makeShadowProgress({ fillBeFills: 0 }));
    expect(msg).toContain('🎯 실현 fill: 4익 / 2손');
    expect(msg).not.toContain('본절');
  });

  it('fillBeFills 미전달 (undefined) 시 본절 라인 미노출 — 후방호환', () => {
    const p = makeShadowProgress();
    delete (p as Partial<ShadowProgress>).fillBeFills;
    const msg = formatShadowProgress(p);
    expect(msg).toContain('🎯 실현 fill: 4익 / 2손');
    expect(msg).not.toContain('본절');
  });

  it('익/손/본절 모두 0 시 실현 라인 자체 미노출 (filter Boolean)', () => {
    const msg = formatShadowProgress(
      makeShadowProgress({ fillWins: 0, fillLosses: 0, fillBeFills: 0 }),
    );
    expect(msg).not.toContain('🎯 실현 fill');
  });

  it('익/손=0 + 본절만 있어도 실현 라인 노출 (BE 단독 시나리오)', () => {
    const msg = formatShadowProgress(
      makeShadowProgress({ fillWins: 0, fillLosses: 0, fillBeFills: 2 }),
    );
    expect(msg).toContain('🎯 실현 fill: 0익 / 0손 / 2본절');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function makeWeeklyStats(overrides: Partial<WeeklyIntegrityStats> = {}): WeeklyIntegrityStats {
  return {
    weekRange: { fromIso: '2026-04-23T00:00:00Z', toIso: '2026-04-30T00:00:00Z' },
    totalThisWeek: 12,
    byDow: { 1: 3, 2: 5, 3: 4 },
    byHour: { 9: 4, 10: 3, 14: 5 },
    activeCount: 4,
    winCount: 5,
    lossCount: 3,
    winRatePct: 62.5,
    fillWins: 7,
    fillLosses: 4,
    beFills: 0,
    fillWeightedReturnPct: 2.3,
    fillRealizedKrw: 280000,
    partialOnlyCount: 2,
    topPassingConditions: [],
    logicHashes: {},
    stallReason: '정상',
    ...overrides,
  };
}

describe('formatWeeklyIntegrityReport — BE 라인 조건부 표시', () => {
  it('beFills > 0 시 "/ 본절 fill: N건" 노출', () => {
    const msg = formatWeeklyIntegrityReport(makeWeeklyStats({ beFills: 2 }));
    expect(msg).toContain('익 fill: 7건 / 손 fill: 4건 / 본절 fill: 2건');
  });

  it('beFills === 0 시 본절 라인 미노출 (기존 형식 보존)', () => {
    const msg = formatWeeklyIntegrityReport(makeWeeklyStats({ beFills: 0 }));
    expect(msg).toContain('익 fill: 7건 / 손 fill: 4건');
    expect(msg).not.toContain('본절 fill');
  });

  it('beFills 미전달 (undefined) 시 본절 라인 미노출 — 후방호환', () => {
    const stats = makeWeeklyStats();
    delete (stats as Partial<WeeklyIntegrityStats>).beFills;
    const msg = formatWeeklyIntegrityReport(stats);
    expect(msg).not.toContain('본절 fill');
  });

  it('partialOnlyCount + beFills 동시 활성', () => {
    const msg = formatWeeklyIntegrityReport(makeWeeklyStats({ beFills: 1, partialOnlyCount: 3 }));
    expect(msg).toContain('익 fill: 7건 / 손 fill: 4건 / 본절 fill: 1건 · 부분매도만 3건');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function makeCritiqueInputs(
  overrides: Partial<WeeklySelfCritiqueInputs['fillStats']> = {},
): WeeklySelfCritiqueInputs {
  return {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    fillStats: {
      fillCount: 8,
      winFills: 5,
      lossFills: 2,
      beFills: 0,
      weightedReturnPct: 1.8,
      totalRealizedKrw: 240000,
      fullClosedCount: 3,
      partialOnlyCount: 2,
      uniqueTradeCount: 5,
      ...overrides,
    },
    escalatingBiases: [],
    stopBuckets: [],
    totalStops: 0,
    recommendation: null,
    experimentProposalsActive: 0,
    experimentProposalsCompletedRecent: 0,
    reflectionMissingDays: 0,
  };
}

describe('formatWeeklySelfCritique — BE 라인 조건부 표시', () => {
  it('beFills > 0 시 "(승 N / 패 M / 본절 K)" 형식', () => {
    const msg = formatWeeklySelfCritique(makeCritiqueInputs({ beFills: 1 }));
    expect(msg).toContain('실현 fill: 8건 (승 5 / 패 2 / 본절 1)');
  });

  it('beFills === 0 시 본절 라인 미노출 (기존 형식 보존)', () => {
    const msg = formatWeeklySelfCritique(makeCritiqueInputs({ beFills: 0 }));
    expect(msg).toContain('실현 fill: 8건 (승 5 / 패 2)');
    expect(msg).not.toContain('본절');
  });

  it('beFills 미전달 (undefined) 시 본절 라인 미노출 — 후방호환', () => {
    const inputs = makeCritiqueInputs();
    delete inputs.fillStats.beFills;
    const msg = formatWeeklySelfCritique(inputs);
    expect(msg).toContain('실현 fill: 8건 (승 5 / 패 2)');
    expect(msg).not.toContain('본절');
  });

  it('fillCount === 0 시 "실현 fill 없음" — beFills 무관 기존 동작 보존', () => {
    const msg = formatWeeklySelfCritique(
      makeCritiqueInputs({ fillCount: 0, winFills: 0, lossFills: 0, beFills: 5 }),
    );
    expect(msg).toContain('실현 fill 없음');
    // fillCount === 0 분기는 beFills 무관, 본절 라벨 미노출
    expect(msg).not.toContain('본절');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0123 학습 SSOT 무회귀 (옵셔널 필드 추가가 영속/SSOT 본체 변경 안 함)
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0123 학습 SSOT 무회귀 가드', () => {
  const root = path.resolve(__dirname, '..');

  it('aggregateFillStats SSOT 의 beFills 옵셔널 필드 보존', () => {
    const src = fs.readFileSync(
      path.join(root, 'persistence/shadowTradeRepo.ts'),
      'utf-8',
    );
    expect(src).toMatch(/beFills\?\s*:\s*number/);
    expect(src).toMatch(/BE_CLASSIFICATION_DISABLED/);
    // ADR-0112 임계 보존
    expect(src).toMatch(/WIN_PCT_MIN\s*=\s*1\.0/);
    expect(src).toMatch(/BE_PCT_MIN\s*=\s*-0\.5/);
    expect(src).toMatch(/BE_PCT_MAX\s*=\s*0\.5/);
  });

  it('nightlyReflectionEngine 학습 BE 격리 보존 (ADR-0123 무회귀)', () => {
    const src = fs.readFileSync(
      path.join(root, 'learning/nightlyReflectionEngine.ts'),
      'utf-8',
    );
    expect(src).toMatch(/classifyFill/);
    expect(src).toMatch(/beFills\+\+/);
  });

  it('biasHeatmap.scoreLossAversion BE 격리 보존 (ADR-0123 무회귀)', () => {
    const src = fs.readFileSync(
      path.join(root, 'learning/reflectionModules/biasHeatmap.ts'),
      'utf-8',
    );
    expect(src).toMatch(/classifyFill/);
    // netLosses = max(0, lossFills - winFills) — BE 자동 제외 패턴 보존
    expect(src).toMatch(/Math\.max\(0,\s*lossFills\s*-\s*winFills\)/);
  });
});
