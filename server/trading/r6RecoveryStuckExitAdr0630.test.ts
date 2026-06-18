// @responsibility ADR-0630 D2 회귀 — R6 복구 R5_STABILIZING 무한 latch stuck-exit flag 분기 + tick 카운트 + 하위호환.
//
// D2: R6_RECOVERY_STUCK_EXIT_ENABLED ON 이면 모순 지대(mhs 40~64 + raw 강세 R1/R2/R3_EARLY)에서 raw 강세가
// MIN_HEALTHY_TICKS 연속 지속되면 R5_STABILIZING latch 를 R3_NORMAL 로 강제 종료. 첫 tick 은 R5 유지(초기 보호).
// mhs≥70/≥65 기존 탈출 경로 보존(flag 무관). flag OFF → 현 stuck 동작 byte-identical.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import type { MacroState } from "../persistence/macroStateRepo.js";
import { defaultRegimeTransitionState } from "../persistence/regimeTransitionStateRepo.js";

const settingsMock = vi.hoisted(() => ({ loadTradingSettings: vi.fn() }));
vi.mock("../persistence/tradingSettingsRepo.js", async (importActual) => ({
  ...(await importActual<typeof import("../persistence/tradingSettingsRepo.js")>()),
  loadTradingSettings: settingsMock.loadTradingSettings,
}));

import { evaluateR6RecoveryTransition } from "./regimeBridge.js";

// mhs 를 모순 지대(40~64)로 두면 raw 는 R3_EARLY(classify mhs≥40 자격) 이지만 mhs<65 라 기존 exit 가 R5 latch.
function macro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 50,
    regime: "GREEN",
    updatedAt: "2026-05-17T00:00:00.000Z",
    vkospi: 18,
    vkospiDayChange: -5,
    usdKrwDayChange: 0.5,
    usdKrw20dChange: -1,
    kospiDayReturn: 0.5,
    kospi20dReturn: 2,
    kospiAbove20MA: true,
    kospiAbove60MA: false,
    foreignNetBuy5d: 1000,
    passiveActiveBoth: false,
    vkospi5dTrend: -4,
    spx20dReturn: 2,
    vix: 17,
    dxy5dChange: -1,
    shortSellingRatio: 5,
    ...overrides,
  } as MacroState;
}

// 직전 상태기계가 R5_STABILIZING latch 인 previousState (모순 지대 stuck 시작점).
function stuckPrevious(now: Date, consecutiveHealthyRecoveryTicks?: number) {
  return {
    ...defaultRegimeTransitionState(now.toISOString()),
    currentRegime: "R3_EARLY" as const,
    rawRegime: "R3_EARLY" as const,
    effectiveRegime: "R3_EARLY" as const,
    r6RecoveryStatus: "R5_STABILIZING" as const,
    r6StateMachineState: "R5_STABILIZING" as const,
    recoveryConfirmations: 5,
    sourceUpdatedAt: "2026-05-16T00:00:00.000Z",
    ...(consecutiveHealthyRecoveryTicks !== undefined ? { consecutiveHealthyRecoveryTicks } : {}),
  };
}

beforeEach(() => {
  settingsMock.loadTradingSettings.mockReturnValue({ r6RecoveryFastTrack: { enabled: false } } as never);
  process.env.R6_RECOVERY_COOLDOWN_MINUTES = "0";
  process.env.R6_RECOVERY_REQUIRE_CONFIRMATIONS = "1";
});

afterEach(() => {
  delete process.env.R6_RECOVERY_STUCK_EXIT_ENABLED;
  delete process.env.R6_RECOVERY_STUCK_EXIT_MIN_HEALTHY_TICKS;
  delete process.env.R6_RECOVERY_COOLDOWN_MINUTES;
  delete process.env.R6_RECOVERY_REQUIRE_CONFIRMATIONS;
  settingsMock.loadTradingSettings.mockReset();
});

