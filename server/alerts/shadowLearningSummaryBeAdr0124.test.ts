// @responsibility ADR-0124 PR-H 회귀 — shadowLearningSummary 일일 리포트 라인 BE 조건부 표기 검증.
/**
 * shadowLearningSummaryBeAdr0124.test.ts
 *
 * ADR-0124 후속 PR-H — `buildShadowLearningSummary` 의 reportLine/narrativeLine
 * BE(본절) 조건부 표기 검증. 선례: telegramReportsBeAdr0124.test.ts (PR-E/F/G).
 *
 * 검증 4 축:
 * - BE > 0 → "본절 fill N건" 노출 (reportLine + narrativeLine)
 * - BE = 0 → 기존 표기 byte 보존 (본절 미노출)
 * - BE_CLASSIFICATION_DISABLED=true → SSOT 가 0 반환 → 자동 silent
 * - 데이터 부족 (Rejection + Twin 부재) → BE 존재해도 빈 문자열 byte 보존
 *
 * loadShadowTrades 만 mock — aggregateFillStats(ADR-0112 SSOT) 는 실분류 사용.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('../learning/rejectionShadowTracker.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/rejectionShadowTracker.js');
  return {
    ...actual,
    summarizeRejectionShadow: vi.fn(),
  };
});

vi.mock('../learning/counterfactualTwinPortfolio.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../learning/counterfactualTwinPortfolio.js');
  return {
    ...actual,
    compareTwinsVsReal: vi.fn(),
  };
});

// 영속 파일 read 격리 — aggregateFillStats 는 실함수 그대로 (ADR-0112 분류 경로 검증).
vi.mock('../persistence/shadowTradeRepo.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../persistence/shadowTradeRepo.js');
  return {
    ...actual,
    loadShadowTrades: vi.fn(() => []),
  };
});

import * as rejectionRepo from '../learning/rejectionShadowTracker.js';
import * as twinRepo from '../learning/counterfactualTwinPortfolio.js';
import * as shadowRepo from '../persistence/shadowTradeRepo.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { buildShadowLearningSummary } from './shadowLearningSummary.js';

const mockedRej = vi.mocked(rejectionRepo.summarizeRejectionShadow);
const mockedComp = vi.mocked(twinRepo.compareTwinsVsReal);
const mockedLoad = vi.mocked(shadowRepo.loadShadowTrades);

function emptyComparison() {
  return {
    perTwin: {
      AGGRESSIVE: { twin: 'AGGRESSIVE' as const, activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
      DISCIPLINED: { twin: 'DISCIPLINED' as const, activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
      EQUAL_WEIGHT: { twin: 'EQUAL_WEIGHT' as const, activeCount: 0, closedCount: 0, avgReturnPct: 0, cumReturnPct: 0, weeklySharpeProxy: 0 },
    },
    realCumReturnPct: 0,
    weekWinning: { AGGRESSIVE: false, DISCIPLINED: false, EQUAL_WEIGHT: false },
  };
}

function reliableRejection() {
  return {
    totalCount: 10, closedCount: 8, activeCount: 2,
    avgClosedReturnPct: 2.5, medianClosedReturnPct: 1.0,
    falseNegativeRate: 0.25, quartiles: { q1: -1, q2: 1, q3: 5 },
    reliable: true,
  };
}

/** SELL CONFIRMED fill 합성 — pnlPct 만 분류에 유의미 (ADR-0112 임계). */
function makeTradeWithSellFills(pnlPcts: number[]): ServerShadowTrade {
  return {
    id: `t-${pnlPcts.join('_')}`,
    status: 'HIT_TARGET',
    fills: pnlPcts.map((pnlPct, i) => ({
      id: `f-${i}`,
      type: 'SELL',
      qty: 10,
      price: 10_000,
      timestamp: '2026-06-09T06:30:00.000Z',
      status: 'CONFIRMED',
      pnl: pnlPct * 1_000,
      pnlPct,
    })),
  } as unknown as ServerShadowTrade;
}

