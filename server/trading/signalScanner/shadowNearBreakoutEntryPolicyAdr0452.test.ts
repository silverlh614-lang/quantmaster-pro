/**
 * @responsibility ADR-0452 — Shadow Near-Breakout Entry Liveness 회귀 테스트.
 *
 * 검증 대상 (사용자 §"권장 테스트" 50+ 케이스):
 *   - 5-value cause union (NEAR_ENTRY_PRICE / RETRY_ELIGIBLE_WAIT /
 *     LIVE_WAIT_BUT_SHADOW_OBSERVABLE / GATE_RECHECK_SOFT_FAIL / UNKNOWN)
 *   - 9-value blockReason union (RISK_BLOCKED / PRICE_TOO_FAR / VOLUME_TOO_WEAK /
 *     QUOTE_STALE / DUPLICATE_SHADOW_ENTRY / DAILY_CAP_REACHED / LIVE_ALREADY_ENTERED /
 *     NOT_SHADOW_MODE / UNKNOWN)
 *   - 절대 불변식 literal type (executionImpact: NONE / createLiveOrder: false /
 *     createPaperOrder: false / learningTag: SHADOW_NEAR_BREAKOUT_ENTRY)
 *   - 결정 트리 우선순위 (ENV → shadowMode → riskBlocked → quoteStale → 중복 →
 *     dailyCap → state별 분기)
 *   - SHADOW_NEAR_BREAKOUT_ENTRY_POLICY 임계 (MAX_DISTANCE_PCT / SOFT_DISTANCE_PCT /
 *     MIN_LIVE_GATE_SCORE / MIN_CONDITIONS_PASSED / MIN_VOLUME_RATIO / DAILY_CAP)
 *   - ENV SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED 우회 (default OFF, ADR-0157 정확 비교)
 *   - formatShadowNearBreakoutSection /scan_blockers 출력
 *   - buyListLoop wiring 정적 grep 가드 (KIS 주문 함수 import 0건 / saveShadowTrades
 *     호출 / try/catch 격리 / counters mutate)
 *   - scanDiagnostics formatScanBlockersMessage 자동 노출 wiring
 *   - watchlistSource 'SHADOW_NEAR_BREAKOUT' 옵션 추가 (ServerShadowTrade)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  evaluateShadowNearBreakoutEntry,
  formatShadowNearBreakoutSection,
  isShadowNearBreakoutEntryDisabled,
  SHADOW_NEAR_BREAKOUT_ENTRY_POLICY,
  type ShadowNearBreakoutEntryDecision,
  type ShadowNearBreakoutEntryInput,
} from './shadowNearBreakoutEntryPolicy.js';

const POLICY_PATH = resolve(__dirname, 'shadowNearBreakoutEntryPolicy.ts');
const POLICY_SRC = readFileSync(POLICY_PATH, 'utf8');
const SCAN_DIAGNOSTICS_PATH = resolve(__dirname, 'scanDiagnostics.ts');
const SCAN_DIAGNOSTICS_SRC = readFileSync(SCAN_DIAGNOSTICS_PATH, 'utf8');
const BUY_LIST_LOOP_PATH = resolve(__dirname, 'perSymbol/buyListLoop.ts');
const BUY_LIST_LOOP_SRC = readFileSync(BUY_LIST_LOOP_PATH, 'utf8');
const SHADOW_TRADE_REPO_PATH = resolve(__dirname, '../../persistence/shadowTradeRepo.ts');
const SHADOW_TRADE_REPO_SRC = readFileSync(SHADOW_TRADE_REPO_PATH, 'utf8');

function baseInput(over: Partial<ShadowNearBreakoutEntryInput> = {}): ShadowNearBreakoutEntryInput {
  return {
    symbol: '005930',
    name: 'Samsung',
    currentPrice: 70_500, // 0.71% gap above 70_000 entry
    entryPrice: 70_000,
    stopLoss: 65_000,
    targetPrice: 80_000,
    priceDistancePct: 0.71,
    gate1Passed: true,
    liveGateScore: 7.0,
    conditionsPassed: 6,
    recheckPassed: true,
    volumeRatio: 0.5,
    preBreakoutState: 'WAIT_RETRY_ELIGIBLE',
    shadowMode: true,
    riskBlocked: false,
    quoteStale: false,
    alreadyHasOpenShadow: false,
    alreadyEnteredToday: false,
    dailyCreatedCount: 0,
    ...over,
  };
}

/* ───────── Group A — ENV gate (default OFF, ADR-0157 정확 비교) ───────── */

