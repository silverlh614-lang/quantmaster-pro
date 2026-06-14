import { describe, expect, it } from 'vitest';
import { renderGateCompactSummary, renderGate1Compact, renderGate2Compact, renderGate3Compact } from './gateCompactRenderer.js';
import { lineCount, type SnapshotBundle } from './snapshotBundle.js';

export function sampleBundle(overrides: Partial<SnapshotBundle> = {}): SnapshotBundle {
  return {
    sourceSnapshotId: 'scan-eval-0523',
    asOf: '2026-05-24T09:00:00.000Z',
    marketSession: 'REGULAR',
    engineMode: 'SHADOW_ONLY',
    effectiveRegime: 'R6_DEFENSE',
    executionImpact: 'LIVE_BUY_BLOCKED',
    shadowLearning: true,
    gate1: {
      evaluated: 39,
      total: 43,
      pass: 18,
      averageScore: 68.4,
      requiredScore: 70,
      scoreNormalized: 38,
      technicalProjected: 39,
      rsUsable: 36,
      mainIssue: 'RS_WEAK',
      topBlockReason: 'TECHNICAL_MA_ALIGNMENT_DAMPENER',
      nextAction: 'Gate2 confluence review',
    },
    gate2: {
      evaluated: 18,
      passStrong: 4,
      passWeak: 9,
      watch: 3,
      fail: 2,
      dataIncomplete: 0,
      rsUsable: 16,
      supplyUsable: 14,
      sectorUsable: 12,
      technicalUsable: 18,
      fundamentalUsable: 9,
      topPositiveAxis: 'SUPPLY_CONFLUENCE',
      topMissingAxis: 'FUNDAMENTAL_QUALITY',
      nextAction: 'Gate3 timing for 13 candidates',
    },
    gate3: {
      evaluated: 13,
      ready: 0,
      triggerWait: 8,
      setupReady: 3,
      dataIncomplete: 2,
      timingFail: 0,
      rrrComputed: 11,
      rrrMissing: 2,
      lastTriggerTriggered: 0,
      lastTriggerWait: 8,
      priceConfirmed: 11,
      volumeWeak: 7,
      falseBreakoutPass: 10,
      falseBreakoutWatch: 3,
      nextAction: 'wait trigger / observe 3D',
    },
    execution: {
      entryReady: 3,
      liveBuyAllowed: 0,
      liveBuyBlocked: 3,
      shadowBuyAllowed: 3,
      observeOnly: 20,
      blocked: 0,
      topBlockReason: 'R6_DEFENSE_LIVE_BUY_BLOCKED',
      providerIssueConvertedToMarketSignal: 0,
      executionImpact: 'LIVE_BUY_BLOCKED',
      nextAction: 'observe / shadow learning',
    },
    learning: {
      seedsCreated: 24,
      pending: 88,
      labeled: 36,
      win: 8,
      loss: 5,
      missedWin: 6,
      avoidedLoss: 9,
      dataInsufficient: 8,
      shadowWins: 5,
      shadowLosses: 3,
      blockedMissed: 4,
      blockedAvoided: 7,
      topPositive: 'SUPPLY_CONFLUENCE',
      topOverBlock: 'R6_DEFENSE',
      nextAction: 'wait 10D labels',
    },
    providerHealth: { providerIssue: true, marketSignal: false },
    fullForensicText: 'FIELD_ALIAS_MAPPED raw key distribution should stay full only',
    ...overrides,
  };
}

describe('ADR-0523 Telegram Gate compact renderer', () => {
  it('keeps the all-gate compact summary within 12 lines and excludes full forensic text', () => {
    const text = renderGateCompactSummary(sampleBundle());

    expect(lineCount(text)).toBeLessThanOrEqual(12);
    expect(text).toContain('[QMP Gate Summary]');
    expect(text).toContain('learning: ON');
    expect(text).toContain('Next: observe / shadow learning');
    expect(text).not.toContain('FIELD_ALIAS_MAPPED');
    expect(text).not.toContain('raw key distribution');
  });

  it('renders Gate1/Gate2/Gate3 compact slices with only operating fields', () => {
    expect(renderGate1Compact(sampleBundle())).toContain('[Gate1 Survival]');
    expect(renderGate2Compact(sampleBundle())).toContain('topPositive: SUPPLY_CONFLUENCE');
    expect(renderGate3Compact(sampleBundle())).toContain('rrrComputed: 11/13');
  });

  // 진단 가시화: strong/weak 등급에 종목 코드 동반(per-symbol 추적). 카운트는 byte-equivalent.
  it('renders Gate2 strong/weak grade symbol codes alongside counts', () => {
    const text = renderGate2Compact(sampleBundle({
      gate2: {
        evaluated: 28, passStrong: 1, passWeak: 2, watch: 7, fail: 18, dataIncomplete: 0,
        rsUsable: 16, supplyUsable: 14, sectorUsable: 12, technicalUsable: 18, fundamentalUsable: 9,
        topPositiveAxis: 'SUPPLY_CONFLUENCE', topMissingAxis: 'FUNDAMENTAL_QUALITY',
        strongSymbols: ['196170'], weakSymbols: ['000660', '290660'],
        nextAction: 'Gate3 timing for 3 candidates',
      },
    }));
    expect(text).toContain('strong: 1 (196170)');
    expect(text).toContain('weak: 2 (000660,290660)');
    expect(text).toContain('fail: 18');
  });

  // 빈 등급(strong:0)은 코드 없이 카운트만 — graceful.
  it('renders empty grades as count-only without symbol parens', () => {
    const text = renderGate2Compact(sampleBundle({
      gate2: {
        evaluated: 5, passStrong: 0, passWeak: 0, watch: 0, fail: 5, dataIncomplete: 0,
        rsUsable: 4, supplyUsable: 3, sectorUsable: 2, technicalUsable: 5, fundamentalUsable: 2,
        topPositiveAxis: 'SUPPLY_CONFLUENCE', topMissingAxis: 'FUNDAMENTAL_QUALITY',
        nextAction: 'Gate3 timing for 0 candidates',
      },
    }));
    expect(text).toContain('strong: 0 / weak: 0 / watch: 0 / fail: 5');
    expect(text).not.toContain('strong: 0 (');
  });

  // 텔레그램 길이 보호: 종목 수 > 8 이면 top-8 + "+N more".
  it('truncates grade symbol list beyond 8 with +N more', () => {
    const many = Array.from({ length: 11 }, (_, i) => String(100000 + i));
    const text = renderGate2Compact(sampleBundle({
      gate2: {
        evaluated: 11, passStrong: 11, passWeak: 0, watch: 0, fail: 0, dataIncomplete: 0,
        rsUsable: 11, supplyUsable: 9, sectorUsable: 8, technicalUsable: 11, fundamentalUsable: 6,
        topPositiveAxis: 'SUPPLY_CONFLUENCE', topMissingAxis: 'FUNDAMENTAL_QUALITY',
        strongSymbols: many,
        nextAction: 'Gate3 timing for 11 candidates',
      },
    }));
    expect(text).toContain('+3 more)');
    expect(text).toContain('strong: 11 (100000,');
  });
});
