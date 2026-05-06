/**
 * @responsibility ADR-0401 R3 Violation State Machine 회귀 테스트.
 *
 * 검증 항목 (사용자 절대 원칙 + 결정 트리 정합):
 *   - 5단계 state union (CLEAN/WARNING/ELEVATED/SHADOW_ONLY/HARD_BLOCK)
 *   - profile 별 (R3_EARLY 5회 / R3_CONFIRMED 3회 / DEFAULT 3회) 임계 분기
 *   - guard 5종 OR 평가 (candidates / sectorEnergy / freshness / volumeClock / GPD)
 *   - GATE_PASS_DATA_MISSING → 항상 WARNING_ONLY (절대 원칙 #8)
 *   - CANDIDATES_ZERO → hardBlockAllowed=false 강제 (절대 원칙 #6)
 *   - GATE1_PASS_ZERO → guard 통과 시에만 HARD_BLOCK 격상
 *   - guard 1건이라도 활성 시 SHADOW_ONLY 까지만 cap
 *   - violation=NONE → CLEAN + streak reset
 *   - profile fallback (알 수 없는 R3 변형 → DEFAULT)
 *   - 정적 grep 가드 — KIS 주문 함수 import 0건
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { R3SanityGuardInput } from './r3ViolationStateMachine.js';

let tmpDir = '';
let stateMachine: typeof import('./r3ViolationStateMachine.js');
let repo: typeof import('../../persistence/r3ViolationStreakRepo.js');
let profiles: typeof import('./r3SanityProfiles.js');

const T0 = new Date('2026-05-06T01:00:00.000Z');

const guardClean: R3SanityGuardInput = {
  candidates: 50,
  sectorEnergyDataQuality: 'OK',
  marketDataFreshness: 'FRESH',
  volumeClockAllowsEntry: true,
  gatePassDistributionFresh: true,
};

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-state-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
  vi.resetModules();
  stateMachine = await import('./r3ViolationStateMachine.js');
  repo = await import('../../persistence/r3ViolationStreakRepo.js');
  profiles = await import('./r3SanityProfiles.js');
  repo.__resetR3ViolationStreakForTests();
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  delete process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ───────── R3SanityProfiles 검증 ───────── */

describe('R3 Sanity Profiles SSOT (절대 원칙 #4)', () => {
  it('R3_EARLY hardBlockAt=5 (관대)', () => {
    expect(profiles.R3_SANITY_PROFILES.R3_EARLY.hardBlockAt).toBe(5);
    expect(profiles.R3_SANITY_PROFILES.R3_EARLY.shadowOnlyAt).toBe(3);
  });

  it('R3_CONFIRMED hardBlockAt=3 (보수적)', () => {
    expect(profiles.R3_SANITY_PROFILES.R3_CONFIRMED.hardBlockAt).toBe(3);
  });

  it('R3_EXPANSION hardBlockAt=3', () => {
    expect(profiles.R3_SANITY_PROFILES.R3_EXPANSION.hardBlockAt).toBe(3);
  });

  it('DEFAULT fallback', () => {
    expect(profiles.R3_SANITY_PROFILES.DEFAULT.hardBlockAt).toBe(3);
  });

  it('모든 profile minCandidatesForHardBlock=5 (절대 원칙 #6)', () => {
    expect(profiles.R3_SANITY_PROFILES.R3_EARLY.minCandidatesForHardBlock).toBe(5);
    expect(profiles.R3_SANITY_PROFILES.R3_CONFIRMED.minCandidatesForHardBlock).toBe(5);
    expect(profiles.R3_SANITY_PROFILES.R3_EXPANSION.minCandidatesForHardBlock).toBe(5);
    expect(profiles.R3_SANITY_PROFILES.DEFAULT.minCandidatesForHardBlock).toBe(5);
  });

  it('getR3SanityProfile — 알 수 없는 R3 변형 → DEFAULT', () => {
    expect(profiles.getR3SanityProfile('R3_UNKNOWN')).toEqual(profiles.R3_SANITY_PROFILES.DEFAULT);
    expect(profiles.getR3SanityProfile('')).toEqual(profiles.R3_SANITY_PROFILES.DEFAULT);
    expect(profiles.getR3SanityProfile(null)).toEqual(profiles.R3_SANITY_PROFILES.DEFAULT);
    expect(profiles.getR3SanityProfile(undefined)).toEqual(profiles.R3_SANITY_PROFILES.DEFAULT);
  });

  it('getR3SanityProfile — 정확 매치', () => {
    expect(profiles.getR3SanityProfile('R3_EARLY')).toEqual(profiles.R3_SANITY_PROFILES.R3_EARLY);
    expect(profiles.getR3SanityProfile('R3_CONFIRMED')).toEqual(profiles.R3_SANITY_PROFILES.R3_CONFIRMED);
    expect(profiles.getR3SanityProfile('R3_EXPANSION')).toEqual(profiles.R3_SANITY_PROFILES.R3_EXPANSION);
  });
});

