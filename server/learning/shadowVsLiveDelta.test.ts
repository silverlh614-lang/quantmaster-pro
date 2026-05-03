/**
 * @responsibility ADR-0174 §2.2 ShadowVsLiveDelta 회귀 — 5 카테고리 분류 + missedAlpha + ENV + 안전 fallback
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  ALL_DELTA_CATEGORIES,
  computeShadowVsLiveDelta,
  DEFAULT_FUTURE_RETURN_HORIZON,
  DEFAULT_LOOKBACK_DAYS,
  isShadowVsLiveDeltaEnabled,
  MACRO_GATE_REASONS,
  type DeltaCategoryResult,
} from './shadowVsLiveDelta.js';
import type {
  ShadowLearningOnlyScanReason,
  ShadowLearningOnlySignal,
} from '../trading/shadowLearningOnlyScan.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

const ENV_KEY = 'SHADOW_LIVE_DELTA_REPORT_ENABLED';

beforeEach(() => {
  process.env[ENV_KEY] = 'true';
});

afterEach(() => {
  delete process.env[ENV_KEY];
});

// ─── 테스트 헬퍼 ─────────────────────────────────────────────────────────────

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function makeSignal(
  overrides: Partial<ShadowLearningOnlySignal> = {},
): ShadowLearningOnlySignal {
  return {
    symbol: '005930',
    signalDate: isoToday(),
    blockedReason: 'FOMC_BLOCK',
    wouldHaveBought: true,
    hypotheticalEntryPrice: 70000,
    hypotheticalStopLoss: 65000,
    hypotheticalTargetPrice: 80000,
    signalGrade: 'BUY',
    gateScore: 70,
    regime: 'R3_NEUTRAL',
    macroBlockReason: 'fomc',
    dataQualityStatus: 'OK',
    futureReturn5d: 0.02,
    ...overrides,
  };
}

function makeTrade(
  overrides: Partial<ServerShadowTrade> = {},
): ServerShadowTrade {
  return {
    id: 'trade-1',
    stockCode: '005930',
    stockName: '삼성전자',
    signalTime: new Date().toISOString(), // 오늘 KST
    signalPrice: 70000,
    shadowEntryPrice: 70000,
    quantity: 10,
    stopLoss: 65000,
    targetPrice: 80000,
    status: 'ACTIVE',
    returnPct: 0.01,
    ...overrides,
  };
}

function findResult(
  results: DeltaCategoryResult[],
  category: string,
): DeltaCategoryResult {
  const r = results.find((x) => x.category === category);
  if (!r) {
    throw new Error(`Category ${category} not found`);
  }
  return r;
}

// ─── ENV 분기 ─────────────────────────────────────────────────────────────────

describe('isShadowVsLiveDeltaEnabled — ENV 정확 비교', () => {
  it('ENV 미설정 → false (default OFF)', () => {
    delete process.env[ENV_KEY];
    expect(isShadowVsLiveDeltaEnabled()).toBe(false);
  });

  it("ENV='true' → true", () => {
    process.env[ENV_KEY] = 'true';
    expect(isShadowVsLiveDeltaEnabled()).toBe(true);
  });

  it("ENV='false' / 'TRUE' / '1' → false (정확 비교)", () => {
    for (const v of ['false', 'TRUE', '1', 'yes']) {
      process.env[ENV_KEY] = v;
      expect(isShadowVsLiveDeltaEnabled()).toBe(false);
    }
  });

  it('computeShadowVsLiveDelta — ENV OFF → 빈 배열 즉시', () => {
    delete process.env[ENV_KEY];
    const result = computeShadowVsLiveDelta({
      shadowSignals: [makeSignal()],
      liveTrades: [makeTrade()],
    });
    expect(result).toEqual([]);
  });
});

// ─── 5 카테고리 분류 ─────────────────────────────────────────────────────────

describe('5 카테고리 분류 SSOT', () => {
  it('MACRO_GATE_REASONS — 5 union 검증', () => {
    expect(MACRO_GATE_REASONS.has('FOMC_BLOCK')).toBe(true);
    expect(MACRO_GATE_REASONS.has('VIX_SPIKE')).toBe(true);
    expect(MACRO_GATE_REASONS.has('RISK_OFF_REGIME')).toBe(true);
    expect(MACRO_GATE_REASONS.has('R0_CRISIS')).toBe(true);
    expect(MACRO_GATE_REASONS.has('R1_DEFENSIVE')).toBe(true);
    expect(MACRO_GATE_REASONS.has('LIQUIDITY_BLOCK')).toBe(false);
    expect(MACRO_GATE_REASONS.has('MANUAL_BLOCK')).toBe(false);
  });

  it('ALL_DELTA_CATEGORIES — 5 카테고리', () => {
    expect(ALL_DELTA_CATEGORIES).toHaveLength(5);
    expect(ALL_DELTA_CATEGORIES).toContain('SHADOW_BUY_LIVE_BLOCKED');
    expect(ALL_DELTA_CATEGORIES).toContain('LIVE_BUY_SHADOW_BETTER_SIZE');
    expect(ALL_DELTA_CATEGORIES).toContain('EXPOSURE_CAP_REDUCED');
    expect(ALL_DELTA_CATEGORIES).toContain('MACRO_GATE_BLOCKED');
    expect(ALL_DELTA_CATEGORIES).toContain('LIQUIDITY_GATE_BLOCKED');
  });
});

describe('SHADOW_BUY_LIVE_BLOCKED 매칭', () => {
  it('wouldHaveBought=true AND LIVE 부재 (KST 일자 매칭) → 분류', () => {
    // signal: 오늘 KST, LIVE trade 없음
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          symbol: '005930',
          signalDate: isoToday(),
          wouldHaveBought: true,
          // 매크로 게이트 reason 이면 MACRO_GATE_BLOCKED 가 우선
          // 본 케이스는 MANUAL_BLOCK 사용 (LIQUIDITY/MACRO 분류 제외 + wouldHaveBought 검증)
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.05,
        }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'SHADOW_BUY_LIVE_BLOCKED').sampleSize).toBe(1);
    expect(findResult(result, 'SHADOW_BUY_LIVE_BLOCKED').shadowReturnSum).toBeCloseTo(0.05, 6);
  });

  it('wouldHaveBought=true + LIVE 동일 종목 동일 일자 존재 → SHADOW_BUY_LIVE_BLOCKED 분류 안 함', () => {
    const today = isoToday();
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          symbol: '005930',
          signalDate: today,
          wouldHaveBought: true,
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.05,
        }),
      ],
      liveTrades: [
        makeTrade({
          stockCode: '005930',
          signalTime: `${today}T01:23:45.000Z`, // 동일 일자 KST
        }),
      ],
    });
    expect(findResult(result, 'SHADOW_BUY_LIVE_BLOCKED').sampleSize).toBe(0);
  });

  it('wouldHaveBought=true + LIVE 다른 종목 → SHADOW_BUY_LIVE_BLOCKED 분류 (종목 매칭)', () => {
    const today = isoToday();
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          symbol: '005930',
          signalDate: today,
          wouldHaveBought: true,
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.04,
        }),
      ],
      liveTrades: [
        makeTrade({
          stockCode: '000660', // 다른 종목
          signalTime: `${today}T01:23:45.000Z`,
        }),
      ],
    });
    expect(findResult(result, 'SHADOW_BUY_LIVE_BLOCKED').sampleSize).toBe(1);
  });

  it('wouldHaveBought=false → 분류 안 함', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          wouldHaveBought: false,
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.05,
        }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'SHADOW_BUY_LIVE_BLOCKED').sampleSize).toBe(0);
  });
});

describe('MACRO_GATE_BLOCKED 분기', () => {
  it.each<[ShadowLearningOnlyScanReason]>([
    ['FOMC_BLOCK'],
    ['VIX_SPIKE'],
    ['RISK_OFF_REGIME'],
    ['R0_CRISIS'],
    ['R1_DEFENSIVE'],
  ])('reason=%s → MACRO_GATE_BLOCKED', (reason) => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({ blockedReason: reason, futureReturn5d: -0.03 }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'MACRO_GATE_BLOCKED').sampleSize).toBe(1);
    expect(findResult(result, 'MACRO_GATE_BLOCKED').shadowReturnSum).toBeCloseTo(-0.03, 6);
  });
});

describe('LIQUIDITY_GATE_BLOCKED 분기', () => {
  it('blockedReason=LIQUIDITY_BLOCK → LIQUIDITY_GATE_BLOCKED', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({ blockedReason: 'LIQUIDITY_BLOCK', futureReturn5d: 0.02 }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'LIQUIDITY_GATE_BLOCKED').sampleSize).toBe(1);
    expect(findResult(result, 'LIQUIDITY_GATE_BLOCKED').shadowReturnSum).toBeCloseTo(0.02, 6);
  });
});

describe('EXPOSURE_CAP_REDUCED — cappedByBudget 매칭 (옵셔널 schema)', () => {
  it('LIVE trade cappedByBudget=true → EXPOSURE_CAP_REDUCED', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [],
      liveTrades: [
        // cappedByBudget 은 ServerShadowTrade schema 영속 부재 — `as any` cast 로 옵셔널 주입
        {
          ...makeTrade({ stockCode: '005930', returnPct: 0.03 }),
          cappedByBudget: true,
        } as ServerShadowTrade,
      ],
    });
    expect(findResult(result, 'EXPOSURE_CAP_REDUCED').sampleSize).toBe(1);
    expect(findResult(result, 'EXPOSURE_CAP_REDUCED').liveReturnSum).toBeCloseTo(0.03, 6);
  });

  it('cappedByBudget 필드 부재 → 빈 결과 (회귀 안전)', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [],
      liveTrades: [makeTrade({ stockCode: '005930' })], // cappedByBudget 부재
    });
    expect(findResult(result, 'EXPOSURE_CAP_REDUCED').sampleSize).toBe(0);
  });
});

describe('LIVE_BUY_SHADOW_BETTER_SIZE — plumbing only', () => {
  it('sizingEngineSnapshot 정의된 trade → 카운트', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [],
      liveTrades: [
        makeTrade({
          stockCode: '005930',
          returnPct: 0.025,
          sizingEngineSnapshot: {
            tierName: 'GROWTH',
            basePct: 0.12,
            finalPositionPct: 0.10,
            finalPositionKrw: 1_000_000,
            drawdownMultiplier: 1.0,
            lossStreakMultiplier: 1.0,
            liquidityMultiplier: 1.0,
            sectorExposureMultiplier: 1.0,
            expectedStopLossDamagePct: 0.005,
            signalPriorityApplied: false,
            adjustmentReasons: [],
            snapshotAt: new Date().toISOString(),
          },
        }),
      ],
    });
    expect(findResult(result, 'LIVE_BUY_SHADOW_BETTER_SIZE').sampleSize).toBe(1);
    expect(findResult(result, 'LIVE_BUY_SHADOW_BETTER_SIZE').liveReturnSum).toBeCloseTo(0.025, 6);
  });

  it('sizingEngineSnapshot 부재 → sampleSize=0 (Phase 1 plumbing — Phase 3 wiring 후 활성)', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [],
      liveTrades: [makeTrade({ stockCode: '005930' })], // sizingEngineSnapshot 부재
    });
    expect(findResult(result, 'LIVE_BUY_SHADOW_BETTER_SIZE').sampleSize).toBe(0);
  });
});

// ─── horizon / lookbackDays ──────────────────────────────────────────────────

describe('horizon / lookbackDays 분기', () => {
  it('horizon=5 default', () => {
    expect(DEFAULT_FUTURE_RETURN_HORIZON).toBe(5);
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          blockedReason: 'FOMC_BLOCK',
          futureReturn1d: 0.10, // 무시
          futureReturn5d: -0.02,
        }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'MACRO_GATE_BLOCKED').shadowReturnSum).toBeCloseTo(-0.02, 6);
  });

  it('horizon=20 — futureReturn20d 사용', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          blockedReason: 'VIX_SPIKE',
          futureReturn5d: 0.01,
          futureReturn20d: 0.15,
        }),
      ],
      liveTrades: [],
      options: { futureReturnHorizon: 20 },
    });
    expect(findResult(result, 'MACRO_GATE_BLOCKED').shadowReturnSum).toBeCloseTo(0.15, 6);
  });

  it('lookbackDays default 90 — 89일 통과 / 91일 제외', () => {
    expect(DEFAULT_LOOKBACK_DAYS).toBe(90);
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          signalDate: isoDaysAgo(89),
          blockedReason: 'FOMC_BLOCK',
          futureReturn5d: -0.01,
        }),
        makeSignal({
          signalDate: isoDaysAgo(91),
          blockedReason: 'FOMC_BLOCK',
          futureReturn5d: -0.02,
          symbol: '000660',
        }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'MACRO_GATE_BLOCKED').sampleSize).toBe(1);
  });

  it('lookbackDays=30 — 31일 전 제외', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          signalDate: isoDaysAgo(31),
          blockedReason: 'LIQUIDITY_BLOCK',
          futureReturn5d: 0.05,
        }),
      ],
      liveTrades: [],
      options: { lookbackDays: 30 },
    });
    expect(findResult(result, 'LIQUIDITY_GATE_BLOCKED').sampleSize).toBe(0);
  });
});

// ─── 안전 fallback ────────────────────────────────────────────────────────────

describe('안전 fallback', () => {
  it('빈 입력 → 5 카테고리 모두 sampleSize=0', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [],
      liveTrades: [],
    });
    expect(result).toHaveLength(5);
    for (const r of result) {
      expect(r.sampleSize).toBe(0);
      expect(r.shadowReturnSum).toBe(0);
      expect(r.liveReturnSum).toBe(0);
      expect(r.missedAlpha).toBe(0);
      expect(r.missedAlphaAvg).toBe(0);
    }
  });

  it('NaN futureReturn → 분류 제외', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: NaN }),
        makeSignal({
          blockedReason: 'LIQUIDITY_BLOCK',
          futureReturn5d: Infinity,
          symbol: '000660',
        }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'MACRO_GATE_BLOCKED').sampleSize).toBe(0);
    expect(findResult(result, 'LIQUIDITY_GATE_BLOCKED').sampleSize).toBe(0);
  });

  it('잘못된 signalDate → 분류 제외', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({ signalDate: 'invalid', blockedReason: 'FOMC_BLOCK' }),
        makeSignal({ signalDate: '2026/05/03', blockedReason: 'FOMC_BLOCK', symbol: '000660' }),
      ],
      liveTrades: [],
    });
    expect(findResult(result, 'MACRO_GATE_BLOCKED').sampleSize).toBe(0);
  });

  it('잘못된 LIVE signalTime → 분류 제외 (인덱스 미포함)', () => {
    const today = isoToday();
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          signalDate: today,
          wouldHaveBought: true,
          blockedReason: 'MANUAL_BLOCK',
          symbol: '005930',
          futureReturn5d: 0.03,
        }),
      ],
      liveTrades: [
        makeTrade({ stockCode: '005930', signalTime: 'invalid' }),
      ],
    });
    // LIVE trade 가 인덱스에 안 들어감 → SHADOW_BUY_LIVE_BLOCKED 분류
    expect(findResult(result, 'SHADOW_BUY_LIVE_BLOCKED').sampleSize).toBe(1);
  });

  it('LIVE returnPct undefined → 0 fallback', () => {
    const result = computeShadowVsLiveDelta({
      shadowSignals: [],
      liveTrades: [
        makeTrade({
          stockCode: '005930',
          returnPct: undefined,
          sizingEngineSnapshot: {
            tierName: 'GROWTH',
            basePct: 0.10,
            finalPositionPct: 0.10,
            finalPositionKrw: 1_000_000,
            drawdownMultiplier: 1.0,
            lossStreakMultiplier: 1.0,
            liquidityMultiplier: 1.0,
            sectorExposureMultiplier: 1.0,
            expectedStopLossDamagePct: 0.005,
            signalPriorityApplied: false,
            adjustmentReasons: [],
            snapshotAt: new Date().toISOString(),
          },
        }),
      ],
    });
    expect(findResult(result, 'LIVE_BUY_SHADOW_BETTER_SIZE').liveReturnSum).toBe(0);
  });
});

// ─── missedAlpha 산출 정확성 ──────────────────────────────────────────────────

describe('missedAlpha 산출', () => {
  it('missedAlpha 양수 — Shadow 가 샀더라면 더 큰 수익 (보수적 차단)', () => {
    const today = isoToday();
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          symbol: '005930',
          signalDate: today,
          wouldHaveBought: true,
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.10, // shadow 10%
        }),
      ],
      liveTrades: [], // LIVE 부재 — SHADOW_BUY_LIVE_BLOCKED
    });
    const blocked = findResult(result, 'SHADOW_BUY_LIVE_BLOCKED');
    expect(blocked.missedAlpha).toBeCloseTo(0.10, 6);
    expect(blocked.missedAlphaAvg).toBeCloseTo(0.10, 6);
    expect(blocked.missedAlpha).toBeGreaterThan(0);
  });

  it('missedAlpha 평균 — 다중 sample', () => {
    const today = isoToday();
    const result = computeShadowVsLiveDelta({
      shadowSignals: [
        makeSignal({
          symbol: '005930',
          signalDate: today,
          wouldHaveBought: true,
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.10,
        }),
        makeSignal({
          symbol: '000660',
          signalDate: today,
          wouldHaveBought: true,
          blockedReason: 'MANUAL_BLOCK',
          futureReturn5d: 0.04,
        }),
      ],
      liveTrades: [],
    });
    const blocked = findResult(result, 'SHADOW_BUY_LIVE_BLOCKED');
    expect(blocked.sampleSize).toBe(2);
    expect(blocked.missedAlpha).toBeCloseTo(0.14, 6);
    expect(blocked.missedAlphaAvg).toBeCloseTo(0.07, 6);
  });
});

// ─── 정적 grep 가드 ───────────────────────────────────────────────────────────

const SOURCE_PATH = path.join(__dirname, 'shadowVsLiveDelta.ts');

function readSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

/**
 * 주석 영역 strip — 정적 grep 가드의 false positive 차단.
 */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return out;
}

