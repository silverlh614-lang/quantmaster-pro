// @responsibility MOMENTUM AUTO 편입 감속 + re-add cooldown 회귀 테스트 (Patch-WATCHLIST-SATURATION-COOLDOWN-001)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  momentumAutoAddPerCycle,
  momentumAutoAddCooldownMin,
  momentumReAddCooldownMin,
  momentumAutoSlowdownRatio,
  evaluateMomentumAutoIntake,
  syncMomentumAutoSnapshot,
  isMomentumReAddBlocked,
  __resetMomentumAutoIntakeStateForTests,
} from "./momentumAutoIntakePolicy.js";

const BASE_NOW = new Date("2026-05-14T00:00:00.000Z");

const ENV_KEYS = [
  "MOMENTUM_AUTO_ADD_PER_CYCLE",
  "MOMENTUM_AUTO_ADD_COOLDOWN_MIN",
  "MOMENTUM_READD_COOLDOWN_MIN",
  "MOMENTUM_AUTO_SLOWDOWN_RATIO",
] as const;
const origEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
    delete process.env[k];
  }
  __resetMomentumAutoIntakeStateForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k];
    else process.env[k] = origEnv[k];
  }
  __resetMomentumAutoIntakeStateForTests();
});

// ── env 상수 ────────────────────────────────────────────────────────────────
describe("env 상수 getter — 기본값 + 오버라이드", () => {
  it("기본값 — perCycle 3 / addCooldown 15 / readdCooldown 120 / slowdownRatio 0.8", () => {
    expect(momentumAutoAddPerCycle()).toBe(3);
    expect(momentumAutoAddCooldownMin()).toBe(15);
    expect(momentumReAddCooldownMin()).toBe(120);
    expect(momentumAutoSlowdownRatio()).toBe(0.8);
  });

  it("env 오버라이드 적용", () => {
    process.env.MOMENTUM_AUTO_ADD_PER_CYCLE = "5";
    process.env.MOMENTUM_AUTO_ADD_COOLDOWN_MIN = "30";
    process.env.MOMENTUM_READD_COOLDOWN_MIN = "240";
    process.env.MOMENTUM_AUTO_SLOWDOWN_RATIO = "0.9";
    expect(momentumAutoAddPerCycle()).toBe(5);
    expect(momentumAutoAddCooldownMin()).toBe(30);
    expect(momentumReAddCooldownMin()).toBe(240);
    expect(momentumAutoSlowdownRatio()).toBe(0.9);
  });

  it("잘못된 env 값 → 기본값 fallback", () => {
    process.env.MOMENTUM_AUTO_ADD_PER_CYCLE = "abc";
    process.env.MOMENTUM_AUTO_SLOWDOWN_RATIO = "-1";
    expect(momentumAutoAddPerCycle()).toBe(3);
    expect(momentumAutoSlowdownRatio()).toBe(0.8);
  });
});

// ── G. AUTO 편입 감속 결정 ──────────────────────────────────────────────────
describe("G. evaluateMomentumAutoIntake — AUTO 편입 감속 결정", () => {
  it("autoRatio >= 0.8 && count >= alertCap → slowed=true / perCycleLimit=3", () => {
    const d = evaluateMomentumAutoIntake({
      momentumCount: 35,
      alertCap: 30,
      autoCount: 32,
      manualCount: 3,
      dartCount: 0,
    });
    expect(d.slowed).toBe(true);
    expect(d.perCycleLimit).toBe(3);
    expect(d.autoRatio).toBeGreaterThanOrEqual(0.8);
  });

  it("autoRatio < 0.8 → slowed=false / perCycleLimit=Infinity", () => {
    const d = evaluateMomentumAutoIntake({
      momentumCount: 35,
      alertCap: 30,
      autoCount: 20,
      manualCount: 15,
      dartCount: 0,
    });
    expect(d.slowed).toBe(false);
    expect(d.perCycleLimit).toBe(Number.POSITIVE_INFINITY);
  });

  it("count < alertCap → slowed=false (autoRatio 높아도 감속 안 함)", () => {
    const d = evaluateMomentumAutoIntake({
      momentumCount: 25,
      alertCap: 30,
      autoCount: 25,
      manualCount: 0,
      dartCount: 0,
    });
    expect(d.slowed).toBe(false);
    expect(d.perCycleLimit).toBe(Number.POSITIVE_INFINITY);
  });

  it("boundary — autoRatio 정확히 0.8 + count === alertCap → slowed=true", () => {
    const d = evaluateMomentumAutoIntake({
      momentumCount: 30,
      alertCap: 30,
      autoCount: 8,
      manualCount: 2,
      dartCount: 0,
    });
    expect(d.autoRatio).toBeCloseTo(0.8, 5);
    expect(d.slowed).toBe(true);
  });

  it("source 0건 → autoRatio 0 / slowed=false (division-by-zero 안전)", () => {
    const d = evaluateMomentumAutoIntake({
      momentumCount: 35,
      alertCap: 30,
      autoCount: 0,
      manualCount: 0,
      dartCount: 0,
    });
    expect(d.autoRatio).toBe(0);
    expect(d.slowed).toBe(false);
  });

  it("env MOMENTUM_AUTO_ADD_PER_CYCLE 오버라이드 → perCycleLimit 반영", () => {
    process.env.MOMENTUM_AUTO_ADD_PER_CYCLE = "1";
    const d = evaluateMomentumAutoIntake({
      momentumCount: 40,
      alertCap: 30,
      autoCount: 40,
      manualCount: 0,
      dartCount: 0,
    });
    expect(d.slowed).toBe(true);
    expect(d.perCycleLimit).toBe(1);
  });

  it("reason 문자열 — slowed / 정상 분기 모두 사유 명시", () => {
    const slowed = evaluateMomentumAutoIntake({
      momentumCount: 40,
      alertCap: 30,
      autoCount: 40,
      manualCount: 0,
      dartCount: 0,
    });
    expect(slowed.reason).toContain("autoRatio");
    const normal = evaluateMomentumAutoIntake({
      momentumCount: 10,
      alertCap: 30,
      autoCount: 10,
      manualCount: 0,
      dartCount: 0,
    });
    expect(normal.reason).toContain("정상");
  });
});