describe('ADR-0452 — Group A — ENV gate', () => {
  const original = process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED;
  beforeEach(() => {
    delete process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED;
    else process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = original;
  });

  it('default OFF → policy 활성', () => {
    expect(isShadowNearBreakoutEntryDisabled()).toBe(false);
  });

  it("'true' 정확 매칭 → ENV 활성 → ENV DISABLED 메시지 + allowed=false", () => {
    process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = 'true';
    expect(isShadowNearBreakoutEntryDisabled()).toBe(true);
    const d = evaluateShadowNearBreakoutEntry(baseInput());
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('UNKNOWN');
    expect(d.createShadowTrade).toBe(false);
    expect(d.executionImpact).toBe('NONE');
    expect(d.operatorMessage).toContain('SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED');
  });

  it("'1' 거부 (ADR-0157 정확 비교 의무)", () => {
    process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = '1';
    expect(isShadowNearBreakoutEntryDisabled()).toBe(false);
  });

  it("'TRUE' 거부 (case sensitive)", () => {
    process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = 'TRUE';
    expect(isShadowNearBreakoutEntryDisabled()).toBe(false);
  });

  it("'yes' 거부", () => {
    process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = 'yes';
    expect(isShadowNearBreakoutEntryDisabled()).toBe(false);
  });

  it("'false' / 빈 문자열 → OFF", () => {
    process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = 'false';
    expect(isShadowNearBreakoutEntryDisabled()).toBe(false);
    process.env.SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED = '';
    expect(isShadowNearBreakoutEntryDisabled()).toBe(false);
  });
});

/* ───────── Group B — 절대 불변식 literal type ───────── */

describe('ADR-0452 — Group B — 절대 불변식 literal type', () => {
  it('모든 결정에서 executionImpact === NONE', () => {
    const states: Array<ShadowNearBreakoutEntryInput['preBreakoutState']> = [
      'WAIT_RETRY_ELIGIBLE',
      'WAIT_PRICE_TOO_FAR',
      'WAIT_VOLUME_WEAK',
      'WAIT_GATE_RECHECK_FAILED',
      'WAIT_COOLDOWN',
      'WAIT_SHADOW_ONLY',
      'WAIT_REJECTED',
    ];
    for (const state of states) {
      const d = evaluateShadowNearBreakoutEntry(baseInput({ preBreakoutState: state }));
      expect(d.executionImpact).toBe('NONE');
    }
  });

  it('모든 결정에서 createLiveOrder === false', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput());
    expect(d.createLiveOrder).toBe(false);
  });

  it('모든 결정에서 createPaperOrder === false', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput());
    expect(d.createPaperOrder).toBe(false);
  });

  it('모든 결정에서 learningTag === SHADOW_NEAR_BREAKOUT_ENTRY', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput());
    expect(d.learningTag).toBe('SHADOW_NEAR_BREAKOUT_ENTRY');
  });

  it('차단 결정에서도 createLiveOrder/createPaperOrder/executionImpact 보존', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ shadowMode: false }),
    );
    expect(d.allowed).toBe(false);
    expect(d.createLiveOrder).toBe(false);
    expect(d.createPaperOrder).toBe(false);
    expect(d.executionImpact).toBe('NONE');
  });
});

/* ───────── Group C — 정책 임계 SSOT (절대 변경 금지) ───────── */

describe('ADR-0452 — Group C — 정책 임계 SSOT', () => {
  it('SHADOW_NEAR_BREAKOUT_ENTRY_POLICY 임계 정합', () => {
    expect(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MAX_DISTANCE_PCT).toBe(1.5);
    expect(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.SOFT_DISTANCE_PCT).toBe(2.0);
    expect(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_LIVE_GATE_SCORE).toBe(5.0);
    expect(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_CONDITIONS_PASSED).toBe(5);
    expect(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.MIN_VOLUME_RATIO).toBe(0.25);
    expect(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY.DAILY_CAP).toBe(3);
  });

  it('Object.freeze drift 가드', () => {
    expect(Object.isFrozen(SHADOW_NEAR_BREAKOUT_ENTRY_POLICY)).toBe(true);
  });
});