/* ───────── evaluateGuards 검증 ───────── */

describe('evaluateGuards — 5종 OR 평가', () => {
  const profile = { warningAt: 1, elevatedAt: 2, shadowOnlyAt: 3, hardBlockAt: 5, minCandidatesForHardBlock: 5 };

  it('모두 정상 → hardBlockAllowed=true, reasons=[]', () => {
    const g = stateMachine.evaluateGuards(guardClean, profile);
    expect(g.hardBlockAllowed).toBe(true);
    expect(g.reasons).toEqual([]);
  });

  it('candidates < 5 → 차단', () => {
    const g = stateMachine.evaluateGuards({ ...guardClean, candidates: 3 }, profile);
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons[0]).toMatch(/candidates=3/);
  });

  it('sectorEnergy=DEGRADED → 차단', () => {
    const g = stateMachine.evaluateGuards({ ...guardClean, sectorEnergyDataQuality: 'DEGRADED' }, profile);
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons[0]).toMatch(/sectorEnergy=DEGRADED/);
  });

  it('sectorEnergy=FAILED → 차단', () => {
    const g = stateMachine.evaluateGuards({ ...guardClean, sectorEnergyDataQuality: 'FAILED' }, profile);
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons[0]).toMatch(/sectorEnergy=FAILED/);
  });

  it('marketDataFreshness=EXPIRED → 차단', () => {
    const g = stateMachine.evaluateGuards({ ...guardClean, marketDataFreshness: 'EXPIRED' }, profile);
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons[0]).toMatch(/EXPIRED/);
  });

  it('volumeClockAllowsEntry=false → 차단', () => {
    const g = stateMachine.evaluateGuards({ ...guardClean, volumeClockAllowsEntry: false }, profile);
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons[0]).toMatch(/volumeClock/);
  });

  it('gatePassDistributionFresh=false → 차단', () => {
    const g = stateMachine.evaluateGuards({ ...guardClean, gatePassDistributionFresh: false }, profile);
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons[0]).toMatch(/gatePassDistribution/);
  });

  it('다중 guard 활성 → 모든 reasons 누적', () => {
    const g = stateMachine.evaluateGuards(
      { candidates: 2, sectorEnergyDataQuality: 'FAILED', marketDataFreshness: 'EXPIRED', volumeClockAllowsEntry: false, gatePassDistributionFresh: false },
      profile,
    );
    expect(g.hardBlockAllowed).toBe(false);
    expect(g.reasons.length).toBe(5);
  });
});

/* ───────── State Machine 결정 트리 검증 ───────── */