describe('ADR-0124 PR-H — buildShadowLearningSummary BE 조건부 표기', () => {
  const envBackup = process.env.BE_CLASSIFICATION_DISABLED;

  beforeEach(() => {
    mockedRej.mockReset();
    mockedComp.mockReset();
    mockedLoad.mockReset();
    mockedLoad.mockReturnValue([]);
    delete process.env.BE_CLASSIFICATION_DISABLED;
  });

  afterEach(() => {
    if (envBackup === undefined) delete process.env.BE_CLASSIFICATION_DISABLED;
    else process.env.BE_CLASSIFICATION_DISABLED = envBackup;
    vi.clearAllMocks();
  });

  it('BE fill > 0 → reportLine + narrativeLine 에 "본절 fill N건" 노출', () => {
    mockedRej.mockReturnValue(reliableRejection());
    mockedComp.mockReturnValue(emptyComparison());
    // pnlPct +0.2 / -0.3 → BE band (-0.5~+0.5, ADR-0112) 2건
    mockedLoad.mockReturnValue([makeTradeWithSellFills([0.2, -0.3])]);

    const result = buildShadowLearningSummary(0);
    expect(result.beFills).toBe(2);
    expect(result.reportLine).toContain('본절 fill 2건');
    expect(result.narrativeLine).toContain('본절 fill 2건');
  });

  it('BE fill = 0 (WIN/LOSS 만) → 기존 표기 byte 보존 — 본절 미노출', () => {
    mockedRej.mockReturnValue(reliableRejection());
    mockedComp.mockReturnValue(emptyComparison());
    // +5.0 → WIN (≥ +1.0), -3.0 → LOSS (< -0.5)
    mockedLoad.mockReturnValue([makeTradeWithSellFills([5.0, -3.0])]);

    const result = buildShadowLearningSummary(0);
    expect(result.beFills).toBe(0);
    // 기존 포맷 byte 동일성 (PR-H 이전과 동일)
    expect(result.reportLine).toBe('🌑 Shadow: Rejection 8건 (alpha 누락 25%) | Twin 우월 없음');
    expect(result.narrativeLine).toBe('Shadow 학습 — Rejection 8건 (alpha 누락 25%), Twin 비교: Twin 우월 없음');
    expect(result.reportLine).not.toContain('본절');
    expect(result.narrativeLine).not.toContain('본절');
  });

  it('BE_CLASSIFICATION_DISABLED=true → BE band fill 존재해도 자동 silent', () => {
    process.env.BE_CLASSIFICATION_DISABLED = 'true';
    mockedRej.mockReturnValue(reliableRejection());
    mockedComp.mockReturnValue(emptyComparison());
    mockedLoad.mockReturnValue([makeTradeWithSellFills([0.2, -0.3])]);

    const result = buildShadowLearningSummary(0);
    expect(result.beFills).toBe(0);
    expect(result.reportLine).not.toContain('본절');
    expect(result.narrativeLine).not.toContain('본절');
  });

  it('데이터 부족 (Rejection + Twin 부재) → BE 존재해도 빈 문자열 byte 보존', () => {
    mockedRej.mockReturnValue({
      totalCount: 0, closedCount: 0, activeCount: 0,
      avgClosedReturnPct: 0, medianClosedReturnPct: 0,
      falseNegativeRate: 0, quartiles: { q1: 0, q2: 0, q3: 0 },
      reliable: false,
    });
    mockedComp.mockReturnValue(emptyComparison());
    mockedLoad.mockReturnValue([makeTradeWithSellFills([0.2])]);

    const result = buildShadowLearningSummary(0);
    expect(result.reportLine).toBe('');
    expect(result.narrativeLine).toBe('');
    expect(result.topTwin).toBeNull();
    // raw 필드는 진단용으로 노출 (라인 생성과 분리)
    expect(result.beFills).toBe(1);
  });

  it('Twin 우월 + BE 동시 — 표기 순서 (rejPart | twinPart | 본절)', () => {
    mockedRej.mockReturnValue(reliableRejection());
    const comp = emptyComparison();
    comp.perTwin.AGGRESSIVE.cumReturnPct = 9.4;
    comp.perTwin.AGGRESSIVE.closedCount = 5;
    comp.realCumReturnPct = 4.2;
    mockedComp.mockReturnValue(comp);
    mockedLoad.mockReturnValue([makeTradeWithSellFills([0.0])]);

    const result = buildShadowLearningSummary(4.2);
    expect(result.reportLine).toContain('AGGR');
    expect(result.reportLine).toMatch(/vs CURRENT\) \| 본절 fill 1건$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 정적 grep — PR-H wiring 명시 (선례 telegramReportsBeAdr0124.test.ts drift 가드 패턴)
// ─────────────────────────────────────────────────────────────────────────────

describe('ADR-0124 PR-H 정적 grep — shadowLearningSummary.ts wiring 명시', () => {
  it('beFills 옵셔널 필드 + ADR-0124 주석 + aggregateFillStats SSOT + 조건부 본절 표기', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'shadowLearningSummary.ts'), 'utf-8');
    expect(src).toMatch(/beFills\?\s*:\s*number/);
    expect(src).toMatch(/ADR-0124/);
    expect(src).toMatch(/aggregateFillStats\(loadShadowTrades\(\)\)/);
    expect(src).toMatch(/beFills > 0.*본절/);
    // 학습 SSOT 무영향 — nightlyReflection/biasHeatmap import 부재
    expect(src).not.toMatch(/nightlyReflection|biasHeatmap/);
  });
});