/* ───────── Group D — shadowMode 우선 차단 ───────── */

describe('ADR-0452 — Group D — shadowMode 우선 차단', () => {
  it('shadowMode=false → NOT_SHADOW_MODE 차단 (Live 모드 무관)', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ shadowMode: false }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('NOT_SHADOW_MODE');
    expect(d.createShadowTrade).toBe(false);
    expect(d.operatorMessage).toContain('Live 모드');
  });

  it('Live 모드에서는 다른 모든 조건 무관 즉시 NOT_SHADOW_MODE', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ shadowMode: false, preBreakoutState: 'WAIT_RETRY_ELIGIBLE', priceDistancePct: 0.5 }),
    );
    expect(d.blockReason).toBe('NOT_SHADOW_MODE');
  });
});

/* ───────── Group E — riskBlocked / quoteStale 우선 차단 ───────── */

describe('ADR-0452 — Group E — riskBlocked / quoteStale 우선 차단', () => {
  it('riskBlocked=true → RISK_BLOCKED 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ riskBlocked: true }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('RISK_BLOCKED');
  });

  it('quoteStale=true → QUOTE_STALE 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ quoteStale: true }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('QUOTE_STALE');
  });

  it('riskBlocked 가 quoteStale 보다 우선', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ riskBlocked: true, quoteStale: true }),
    );
    expect(d.blockReason).toBe('RISK_BLOCKED');
  });
});

/* ───────── Group F — 중복 / dailyCap 차단 ───────── */

describe('ADR-0452 — Group F — 중복 / dailyCap 차단', () => {
  it('alreadyHasOpenShadow=true → DUPLICATE_SHADOW_ENTRY', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ alreadyHasOpenShadow: true }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('DUPLICATE_SHADOW_ENTRY');
  });

  it('alreadyEnteredToday=true → DUPLICATE_SHADOW_ENTRY', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ alreadyEnteredToday: true }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('DUPLICATE_SHADOW_ENTRY');
  });

  it('dailyCreatedCount === DAILY_CAP → DAILY_CAP_REACHED', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ dailyCreatedCount: 3 }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('DAILY_CAP_REACHED');
  });

  it('dailyCreatedCount > DAILY_CAP → DAILY_CAP_REACHED', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ dailyCreatedCount: 5 }));
    expect(d.blockReason).toBe('DAILY_CAP_REACHED');
  });

  it('dailyCreatedCount < DAILY_CAP → cap 무관', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ dailyCreatedCount: 2 }));
    expect(d.allowed).toBe(true);
  });
});

/* ───────── Group G — preBreakoutState 분기 ───────── */

