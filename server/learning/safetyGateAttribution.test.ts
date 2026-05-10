/**
 * @responsibility ADR-0174 §2.1 SafetyGateAttribution 회귀 — 7 게이트 매핑 + 산출 정확성 + ENV + 안전 fallback
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  ALL_GATE_NAMES,
  computeSafetyGateAttribution,
  DEFAULT_FUTURE_RETURN_HORIZON,
  DEFAULT_LOOKBACK_DAYS,
  isSafetyGateAttributionEnabled,
  type GateAttributionResult,
} from './safetyGateAttribution.js';
import type {
  ShadowLearningOnlyScanReason,
  ShadowLearningOnlySignal,
} from '../trading/shadowLearningOnlyScan.js';

const ENV_KEY = 'SAFETY_GATE_ATTRIBUTION_ENABLED';

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
    learningOnly: true,
    executionImpact: 'NONE',
  };
}

function findResult(
  results: GateAttributionResult[],
  gate: string,
): GateAttributionResult {
  const r = results.find((x) => x.gate === gate);
  if (!r) {
    throw new Error(`Gate ${gate} not found in results`);
  }
  return r;
}

// ─── ENV 분기 ─────────────────────────────────────────────────────────────────

describe('isSafetyGateAttributionEnabled — ENV 정확 비교', () => {
  it("ENV 미설정 → false (default OFF)", () => {
    delete process.env[ENV_KEY];
    expect(isSafetyGateAttributionEnabled()).toBe(false);
  });

  it("ENV='true' → true", () => {
    process.env[ENV_KEY] = 'true';
    expect(isSafetyGateAttributionEnabled()).toBe(true);
  });

  it("ENV='false' → false", () => {
    process.env[ENV_KEY] = 'false';
    expect(isSafetyGateAttributionEnabled()).toBe(false);
  });

  it("ENV='1' / 'TRUE' / 'yes' 임의 truthy → false (정확 비교)", () => {
    for (const v of ['1', 'TRUE', 'True', 'yes', 'on']) {
      process.env[ENV_KEY] = v;
      expect(isSafetyGateAttributionEnabled()).toBe(false);
    }
  });
});

describe('computeSafetyGateAttribution — ENV OFF', () => {
  it('ENV OFF → 빈 배열 즉시 반환 (signal 처리 안 함)', () => {
    delete process.env[ENV_KEY];
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.05 }),
    ]);
    expect(result).toEqual([]);
  });
});

// ─── 게이트 매핑 ──────────────────────────────────────────────────────────────

describe('게이트 매핑 — ShadowLearningOnlyScanReason → GateName', () => {
  it('FOMC_BLOCK → FOMC', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.03 }),
    ]);
    expect(findResult(result, 'FOMC').sampleSize).toBe(1);
    expect(findResult(result, 'VIX').sampleSize).toBe(0);
  });

  it('VIX_SPIKE → VIX', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'VIX_SPIKE', futureReturn5d: 0.04 }),
    ]);
    expect(findResult(result, 'VIX').sampleSize).toBe(1);
    expect(findResult(result, 'FOMC').sampleSize).toBe(0);
  });

  it('RISK_OFF_REGIME → R0_R1_REGIME', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'RISK_OFF_REGIME', futureReturn5d: -0.02 }),
    ]);
    expect(findResult(result, 'R0_R1_REGIME').sampleSize).toBe(1);
  });

  it('R0_CRISIS → R0_R1_REGIME', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'R0_CRISIS', futureReturn5d: -0.06 }),
    ]);
    expect(findResult(result, 'R0_R1_REGIME').sampleSize).toBe(1);
  });

  it('R1_DEFENSIVE → R0_R1_REGIME', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'R1_DEFENSIVE', futureReturn5d: -0.01 }),
    ]);
    expect(findResult(result, 'R0_R1_REGIME').sampleSize).toBe(1);
  });

  it('R0_R1_REGIME 3 reason 통합 — 동일 entry 누적', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'RISK_OFF_REGIME', futureReturn5d: -0.02 }),
      makeSignal({ blockedReason: 'R0_CRISIS', futureReturn5d: -0.05 }),
      makeSignal({ blockedReason: 'R1_DEFENSIVE', futureReturn5d: -0.03 }),
    ]);
    expect(findResult(result, 'R0_R1_REGIME').sampleSize).toBe(3);
    expect(findResult(result, 'R0_R1_REGIME').avoidedLoss).toBeCloseTo(0.10, 6);
  });

  it('LIQUIDITY_BLOCK → LIQUIDITY', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'LIQUIDITY_BLOCK', futureReturn5d: 0.01 }),
    ]);
    expect(findResult(result, 'LIQUIDITY').sampleSize).toBe(1);
  });

  it('R3_SANITY_BLOCK maps to DATA_SANITY', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'R3_SANITY_BLOCK', futureReturn5d: -0.04 }),
    ]);
    expect(findResult(result, 'DATA_SANITY').sampleSize).toBe(1);
  });

  it('MANUAL_BLOCK → 분류 제외 (어떤 게이트 sampleSize 도 증가 안 함)', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'MANUAL_BLOCK', futureReturn5d: -0.02 }),
    ]);
    for (const r of result) {
      expect(r.sampleSize).toBe(0);
    }
  });

  it('KRX_HOLIDAY_REPLAY → 분류 제외', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'KRX_HOLIDAY_REPLAY', futureReturn5d: 0.03 }),
    ]);
    for (const r of result) {
      expect(r.sampleSize).toBe(0);
    }
  });

  it('DATA_SANITY / EXPOSURE_BUDGET / ENEMY_CHECKLIST — Phase 3 wiring 후 활성, 본 PR sampleSize=0', () => {
    // ShadowLearningOnlyScanReason 직접 매핑 부재 → 항상 sampleSize=0
    const result = computeSafetyGateAttribution([]);
    expect(findResult(result, 'EXPOSURE_BUDGET').sampleSize).toBe(0);
    expect(findResult(result, 'ENEMY_CHECKLIST').sampleSize).toBe(0);
  });
});

// ─── 산출 정확성 ──────────────────────────────────────────────────────────────

describe('산출 정확성', () => {
  it('avoidedLoss = 차단된 종목 future return < 0 의 |sum|', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.05 }),
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.03, symbol: '000660' }),
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: 0.02, symbol: '035420' }),
    ]);
    const fomc = findResult(result, 'FOMC');
    expect(fomc.avoidedLoss).toBeCloseTo(0.08, 6);
    expect(fomc.missedGain).toBeCloseTo(0.02, 6);
  });

  it('missedGain = 차단된 종목 future return > 0 의 sum', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'VIX_SPIKE', futureReturn5d: 0.04 }),
      makeSignal({ blockedReason: 'VIX_SPIKE', futureReturn5d: 0.06, symbol: '000660' }),
    ]);
    const vix = findResult(result, 'VIX');
    expect(vix.missedGain).toBeCloseTo(0.10, 6);
    expect(vix.avoidedLoss).toBe(0);
  });

  it('netGateImpact 양수 — 게이트가 손실 방지에 기여', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.10 }),
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: 0.02, symbol: '000660' }),
    ]);
    const fomc = findResult(result, 'FOMC');
    expect(fomc.netGateImpact).toBeCloseTo(0.08, 6);
    expect(fomc.netGateImpact).toBeGreaterThan(0);
  });

  it('netGateImpact 음수 — 과보호 가능성 (게이트 완화 검토)', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: 0.10 }),
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.02, symbol: '000660' }),
    ]);
    const fomc = findResult(result, 'FOMC');
    expect(fomc.netGateImpact).toBeCloseTo(-0.08, 6);
    expect(fomc.netGateImpact).toBeLessThan(0);
  });

  it('blockedWinner / Loser 카운트 정확', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: 0.02 }), // winner
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.03, symbol: '000660' }), // loser
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: -0.05, symbol: '035420' }), // loser
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: 0, symbol: '011200' }), // BE — 카운트 안 함
    ]);
    const fomc = findResult(result, 'FOMC');
    expect(fomc.blockedWinnerCount).toBe(1);
    expect(fomc.blockedLoserCount).toBe(2);
    expect(fomc.sampleSize).toBe(4); // BE 도 sampleSize 카운트 (가독성)
  });

  it('gatePrecision NaN — 표본 0건', () => {
    const result = computeSafetyGateAttribution([]);
    for (const r of result) {
      expect(r.gatePrecision).toBeNaN();
    }
  });
});

// ─── horizon 분기 ────────────────────────────────────────────────────────────

describe('horizon 분기', () => {
  it('horizon=5 default — futureReturn5d 사용', () => {
    expect(DEFAULT_FUTURE_RETURN_HORIZON).toBe(5);
    const result = computeSafetyGateAttribution([
      makeSignal({
        blockedReason: 'FOMC_BLOCK',
        futureReturn1d: 0.01,
        futureReturn3d: 0.02,
        futureReturn5d: -0.05,
        futureReturn20d: 0.10,
      }),
    ]);
    const fomc = findResult(result, 'FOMC');
    expect(fomc.avoidedLoss).toBeCloseTo(0.05, 6);
  });

  it('horizon=1 — futureReturn1d 사용', () => {
    const result = computeSafetyGateAttribution(
      [
        makeSignal({
          blockedReason: 'FOMC_BLOCK',
          futureReturn1d: 0.04,
          futureReturn5d: -0.05,
        }),
      ],
      { futureReturnHorizon: 1 },
    );
    const fomc = findResult(result, 'FOMC');
    expect(fomc.missedGain).toBeCloseTo(0.04, 6);
    expect(fomc.avoidedLoss).toBe(0); // 5d -0.05 미사용
  });

  it('horizon=3 — futureReturn3d 사용', () => {
    const result = computeSafetyGateAttribution(
      [
        makeSignal({
          blockedReason: 'VIX_SPIKE',
          futureReturn3d: -0.07,
          futureReturn5d: 0.02,
        }),
      ],
      { futureReturnHorizon: 3 },
    );
    expect(findResult(result, 'VIX').avoidedLoss).toBeCloseTo(0.07, 6);
  });

  it('horizon=20 — futureReturn20d 사용', () => {
    const result = computeSafetyGateAttribution(
      [
        makeSignal({
          blockedReason: 'LIQUIDITY_BLOCK',
          futureReturn20d: 0.15,
        }),
      ],
      { futureReturnHorizon: 20 },
    );
    expect(findResult(result, 'LIQUIDITY').missedGain).toBeCloseTo(0.15, 6);
  });

  it('해당 horizon return 부재 (undefined) → 분류 제외', () => {
    const result = computeSafetyGateAttribution(
      [
        makeSignal({
          blockedReason: 'FOMC_BLOCK',
          futureReturn1d: undefined,
          futureReturn5d: -0.03,
        }),
      ],
      { futureReturnHorizon: 1 },
    );
    expect(findResult(result, 'FOMC').sampleSize).toBe(0);
  });
});

// ─── lookbackDays 필터 ───────────────────────────────────────────────────────

describe('lookbackDays 필터', () => {
  it('default 90일 — 89일 전 signal 통과', () => {
    expect(DEFAULT_LOOKBACK_DAYS).toBe(90);
    const result = computeSafetyGateAttribution([
      makeSignal({
        blockedReason: 'FOMC_BLOCK',
        signalDate: isoDaysAgo(89),
        futureReturn5d: -0.02,
      }),
    ]);
    expect(findResult(result, 'FOMC').sampleSize).toBe(1);
  });

  it('default 90일 — 91일 전 signal 제외', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({
        blockedReason: 'FOMC_BLOCK',
        signalDate: isoDaysAgo(91),
        futureReturn5d: -0.02,
      }),
    ]);
    expect(findResult(result, 'FOMC').sampleSize).toBe(0);
  });

  it('lookbackDays=30 — 31일 전 signal 제외', () => {
    const result = computeSafetyGateAttribution(
      [
        makeSignal({
          blockedReason: 'FOMC_BLOCK',
          signalDate: isoDaysAgo(31),
          futureReturn5d: -0.02,
        }),
      ],
      { lookbackDays: 30 },
    );
    expect(findResult(result, 'FOMC').sampleSize).toBe(0);
  });
});

// ─── 안전 fallback ────────────────────────────────────────────────────────────

describe('안전 fallback', () => {
  it('NaN futureReturn → 분류 제외', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', futureReturn5d: NaN }),
    ]);
    expect(findResult(result, 'FOMC').sampleSize).toBe(0);
  });

  it('Infinity futureReturn → 분류 제외', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'VIX_SPIKE', futureReturn5d: Infinity }),
      makeSignal({
        blockedReason: 'VIX_SPIKE',
        futureReturn5d: -Infinity,
        symbol: '000660',
      }),
    ]);
    expect(findResult(result, 'VIX').sampleSize).toBe(0);
  });

  it('빈 signals 배열 → 7 entry 모두 sampleSize=0', () => {
    const result = computeSafetyGateAttribution([]);
    expect(result).toHaveLength(ALL_GATE_NAMES.length);
    for (const r of result) {
      expect(r.sampleSize).toBe(0);
      expect(r.avoidedLoss).toBe(0);
      expect(r.missedGain).toBe(0);
      expect(r.netGateImpact).toBe(0);
      expect(r.blockedWinnerCount).toBe(0);
      expect(r.blockedLoserCount).toBe(0);
      expect(r.gatePrecision).toBeNaN();
    }
  });

  it('잘못된 signalDate (빈 문자열 / non-ISO) → 분류 제외', () => {
    const result = computeSafetyGateAttribution([
      makeSignal({ blockedReason: 'FOMC_BLOCK', signalDate: '', futureReturn5d: -0.02 }),
      makeSignal({ blockedReason: 'FOMC_BLOCK', signalDate: 'invalid', futureReturn5d: -0.02 }),
      makeSignal({ blockedReason: 'FOMC_BLOCK', signalDate: '2026/05/03', futureReturn5d: -0.02 }),
    ]);
    expect(findResult(result, 'FOMC').sampleSize).toBe(0);
  });
});

// ─── 정적 grep 가드 ───────────────────────────────────────────────────────────

const SOURCE_PATH = path.join(
  __dirname,
  'safetyGateAttribution.ts',
);

function readSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

/**
 * 주석 영역 strip — 정적 grep 가드의 false positive 차단.
 * 라인 주석 + 블록 주석 모두 제거 후 검사.
 */