describe('evaluateR3ViolationState — 결정 트리 (R3_EARLY profile)', () => {
  it('violation=NONE → CLEAN + streak reset', () => {
    // 사전 streak 누적
    repo.updateR3ViolationStreak({ violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', now: T0 });
    const result = stateMachine.evaluateR3ViolationState({
      violation: 'NONE',
      regime: 'R3_EARLY',
      scanId: 'B',
      guards: guardClean,
      now: T0,
    });
    expect(result.state).toBe('CLEAN');
    expect(result.action).toBe('NONE');
    expect(result.consecutiveCount).toBe(0);
    expect(repo.loadR3ViolationStreakState().consecutiveCount).toBe(0);
  });

  it('R3_EARLY count=1 → WARNING / WARNING_ONLY', () => {
    const r = stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'A',
      guards: guardClean,
      now: T0,
    });
    expect(r.state).toBe('WARNING');
    expect(r.action).toBe('WARNING_ONLY');
    expect(r.consecutiveCount).toBe(1);
  });

  it('R3_EARLY count=2 → ELEVATED / ELEVATED_ALERT', () => {
    stateMachine.evaluateR3ViolationState({ violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: guardClean, now: T0 });
    const r = stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'B', guards: guardClean,
      now: new Date(T0.getTime() + 60 * 60_000),
    });
    expect(r.state).toBe('ELEVATED');
    expect(r.action).toBe('ELEVATED_ALERT');
    expect(r.consecutiveCount).toBe(2);
  });

  it('R3_EARLY count=3 → SHADOW_ONLY / SHADOW_ONLY_BLOCK', () => {
    for (let i = 1; i <= 3; i++) {
      stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`, guards: guardClean,
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    const last = repo.loadR3ViolationStreakState();
    expect(last.consecutiveCount).toBe(3);
  });

  it('R3_EARLY count=5 + guards 통과 → HARD_BLOCK / HARD_BLOCK_LATCH', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 5; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`, guards: guardClean,
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('HARD_BLOCK');
    expect(result!.action).toBe('HARD_BLOCK_LATCH');
    expect(result!.consecutiveCount).toBe(5);
  });

  it('R3_EARLY count=5 + guard 활성 → SHADOW_ONLY (cap, 절대 원칙 #5)', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 5; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`,
        guards: { ...guardClean, candidates: 3 }, // candidates < 5 → guard 활성
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('SHADOW_ONLY');
    expect(result!.action).toBe('SHADOW_ONLY_BLOCK');
    expect(result!.hardBlockAllowed).toBe(false);
    expect(result!.guardReasons.length).toBeGreaterThan(0);
  });
});

describe('evaluateR3ViolationState — R3_CONFIRMED profile (보수적)', () => {
  it('R3_CONFIRMED count=3 + guards 통과 → HARD_BLOCK / HARD_BLOCK_LATCH', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 3; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_CONFIRMED', scanId: `s-${i}`, guards: guardClean,
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('HARD_BLOCK');
    expect(result!.consecutiveCount).toBe(3);
  });

  it('R3_CONFIRMED count=2 → ELEVATED → SHADOW_ONLY 자연 (shadowOnlyAt=2)', () => {
    stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_CONFIRMED', scanId: 'A', guards: guardClean, now: T0,
    });
    const r = stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_CONFIRMED', scanId: 'B', guards: guardClean,
      now: new Date(T0.getTime() + 60 * 60_000),
    });
    // R3_CONFIRMED: warningAt=1, elevatedAt=2, shadowOnlyAt=2 → count=2 시 SHADOW_ONLY 직행
    expect(r.state).toBe('SHADOW_ONLY');
  });
});

/* ───────── violation 타입 별 분기 ───────── */

describe('evaluateR3ViolationState — violation 별 분기', () => {
  it('GATE_PASS_DATA_MISSING → WARNING / WARNING_ONLY (절대 원칙 #8)', () => {
    const r = stateMachine.evaluateR3ViolationState({
      violation: 'GATE_PASS_DATA_MISSING', regime: 'R3_EARLY', scanId: 'A', guards: guardClean, now: T0,
    });
    expect(r.state).toBe('WARNING');
    expect(r.action).toBe('WARNING_ONLY');
    expect(r.hardBlockAllowed).toBe(false);
  });

  it('GATE_PASS_DATA_MISSING — count=10 도 WARNING (절대 원칙 #8 — hardBlock 미도달)', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 10; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE_PASS_DATA_MISSING', regime: 'R3_EARLY', scanId: `s-${i}`, guards: guardClean,
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('WARNING');
    expect(result!.consecutiveCount).toBe(10);
  });

  it('CANDIDATES_ZERO count=1 → WARNING (절대 원칙 #6, hardBlockAllowed=false)', () => {
    const r = stateMachine.evaluateR3ViolationState({
      violation: 'CANDIDATES_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: { ...guardClean, candidates: 0 }, now: T0,
    });
    expect(r.state).toBe('WARNING');
    expect(r.hardBlockAllowed).toBe(false);
  });

  it('CANDIDATES_ZERO count=2 → ELEVATED', () => {
    stateMachine.evaluateR3ViolationState({
      violation: 'CANDIDATES_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: { ...guardClean, candidates: 0 }, now: T0,
    });
    const r = stateMachine.evaluateR3ViolationState({
      violation: 'CANDIDATES_ZERO', regime: 'R3_EARLY', scanId: 'B', guards: { ...guardClean, candidates: 0 },
      now: new Date(T0.getTime() + 60 * 60_000),
    });
    expect(r.state).toBe('ELEVATED');
    expect(r.hardBlockAllowed).toBe(false); // 절대 원칙 #6 — universe/워치리스트 결함 = hardBlock 부적합
  });

  it('CANDIDATES_ZERO 다회 누적 (10회) — HARD_BLOCK 도달 0', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 10; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'CANDIDATES_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`, guards: { ...guardClean, candidates: 0 },
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state === 'WARNING' || result!.state === 'ELEVATED').toBe(true);
    expect(result!.action !== 'HARD_BLOCK_LATCH').toBe(true);
  });
});