describe('ADR-0452 — Group G — preBreakoutState 분기', () => {
  it('WAIT_REJECTED → RISK_BLOCKED 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ preBreakoutState: 'WAIT_REJECTED' }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('RISK_BLOCKED');
    expect(d.operatorMessage).toContain('WAIT_REJECTED');
  });

  it('WAIT_PRICE_TOO_FAR → PRICE_TOO_FAR 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ preBreakoutState: 'WAIT_PRICE_TOO_FAR', priceDistancePct: 5.0 }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('PRICE_TOO_FAR');
  });

  it('WAIT_VOLUME_WEAK → VOLUME_TOO_WEAK 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ preBreakoutState: 'WAIT_VOLUME_WEAK', volumeRatio: 0.1 }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('VOLUME_TOO_WEAK');
  });

  it('WAIT_COOLDOWN + 임계 미달 → REPEATED_WAIT_COOLDOWN 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ preBreakoutState: 'WAIT_COOLDOWN', recheckPassed: true }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('REPEATED_WAIT_COOLDOWN');
  });

  it('WAIT_GATE_RECHECK_FAILED + soft distance + recheckPassed=false → GATE_RECHECK_SOFT_FAIL allowed', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({
        preBreakoutState: 'WAIT_GATE_RECHECK_FAILED',
        priceDistancePct: 1.8, // < SOFT_DISTANCE_PCT (2.0)
        recheckPassed: false,
        conditionsPassed: 6,
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.cause).toBe('GATE_RECHECK_SOFT_FAIL');
    expect(d.createShadowTrade).toBe(true);
  });

  it('WAIT_RETRY_ELIGIBLE + 모든 임계 통과 → NEAR_ENTRY_PRICE allowed', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({
        preBreakoutState: 'WAIT_RETRY_ELIGIBLE',
        priceDistancePct: 1.0,
        gate1Passed: true,
        liveGateScore: 7.0,
        conditionsPassed: 6,
        volumeRatio: 0.5,
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.cause).toBe('NEAR_ENTRY_PRICE');
    expect(d.createShadowTrade).toBe(true);
  });

  it('WAIT_SHADOW_ONLY + 모든 임계 통과 → LIVE_WAIT_BUT_SHADOW_OBSERVABLE allowed', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({
        preBreakoutState: 'WAIT_SHADOW_ONLY',
        priceDistancePct: 1.0,
        gate1Passed: true,
        liveGateScore: 7.0,
        conditionsPassed: 6,
        volumeRatio: 0.5,
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.cause).toBe('LIVE_WAIT_BUT_SHADOW_OBSERVABLE');
    expect(d.createShadowTrade).toBe(true);
  });

  it('preBreakoutState 미상 (undefined) → concrete fallback 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ preBreakoutState: undefined }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('ENTRY_PRICE_NOT_REACHED');
  });

  it('thresholdNotMetConditions maps UNKNOWN fallback to concrete Gate2 gap reason', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({
        preBreakoutState: undefined,
        thresholdNotMetConditions: ['breakout_momentum', 'volume_surge'],
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('BREAKOUT_MOMENTUM_GAP');
    expect(d.allBlockReasons).toContain('VOLUME_SURGE_GAP');
  });
});

/* ───────── Group H — 임계 boundary ───────── */

describe('ADR-0452 — Group H — 임계 boundary', () => {
  it('priceDistancePct === MAX_DISTANCE_PCT (1.5%) → 정확 boundary 통과', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ priceDistancePct: 1.5 }));
    expect(d.allowed).toBe(true);
    expect(d.cause).toBe('NEAR_ENTRY_PRICE');
  });

  it('priceDistancePct > MAX_DISTANCE_PCT 그러나 <= SOFT_DISTANCE_PCT + recheck=true → block', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ priceDistancePct: 1.8, recheckPassed: true }),
    );
    expect(d.allowed).toBe(false);
  });

  it('priceDistancePct > SOFT_DISTANCE_PCT (2.0%) → PRICE_TOO_FAR', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ priceDistancePct: 3.0 }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('PRICE_TOO_FAR');
  });

  it('liveGateScore < MIN_LIVE_GATE_SCORE → 차단 (gate score 부족)', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ liveGateScore: 4.0 }));
    expect(d.allowed).toBe(false);
  });

  it('liveGateScore === MIN_LIVE_GATE_SCORE (5.0) → 정확 boundary 통과', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ liveGateScore: 5.0 }));
    expect(d.allowed).toBe(true);
  });

  it('conditionsPassed < MIN_CONDITIONS_PASSED → 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ conditionsPassed: 4 }));
    expect(d.allowed).toBe(false);
  });

  it('conditionsPassed === MIN_CONDITIONS_PASSED (5) → 정확 boundary 통과', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ conditionsPassed: 5 }));
    expect(d.allowed).toBe(true);
  });

  it('volumeRatio < MIN_VOLUME_RATIO → VOLUME_TOO_WEAK', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ volumeRatio: 0.1 }));
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('VOLUME_TOO_WEAK');
  });

  it('volumeRatio === MIN_VOLUME_RATIO (0.25) → 정확 boundary 통과', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ volumeRatio: 0.25 }));
    expect(d.allowed).toBe(true);
  });

  it('gate1Passed=false → 차단 (Gate1 통과 안 함)', () => {
    const d = evaluateShadowNearBreakoutEntry(baseInput({ gate1Passed: false }));
    expect(d.allowed).toBe(false);
  });
});

/* ───────── Group I — formatShadowNearBreakoutSection ───────── */