describe("ADR-0630 D2 — R6 복구 stuck-exit (R6_RECOVERY_STUCK_EXIT_ENABLED)", () => {
  it("(a) flag OFF — mhs 40~64 + raw R3_EARLY + ticks 누적 → R5_STABILIZING latch 보존 (byte-identical)", () => {
    delete process.env.R6_RECOVERY_STUCK_EXIT_ENABLED;
    const now = new Date("2026-05-17T00:01:00.000Z");
    // ticks 가 임계 이상이어도 flag OFF 면 신규 분기 미평가 → 현 stuck 동작.
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now, 5),
      macro({ mhs: 50, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R5_STABILIZING");
  });

  it("(b) flag ON — mhs 40~64 + raw R3_EARLY + ticks≥2 → R3_NORMAL 강제 탈출", () => {
    process.env.R6_RECOVERY_STUCK_EXIT_ENABLED = "true";
    const now = new Date("2026-05-17T00:01:00.000Z");
    // prev ticks=1 → 이번 tick 에서 +1=2 (임계 2 도달) → 탈출.
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now, 1),
      macro({ mhs: 50, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R3_NORMAL");
    // 탈출 시 tick 리셋.
    expect(state.consecutiveHealthyRecoveryTicks).toBe(0);
  });

  it("(c) flag ON — 첫 tick (ticks 미달) → R5_STABILIZING 유지 (초기 falling-knife 보호)", () => {
    process.env.R6_RECOVERY_STUCK_EXIT_ENABLED = "true";
    const now = new Date("2026-05-17T00:01:00.000Z");
    // legacy(ticks 부재) → sanitizer 0 → 이번 tick +1=1 (임계 2 미달) → R5 유지.
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now),
      macro({ mhs: 50, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R5_STABILIZING");
    expect(state.consecutiveHealthyRecoveryTicks).toBe(1);
  });

  it("(d) flag ON — mhs≥70 정상 탈출 무회귀 (기존 경로, tick 무관 R3_NORMAL)", () => {
    process.env.R6_RECOVERY_STUCK_EXIT_ENABLED = "true";
    const now = new Date("2026-05-17T00:01:00.000Z");
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now, 0),
      macro({ mhs: 72, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R3_NORMAL");
  });

  it("(e) flag ON — raw 약세(R5_CAUTION) 이탈 → tick 0 리셋, stuck-exit 미발동", () => {
    process.env.R6_RECOVERY_STUCK_EXIT_ENABLED = "true";
    const now = new Date("2026-05-17T00:01:00.000Z");
    // raw 가 R5_CAUTION(약세) → rawHealthy=false → tick 리셋 0, 신규 탈출 분기 미충족.
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now, 5),
      macro({ mhs: 50, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R5_CAUTION",
      now,
    );
    expect(state.r6StateMachineState).toBe("R5_STABILIZING");
    expect(state.consecutiveHealthyRecoveryTicks).toBe(0);
  });

  it("(f) flag OFF — mhs≥70 정상 탈출 무회귀 (기존 경로 byte-identical)", () => {
    delete process.env.R6_RECOVERY_STUCK_EXIT_ENABLED;
    const now = new Date("2026-05-17T00:01:00.000Z");
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now, 0),
      macro({ mhs: 72, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R3_NORMAL");
  });

  it("(g) downstream — flag ON 탈출 시 effectiveRegime 정상화 (R3_NORMAL 상태기계 → applyForcedDowngrade(raw))", () => {
    process.env.R6_RECOVERY_STUCK_EXIT_ENABLED = "true";
    const now = new Date("2026-05-17T00:01:00.000Z");
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now, 1),
      macro({ mhs: 50, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R3_NORMAL");
    // recovered 경로 effectiveRegime = applyForcedDowngrade(rawRegime) → R3_EARLY (downgrade 비활성).
    expect(state.effectiveRegime).toBe("R3_EARLY");
    expect(state.r6RecoveryStatus).toBe("RECOVERED");
  });

  it("(h) MIN_HEALTHY_TICKS 하한 clamp — 0/음수 설정 시 최소 1 (첫 tick 보호 보장)", () => {
    process.env.R6_RECOVERY_STUCK_EXIT_ENABLED = "true";
    process.env.R6_RECOVERY_STUCK_EXIT_MIN_HEALTHY_TICKS = "0";
    const now = new Date("2026-05-17T00:01:00.000Z");
    // 설정 0 → clamp ≥1. legacy(ticks 부재) → +1=1 → 임계 1 도달 → 탈출 (clamp 적용으로 첫 tick 에 탈출 가능).
    const state = evaluateR6RecoveryTransition(
      stuckPrevious(now),
      macro({ mhs: 50, updatedAt: "2026-05-17T00:01:00.000Z" }),
      "R3_EARLY",
      now,
    );
    expect(state.r6StateMachineState).toBe("R3_NORMAL");
  });
});