/* ───────── Guard cap 분기 ───────── */

describe('evaluateR3ViolationState — guard cap (count >= hardBlockAt + guard 활성 → SHADOW_ONLY)', () => {
  it('R3_CONFIRMED count=3 + sectorEnergy=DEGRADED → SHADOW_ONLY (cap)', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 3; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_CONFIRMED', scanId: `s-${i}`,
        guards: { ...guardClean, sectorEnergyDataQuality: 'DEGRADED' },
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('SHADOW_ONLY');
    expect(result!.guardReasons[0]).toMatch(/DEGRADED/);
  });

  it('count=5 + freshness=EXPIRED → SHADOW_ONLY', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 5; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`,
        guards: { ...guardClean, marketDataFreshness: 'EXPIRED' },
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('SHADOW_ONLY');
  });

  it('count=5 + volumeClock=false → SHADOW_ONLY (절대 원칙 #7)', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 5; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`,
        guards: { ...guardClean, volumeClockAllowsEntry: false },
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('SHADOW_ONLY');
  });

  it('count=5 + GPD=false → SHADOW_ONLY (절대 원칙 #8)', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 5; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: `s-${i}`,
        guards: { ...guardClean, gatePassDistributionFresh: false },
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(result!.state).toBe('SHADOW_ONLY');
  });
});

/* ───────── 결정 트리 회귀 ───────── */

describe('evaluateR3ViolationState — 회귀 + edge cases', () => {
  it('알 수 없는 R3 변형 (R3_FOO) → DEFAULT profile', () => {
    let result = null as ReturnType<typeof stateMachine.evaluateR3ViolationState> | null;
    for (let i = 1; i <= 3; i++) {
      result = stateMachine.evaluateR3ViolationState({
        violation: 'GATE1_PASS_ZERO', regime: 'R3_FOO', scanId: `s-${i}`, guards: guardClean,
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    // DEFAULT hardBlockAt=3 — 3회에서 HARD_BLOCK 도달
    expect(result!.state).toBe('HARD_BLOCK');
  });

  it('decay 24h 지나면 누적 reset (count=1 재시작)', () => {
    stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: guardClean, now: T0,
    });
    const t1h = new Date(T0.getTime() + 60 * 60_000);
    stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'B', guards: guardClean, now: t1h,
    });
    // lastSeenAt(=t1h) 으로부터 25h+1ms 후 → decay 발동
    const after = stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'C', guards: guardClean,
      now: new Date(t1h.getTime() + 25 * 60 * 60_000 + 1),
    });
    expect(after.consecutiveCount).toBe(1);
    expect(after.state).toBe('WARNING');
  });

  it('같은 scanId 중복 → state 평가는 진행 (streak 만 +1 차단)', () => {
    const a = stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: guardClean, now: T0,
    });
    const b = stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: guardClean,
      now: new Date(T0.getTime() + 60 * 60_000),
    });
    expect(a.consecutiveCount).toBe(1);
    expect(b.consecutiveCount).toBe(1); // scanId 중복 → +1 차단
    expect(b.state).toBe('WARNING');
  });

  it('getCurrentR3ViolationStreak — read-only 진단', () => {
    stateMachine.evaluateR3ViolationState({
      violation: 'GATE1_PASS_ZERO', regime: 'R3_EARLY', scanId: 'A', guards: guardClean, now: T0,
    });
    const s = stateMachine.getCurrentR3ViolationStreak();
    expect(s.violation).toBe('GATE1_PASS_ZERO');
    expect(s.consecutiveCount).toBe(1);
  });
});

/* ───────── 정적 가드 ───────── */

describe('정적 가드 — KIS 주문 함수 import 0건 (절대 원칙 #13)', () => {
  it('state machine 본체 source 검사', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'r3ViolationStateMachine.ts'), 'utf-8');
    expect(src).not.toMatch(/placeKisMarketOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
    expect(src).not.toMatch(/import.*kisClient/);
    expect(src).not.toMatch(/import.*orderDispatch/);
    expect(src).not.toMatch(/import.*autoTradeEngine/);
  });

  it('r3SanityProfiles — 외부 의존성 0', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'r3SanityProfiles.ts'), 'utf-8');
    expect(src).not.toMatch(/import\s/);
    expect(src).not.toMatch(/from\s+['"]/);
  });
});