describe('ADR-0452 — Group I — formatShadowNearBreakoutSection', () => {
  it('counters null → null 반환 (잡음 차단)', () => {
    expect(formatShadowNearBreakoutSection(null)).toBeNull();
  });

  it('counters undefined → null 반환', () => {
    expect(formatShadowNearBreakoutSection(undefined)).toBeNull();
  });

  it('created+blocked === 0 → null 반환 (잡음 차단)', () => {
    const result = formatShadowNearBreakoutSection({ created: 0, blocked: 0, blockReasons: {} });
    expect(result).toBeNull();
  });

  it('created > 0 → 정상 출력 + ADR-0452 마커 + executionImpact NONE', () => {
    const result = formatShadowNearBreakoutSection({
      created: 2,
      blocked: 0,
      blockReasons: {},
    });
    expect(result).toContain('ADR-0452');
    expect(result).toContain('Shadow Near-Breakout');
    expect(result).toContain('created 2');
    expect(result).toContain('blocked 0');
    expect(result).toContain('executionImpact: NONE');
  });

  it('blocked > 0 + topBlock 정렬 desc + Top 3 절삭', () => {
    const result = formatShadowNearBreakoutSection({
      created: 0,
      blocked: 10,
      blockReasons: {
        PRICE_TOO_FAR: 5,
        VOLUME_TOO_WEAK: 3,
        DAILY_CAP_REACHED: 1,
        QUOTE_STALE: 1,
      },
    });
    expect(result).toContain('topBlock');
    expect(result).toContain('PRICE_TOO_FAR 5');
    expect(result).toContain('VOLUME_TOO_WEAK 3');
    // Top 3 절삭 — 4번째 제외
    const lines = result?.split('\n') ?? [];
    const topLine = lines.find((l) => l.includes('topBlock')) ?? '';
    const reasons = topLine.match(/[A-Z_]+ \d+/g) ?? [];
    expect(reasons.length).toBeLessThanOrEqual(3);
  });

  it('created+blocked > 0 + topBlock 비어있음 → topBlock 미출력', () => {
    const result = formatShadowNearBreakoutSection({
      created: 1,
      blocked: 0,
      blockReasons: {},
    });
    expect(result).not.toContain('topBlock');
  });

  it('Telegram HTML raw 태그 금지 (사용자 §9 plain text 우선)', () => {
    const result = formatShadowNearBreakoutSection({
      created: 1,
      blocked: 0,
      blockReasons: {},
    });
    expect(result).not.toMatch(/<[a-z]+>/i);
  });
});

/* ───────── Group J — buyListLoop wiring 정적 grep 가드 ───────── */

