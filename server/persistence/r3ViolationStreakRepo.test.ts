/**
 * @responsibility ADR-0401 R3 Violation streak 영속 SSOT 회귀 테스트.
 *
 * 검증 항목 (사용자 절대 원칙 #9 + 결정 트리 §6 정합):
 *   - atomic write (tmp → rename) — 손상되지 않음
 *   - 24h decay — `lastSeenAt` 부터 24h 초과 시 자동 reset
 *   - ENV `R3_VIOLATION_STREAK_DECAY_HOURS` 정확 비교 + NaN/0/음수 fallback default 24
 *   - scanIds[] 마지막 1건 비교 — 같은 스캔 사이클 +1 차단
 *   - violation 또는 regime 변경 → consecutiveCount=1 (다른 위반 시작)
 *   - JSON corruption fallback — 손상된 파일 시 빈 상태 반환
 *   - schemaVersion 불일치 fallback
 *   - getEffectiveR3ViolationStreak — decay-aware read-only
 *   - resetR3ViolationStreakState — `/r3_unblock` 시 호출 정합
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir = '';
let repo: typeof import('./r3ViolationStreakRepo.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-streak-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
  vi.resetModules();
  repo = await import('./r3ViolationStreakRepo.js');
  repo.__resetR3ViolationStreakForTests();
});

afterEach(() => {
  delete process.env.PERSIST_DATA_DIR;
  delete process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const T0 = new Date('2026-05-06T01:00:00.000Z');
const after1h = new Date('2026-05-06T02:00:00.000Z');
const after25h = new Date('2026-05-07T02:00:00.000Z');

describe('getR3ViolationStreakDecayHours — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → default 24', () => {
    expect(repo.getR3ViolationStreakDecayHours()).toBe(24);
  });

  it("'12' 정수 → 12", () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = '12';
    expect(repo.getR3ViolationStreakDecayHours()).toBe(12);
  });

  it('NaN ("abc") → default 24', () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = 'abc';
    expect(repo.getR3ViolationStreakDecayHours()).toBe(24);
  });

  it("'0' → default 24 (effective rollback 의도가 아닌 잘못된 입력)", () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = '0';
    expect(repo.getR3ViolationStreakDecayHours()).toBe(24);
  });

  it('음수 → default 24', () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = '-5';
    expect(repo.getR3ViolationStreakDecayHours()).toBe(24);
  });

  it('빈 문자열 → default 24', () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = '';
    expect(repo.getR3ViolationStreakDecayHours()).toBe(24);
  });

  it('소수점 (2.5) 도 허용', () => {
    process.env.R3_VIOLATION_STREAK_DECAY_HOURS = '2.5';
    expect(repo.getR3ViolationStreakDecayHours()).toBe(2.5);
  });
});

describe('loadR3ViolationStreakState — 부재/손상 fallback', () => {
  it('파일 부재 → 빈 상태', () => {
    const s = repo.loadR3ViolationStreakState();
    expect(s.violation).toBe('NONE');
    expect(s.consecutiveCount).toBe(0);
    expect(s.scanIds).toEqual([]);
  });

  it('손상 JSON → 빈 상태 fallback (graceful)', () => {
    const file = path.join(tmpDir, 'r3-violation-streak.json');
    fs.writeFileSync(file, '{this is not json');
    const s = repo.loadR3ViolationStreakState();
    expect(s.violation).toBe('NONE');
    expect(s.consecutiveCount).toBe(0);
  });

  it('schemaVersion 불일치 → 빈 상태', () => {
    const file = path.join(tmpDir, 'r3-violation-streak.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 999, violation: 'GATE1_PASS_ZERO', consecutiveCount: 5 }),
    );
    expect(repo.loadR3ViolationStreakState().consecutiveCount).toBe(0);
  });
});

describe('updateR3ViolationStreak — 결정 트리 (ADR-0401 §6)', () => {
  it('(1) violation=NONE → empty state 영속 + 반환', () => {
    repo.saveR3ViolationStreakState({
      schemaVersion: 1,
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      consecutiveCount: 3,
      firstSeenAt: T0.toISOString(),
      lastSeenAt: T0.toISOString(),
      scanIds: ['scan-1'],
    });

    const result = repo.updateR3ViolationStreak({ violation: 'NONE', regime: 'R3_EARLY', now: T0 });
    expect(result.violation).toBe('NONE');
    expect(result.consecutiveCount).toBe(0);

    // 영속도 reset
    expect(repo.loadR3ViolationStreakState().consecutiveCount).toBe(0);
  });

  it('(2) lastSeenAt 부재 → consecutiveCount=1 + firstSeenAt=now', () => {
    const result = repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    expect(result.consecutiveCount).toBe(1);
    expect(result.firstSeenAt).toBe(T0.toISOString());
    expect(result.lastSeenAt).toBe(T0.toISOString());
    expect(result.scanIds).toEqual(['scan-A']);
  });

  it('(2) decay 24h 초과 → consecutiveCount=1 (reset)', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    // T0+1h: 단조 누적 +1 = 2
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-B',
      now: after1h,
    });
    // T0+1h 의 lastSeenAt 으로부터 25h+1ms 후 (>24h 결정 트리 통과 의도)
    const after25hPlus = new Date(after1h.getTime() + 25 * 60 * 60_000 + 1);
    const after = repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-C',
      now: after25hPlus,
    });
    expect(after.consecutiveCount).toBe(1);
    expect(after.firstSeenAt).toBe(after25hPlus.toISOString());
  });

  it('(3) 같은 scanId 중복 호출 → consecutiveCount 변경 없음', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    const dup = repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: after1h,
    });
    expect(dup.consecutiveCount).toBe(1);
    // lastSeenAt 도 동일 (변경 없음)
    expect(dup.lastSeenAt).toBe(T0.toISOString());
  });

  it('(4) violation 변경 → consecutiveCount=1 (다른 위반 시작)', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    const changed = repo.updateR3ViolationStreak({
      violation: 'CANDIDATES_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-B',
      now: after1h,
    });
    expect(changed.consecutiveCount).toBe(1);
    expect(changed.violation).toBe('CANDIDATES_ZERO');
    expect(changed.firstSeenAt).toBe(after1h.toISOString());
  });

  it('(4) regime 변경 → consecutiveCount=1', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    const changed = repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_CONFIRMED',
      scanId: 'scan-B',
      now: after1h,
    });
    expect(changed.consecutiveCount).toBe(1);
    expect(changed.regime).toBe('R3_CONFIRMED');
  });

  it('(5) 같은 violation+regime + 새 scanId + decay 안 지남 → +1', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    const inc = repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-B',
      now: after1h,
    });
    expect(inc.consecutiveCount).toBe(2);
    expect(inc.firstSeenAt).toBe(T0.toISOString()); // 보존
    expect(inc.lastSeenAt).toBe(after1h.toISOString());
    expect(inc.scanIds).toEqual(['scan-B']); // 마지막 1건만
  });

  it('5회 누적 영속 — atomic write 정합', () => {
    let last = repo.loadR3ViolationStreakState();
    for (let i = 1; i <= 5; i++) {
      last = repo.updateR3ViolationStreak({
        violation: 'GATE1_PASS_ZERO',
        regime: 'R3_EARLY',
        scanId: `scan-${i}`,
        now: new Date(T0.getTime() + i * 60 * 60_000),
      });
    }
    expect(last.consecutiveCount).toBe(5);
    // 영속 — 다시 load 후에도 5
    expect(repo.loadR3ViolationStreakState().consecutiveCount).toBe(5);
  });
});

describe('getEffectiveR3ViolationStreak — decay-aware read-only', () => {
  it('CLEAN 상태 → effective=raw', () => {
    const s = repo.getEffectiveR3ViolationStreak(after1h);
    expect(s.consecutiveCount).toBe(0);
    expect(s.violation).toBe('NONE');
  });

  it('decay 안 지남 → effective=raw', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    const eff = repo.getEffectiveR3ViolationStreak(after1h);
    expect(eff.consecutiveCount).toBe(1);
  });

  it('decay 지남 → effective=빈 상태 (영속은 그대로)', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    const eff = repo.getEffectiveR3ViolationStreak(after25h);
    expect(eff.consecutiveCount).toBe(0);
    expect(eff.violation).toBe('NONE');
    // 하지만 영속 raw 는 그대로 (다음 update 가 reset)
    expect(repo.loadR3ViolationStreakState().consecutiveCount).toBe(1);
  });

  it('잘못된 lastSeenAt ISO → effective=raw (안전 fallback)', () => {
    repo.saveR3ViolationStreakState({
      schemaVersion: 1,
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      consecutiveCount: 2,
      firstSeenAt: T0.toISOString(),
      lastSeenAt: 'not-an-iso',
      scanIds: ['scan-A'],
    });
    const eff = repo.getEffectiveR3ViolationStreak(after25h);
    expect(eff.consecutiveCount).toBe(2);
  });
});

describe('resetR3ViolationStreakState — /r3_unblock 시 호출 정합', () => {
  it('영속 streak 제거 후 load → 빈 상태', () => {
    repo.updateR3ViolationStreak({
      violation: 'GATE1_PASS_ZERO',
      regime: 'R3_EARLY',
      scanId: 'scan-A',
      now: T0,
    });
    repo.resetR3ViolationStreakState();
    expect(repo.loadR3ViolationStreakState().consecutiveCount).toBe(0);
  });

  it('파일 부재 시 silent (예외 미발생)', () => {
    expect(() => repo.resetR3ViolationStreakState()).not.toThrow();
  });
});

describe('정적 가드 — KIS 주문 함수 import 0건', () => {
  it('repo 본체 source 검사 — 절대 원칙 #13 정합', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'r3ViolationStreakRepo.ts'), 'utf-8');
    // KIS 주문 함수 5종 import 0건
    expect(src).not.toMatch(/placeKisMarketOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
    // 외부 데이터 소스 호출 0건 (절대 원칙 검증)
    expect(src).not.toMatch(/import.*kisClient/);
    expect(src).not.toMatch(/import.*krxClient/);
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
  });
});