// ── re-add cooldown — runtime snapshot diff ─────────────────────────────────
describe("re-add cooldown — syncMomentumAutoSnapshot + isMomentumReAddBlocked", () => {
  it("최초 sync (직전 snapshot 없음) → newlyRemoved 빈 배열, 차단 없음", () => {
    const { newlyRemoved } = syncMomentumAutoSnapshot(["A", "B", "C"], BASE_NOW);
    expect(newlyRemoved).toEqual([]);
    expect(isMomentumReAddBlocked("A", BASE_NOW)).toBe(false);
  });

  it("snapshot 에서 사라진 code → cleanup/탈락 으로 간주, cooldown 창 내 재편입 차단", () => {
    syncMomentumAutoSnapshot(["A", "B", "C"], BASE_NOW);
    // 다음 사이클: B 가 사라짐 (cleanup/탈락)
    const t1 = new Date(BASE_NOW.getTime() + 60 * 1000);
    const { newlyRemoved } = syncMomentumAutoSnapshot(["A", "C"], t1);
    expect(newlyRemoved).toEqual(["B"]);
    expect(isMomentumReAddBlocked("B", t1)).toBe(true);
    expect(isMomentumReAddBlocked("A", t1)).toBe(false);
  });

  it("cooldown 창(120분) 만료 후 → 재편입 차단 해제 + removal 기록 자동 청소", () => {
    syncMomentumAutoSnapshot(["A", "B"], BASE_NOW);
    const t1 = new Date(BASE_NOW.getTime() + 60 * 1000);
    syncMomentumAutoSnapshot(["A"], t1); // B 사라짐
    expect(isMomentumReAddBlocked("B", t1)).toBe(true);
    // 121분 후 — cooldown 만료
    const after121min = new Date(t1.getTime() + 121 * 60 * 1000);
    expect(isMomentumReAddBlocked("B", after121min)).toBe(false);
    // 재차 호출 — 이미 청소됨
    expect(isMomentumReAddBlocked("B", after121min)).toBe(false);
  });

  it("사라졌던 code 가 다시 snapshot 에 등장 → removal 기록 해제 (재편입 성공)", () => {
    syncMomentumAutoSnapshot(["A", "B"], BASE_NOW);
    const t1 = new Date(BASE_NOW.getTime() + 60 * 1000);
    syncMomentumAutoSnapshot(["A"], t1); // B 사라짐
    expect(isMomentumReAddBlocked("B", t1)).toBe(true);
    // 다음 사이클에서 B 가 다시 등장 (어떤 경로로든 재편입됨)
    const t2 = new Date(BASE_NOW.getTime() + 2 * 60 * 1000);
    syncMomentumAutoSnapshot(["A", "B"], t2);
    expect(isMomentumReAddBlocked("B", t2)).toBe(false);
  });

  it("env MOMENTUM_READD_COOLDOWN_MIN 오버라이드 — 5분 설정 시 6분 후 차단 해제", () => {
    process.env.MOMENTUM_READD_COOLDOWN_MIN = "5";
    syncMomentumAutoSnapshot(["A", "B"], BASE_NOW);
    const t1 = new Date(BASE_NOW.getTime() + 60 * 1000);
    syncMomentumAutoSnapshot(["A"], t1);
    expect(isMomentumReAddBlocked("B", t1)).toBe(true);
    const after6min = new Date(t1.getTime() + 6 * 60 * 1000);
    expect(isMomentumReAddBlocked("B", after6min)).toBe(false);
  });

  it("__resetMomentumAutoIntakeStateForTests → snapshot/removal 상태 초기화", () => {
    syncMomentumAutoSnapshot(["A", "B"], BASE_NOW);
    syncMomentumAutoSnapshot(["A"], new Date(BASE_NOW.getTime() + 60 * 1000));
    __resetMomentumAutoIntakeStateForTests();
    // 초기화 후 첫 sync 는 다시 "최초" — 직전 snapshot 없음
    const { newlyRemoved } = syncMomentumAutoSnapshot(["A"], BASE_NOW);
    expect(newlyRemoved).toEqual([]);
  });
});

// ── 정적 가드 ───────────────────────────────────────────────────────────────
/** 주석(블록/라인) 제거 후 코드 본문만 검사 — 헤더 docstring 의 산문 매칭 차단. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("정적 가드 — KIS/Shadow/매매엔진 의존 0건", () => {
  it("momentumAutoIntakePolicy.ts 는 KIS client / Shadow / 주문 모듈을 import·호출하지 않는다", () => {
    const code = stripComments(
      readFileSync(
        fileURLToPath(new URL("./momentumAutoIntakePolicy.ts", import.meta.url)),
        "utf-8",
      ),
    );
    expect(code).not.toMatch(/from\s+["'].*kisClient/);
    expect(code).not.toMatch(/from\s+["'].*shadowTradeRepo/);
    expect(code).not.toMatch(/from\s+["'].*shadowPositionLifecycle/);
    expect(code).not.toMatch(/from\s+["'].*autoTradeEngine/);
    expect(code).not.toMatch(/\bgetPrice\s*\(|\bfetchCurrentPrice\s*\(|\bplaceKis\w*\s*\(/);
  });
});