describe('ADR-0452 — Group J — buyListLoop wiring 정적 grep 가드', () => {
  it('shadowNearBreakoutEntryPolicy import 보유', () => {
    expect(BUY_LIST_LOOP_SRC).toContain('shadowNearBreakoutEntryPolicy');
    expect(BUY_LIST_LOOP_SRC).toContain('evaluateShadowNearBreakoutEntry');
  });

  it('두 WAIT site 모두 evaluateShadowNearBreakoutEntry 호출', () => {
    const matches = BUY_LIST_LOOP_SRC.match(/evaluateShadowNearBreakoutEntry\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('saveShadowTrades 호출 (영속 보장)', () => {
    expect(BUY_LIST_LOOP_SRC).toContain('saveShadowTrades(ctx.shadows)');
  });

  it('try/catch 격리 — 분류 throw 가 매수 흐름 차단 안 함', () => {
    expect(BUY_LIST_LOOP_SRC).toMatch(/\[ADR-0452\][^]*분류 실패/);
  });

  it('SHADOW_NEAR_BREAKOUT watchlistSource 사용', () => {
    expect(BUY_LIST_LOOP_SRC).toContain("'SHADOW_NEAR_BREAKOUT'");
  });

  it('counters mutate (shadowNearBreakoutCreated/Blocked)', () => {
    expect(BUY_LIST_LOOP_SRC).toContain('shadowNearBreakoutCreated');
    expect(BUY_LIST_LOOP_SRC).toContain('shadowNearBreakoutBlocked');
    expect(BUY_LIST_LOOP_SRC).toContain('shadowNearBreakoutBlockReasons');
  });

  it('idPrefix shadow-near-breakout 명시 (id collision 차단)', () => {
    expect(BUY_LIST_LOOP_SRC).toContain("idPrefix: 'shadow-near-breakout'");
  });

  it('buildBuyTrade 호출 시 shadowMode: true 강제', () => {
    // Both wiring blocks must explicitly set shadowMode: true
    const shadowNearBreakoutBlocks = BUY_LIST_LOOP_SRC.split(/idPrefix: 'shadow-near-breakout'/);
    expect(shadowNearBreakoutBlocks.length).toBeGreaterThanOrEqual(3); // header + 2 wiring sites
    for (let i = 1; i < shadowNearBreakoutBlocks.length; i++) {
      // Look ahead for shadowMode: true within the buildBuyTrade call
      const nearbyContent = shadowNearBreakoutBlocks[i]?.slice(0, 1000) ?? '';
      expect(nearbyContent).toContain('shadowMode: true');
    }
  });
});

/* ───────── Group K — scanDiagnostics formatScanBlockersMessage wiring ───────── */

describe('ADR-0452 — Group K — scanDiagnostics wiring', () => {
  it('formatShadowNearBreakoutSection import 보유', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toContain('formatShadowNearBreakoutSection');
    expect(SCAN_DIAGNOSTICS_SRC).toContain('shadowNearBreakoutEntryPolicy');
  });

  it('ScanCounters 에 shadowNearBreakout 카운터 3종 등재', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toContain('shadowNearBreakoutCreated');
    expect(SCAN_DIAGNOSTICS_SRC).toContain('shadowNearBreakoutBlocked');
    expect(SCAN_DIAGNOSTICS_SRC).toContain('shadowNearBreakoutBlockReasons');
  });

  it('ScanSummary 에 shadowNearBreakout 카운터 3종 등재 (옵셔널)', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toMatch(/shadowNearBreakoutCreated\?:/);
    expect(SCAN_DIAGNOSTICS_SRC).toMatch(/shadowNearBreakoutBlocked\?:/);
    expect(SCAN_DIAGNOSTICS_SRC).toMatch(/shadowNearBreakoutBlockReasons\?:/);
  });

  it('persistScanResults 가 carry-over 수행', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toMatch(/summaryDraft\.shadowNearBreakoutCreated/);
    expect(SCAN_DIAGNOSTICS_SRC).toMatch(/summaryDraft\.shadowNearBreakoutBlocked/);
  });

  it('formatScanBlockersMessage 자동 노출 (created+blocked > 0 시)', () => {
    expect(SCAN_DIAGNOSTICS_SRC).toContain('formatShadowNearBreakoutSection');
    // Wiring 블록은 ADR-0449 다음에 위치 (사용자 §9)
    const idx0449 = SCAN_DIAGNOSTICS_SRC.indexOf('formatPreBreakoutWaitSummarySection');
    const idx0452 = SCAN_DIAGNOSTICS_SRC.lastIndexOf('formatShadowNearBreakoutSection');
    expect(idx0452).toBeGreaterThan(idx0449);
  });
});

/* ───────── Group L — ServerShadowTrade.watchlistSource union 격상 ───────── */

describe('ADR-0452 — Group L — ServerShadowTrade.watchlistSource union 격상', () => {
  it('SHADOW_NEAR_BREAKOUT watchlistSource union 등재', () => {
    expect(SHADOW_TRADE_REPO_SRC).toContain("'SHADOW_NEAR_BREAKOUT'");
  });

  it('기존 4 source 무수정 (사용자 명시 후방호환 — PRE_MARKET / INTRADAY / PRE_BREAKOUT / PRE_BREAKOUT_FOLLOWTHROUGH)', () => {
    expect(SHADOW_TRADE_REPO_SRC).toContain("'PRE_MARKET'");
    expect(SHADOW_TRADE_REPO_SRC).toContain("'INTRADAY'");
    expect(SHADOW_TRADE_REPO_SRC).toContain("'PRE_BREAKOUT'");
    expect(SHADOW_TRADE_REPO_SRC).toContain("'PRE_BREAKOUT_FOLLOWTHROUGH'");
  });
});

/* ───────── Group M — 정적 grep 안전 invariant 가드 ───────── */