describe('정적 grep 가드 — 안전 invariant 검증', () => {
  it('KIS 주문 함수 5종 import 0건 (주석 영역 strip 후)', () => {
    const src = stripComments(readSource());
    expect(src).not.toMatch(/placeKisMarketOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('runAutoSignalScan 호출 0건 (주석 영역 strip 후)', () => {
    const src = stripComments(readSource());
    expect(src).not.toMatch(/runAutoSignalScan/);
  });

  it('외부 의존성 0 — fs / zustand / 외부 API import 부재', () => {
    const src = readSource();
    const importLines = src
      .split('\n')
      .filter((line) => /^\s*import\s+/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/from\s+['"]fs['"]/);
      expect(line).not.toMatch(/from\s+['"]node:fs['"]/);
      expect(line).not.toMatch(/zustand/);
      expect(line).not.toMatch(/axios/);
      expect(line).not.toMatch(/node-fetch/);
    }
  });
});

describe('호출자 0건 정적 grep 가드 — Phase 2a dead code', () => {
  it('server/ 전체 grep — computeShadowVsLiveDelta 호출 = 모듈 자체 + 테스트만', () => {
    const serverDir = path.join(__dirname, '..');
    const matches: string[] = [];
    const stack: string[] = [serverDir];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          stack.push(full);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        ) {
          const content = fs.readFileSync(full, 'utf-8');
          if (content.includes('computeShadowVsLiveDelta')) {
            matches.push(full);
          }
        }
      }
    }
    const allowedFiles = matches.filter(
      (m) =>
        m.endsWith('shadowVsLiveDelta.ts') ||
        m.endsWith('shadowVsLiveDelta.test.ts'),
    );
    expect(matches.length).toBe(allowedFiles.length);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});