function stripComments(src: string): string {
  // 블록 주석 제거 (multiline)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 라인 주석 제거
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
    // import statements 만 검증 (주석/문자열 안 fs 단어는 허용)
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
  it('server/ 전체 grep — computeSafetyGateAttribution 호출 = 모듈 자체 + 테스트만', () => {
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
          if (content.includes('computeSafetyGateAttribution')) {
            matches.push(full);
          }
        }
      }
    }
    // 허용: 정의/테스트 + read-only endpoint + missed replay + bounded policy feedback
    const allowedFiles = matches.filter(
      (m) =>
        m.endsWith('safetyGateAttribution.ts') ||
        m.endsWith('safetyGateAttribution.test.ts') ||
        m.endsWith('learningRouter.ts') ||
        m.endsWith('learningSanityDashboardRouter.test.ts') ||
        m.endsWith('missedLearningReplayDispatcher.ts') ||
        m.endsWith('safetyGatePolicyFeedback.ts'),
    );
    // 허용 파일 외 결과 0건 검증
    expect(matches.length).toBe(allowedFiles.length);
    expect(matches.length).toBeGreaterThanOrEqual(2); // 정의 + 테스트 최소 2
  });
});

// ─── 통합 시나리오 ────────────────────────────────────────────────────────────

describe('통합 시나리오 — 7 게이트 동시', () => {
  it('전 게이트 누적 — sampleSize / avoidedLoss / missedGain / gatePrecision 정합', () => {
    const reasons: ShadowLearningOnlyScanReason[] = [
      'FOMC_BLOCK',
      'VIX_SPIKE',
      'RISK_OFF_REGIME',
      'R0_CRISIS',
      'R1_DEFENSIVE',
      'LIQUIDITY_BLOCK',
      'MANUAL_BLOCK', // 분류 제외
      'KRX_HOLIDAY_REPLAY', // 분류 제외
    ];
    const symbolList = ['000001', '000002', '000003', '000004', '000005', '000006', '000007', '000008'];
    const signals: ShadowLearningOnlySignal[] = reasons.map((r, i) =>
      makeSignal({
        blockedReason: r,
        symbol: symbolList[i] ?? '000000',
        futureReturn5d: i % 2 === 0 ? 0.02 : -0.03,
      }),
    );
    const result = computeSafetyGateAttribution(signals);
    expect(findResult(result, 'FOMC').sampleSize).toBe(1);
    expect(findResult(result, 'VIX').sampleSize).toBe(1);
    expect(findResult(result, 'R0_R1_REGIME').sampleSize).toBe(3); // 3 reason 통합
    expect(findResult(result, 'LIQUIDITY').sampleSize).toBe(1);
    // MANUAL / KRX_HOLIDAY_REPLAY 분류 제외 → 어떤 게이트도 sampleSize 추가 안 됨
  });
});