describe('ADR-0452 — Group M — 정적 grep 안전 invariant', () => {
  it('shadowNearBreakoutEntryPolicy.ts 외부 의존성 0 (KIS 주문 함수 5종 import 0건)', () => {
    expect(POLICY_SRC).not.toMatch(/import.*placeKisMarketBuyOrder/);
    expect(POLICY_SRC).not.toMatch(/import.*placeKisSellOrder/);
    expect(POLICY_SRC).not.toMatch(/import.*placeKisStopLossOrder/);
    expect(POLICY_SRC).not.toMatch(/import.*placeKisTakeProfitOrder/);
    expect(POLICY_SRC).not.toMatch(/import.*cancelKisOrder/);
  });

  it('shadowNearBreakoutEntryPolicy.ts autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(POLICY_SRC).not.toMatch(/import.*autoTradeEngine/);
    expect(POLICY_SRC).not.toMatch(/import.*orderExecutor/);
    expect(POLICY_SRC).not.toMatch(/import.*trancheExecutor/);
  });

  it('shadowNearBreakoutEntryPolicy.ts 외부 fetch / axios / node-fetch 0건', () => {
    expect(POLICY_SRC).not.toMatch(/^import.*from ['"]node-fetch/m);
    expect(POLICY_SRC).not.toMatch(/import\s+axios/);
    expect(POLICY_SRC).not.toMatch(/\bfetch\(/);
  });

  it('shadowNearBreakoutEntryPolicy.ts Gate threshold / GATE_RELAX / STRONG_BUY_OVERRIDE 0건', () => {
    expect(POLICY_SRC).not.toMatch(/setGateThreshold/);
    expect(POLICY_SRC).not.toMatch(/GATE_RELAX/);
    expect(POLICY_SRC).not.toMatch(/STRONG_BUY_OVERRIDE/);
  });

  it('shadowNearBreakoutEntryPolicy.ts approval queue 연결 0건', () => {
    expect(POLICY_SRC).not.toMatch(/approvalQueue/);
    expect(POLICY_SRC).not.toMatch(/requestBuyApproval/);
  });
});

/* ───────── Group N — 통합 시나리오 ───────── */

describe('ADR-0452 — Group N — 통합 시나리오', () => {
  it('30 후보 분포 — 일부 allow / 일부 block / dailyCap 도달 후 block', () => {
    const decisions: ShadowNearBreakoutEntryDecision[] = [];
    for (let i = 0; i < 30; i++) {
      const dailyCount = Math.min(i, 3);
      const distance = i % 4 === 0 ? 5.0 : 1.0; // 25% PRICE_TOO_FAR, 75% near
      const d = evaluateShadowNearBreakoutEntry(
        baseInput({
          symbol: `${String(i).padStart(6, '0')}`,
          priceDistancePct: distance,
          dailyCreatedCount: dailyCount,
        }),
      );
      decisions.push(d);
    }
    const allowedCount = decisions.filter((d) => d.allowed).length;
    const blockedCount = decisions.filter((d) => !d.allowed).length;
    expect(allowedCount + blockedCount).toBe(30);
    expect(allowedCount).toBeGreaterThan(0);
    expect(blockedCount).toBeGreaterThan(0);
    // 모든 decision 의 executionImpact: NONE
    for (const d of decisions) {
      expect(d.executionImpact).toBe('NONE');
      expect(d.createLiveOrder).toBe(false);
      expect(d.createPaperOrder).toBe(false);
    }
  });

  it('Live mode (shadowMode=false) → 모든 결정 NOT_SHADOW_MODE 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({
        shadowMode: false,
        preBreakoutState: 'WAIT_RETRY_ELIGIBLE',
        priceDistancePct: 0.5, // 매우 가까움
      }),
    );
    expect(d.allowed).toBe(false);
    expect(d.blockReason).toBe('NOT_SHADOW_MODE');
  });

  it('priceDistancePct undefined → POSITIVE_INFINITY 보수 처리 → 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ priceDistancePct: undefined }),
    );
    expect(d.allowed).toBe(false);
  });

  it('liveGateScore undefined → 0 보수 처리 → 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ liveGateScore: undefined }),
    );
    expect(d.allowed).toBe(false);
  });

  it('volumeRatio undefined → 0 보수 처리 → 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ volumeRatio: undefined }),
    );
    expect(d.allowed).toBe(false);
  });

  it('conditionsPassed undefined → 0 보수 처리 → 차단', () => {
    const d = evaluateShadowNearBreakoutEntry(
      baseInput({ conditionsPassed: undefined }),
    );
    expect(d.allowed).toBe(false);
  });
});
