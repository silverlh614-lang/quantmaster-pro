// @responsibility Gate1 VOLUME_LIQUIDITY 입력 배선 복구 flag-gated 동작 검증 — OFF byte-identical / ON raw→점수 / 결손 0 graceful.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMinimumSignalScoreTrace,
  type MinimumSignalScoreTrace,
} from "./minimumSignalScoreTrace.js";
import { isGate1VolumeLiquidityWiringEnabled } from "../gateConfig.js";

const FLAG = "GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED";

const verifiedSupply = {
  status: "VERIFIED" as const,
  providerIssue: false,
  marketSignal: false,
  gate1Severity: "NONE" as const,
  reason: ["ok"],
};

function minTrace(
  patch: Partial<
    Parameters<typeof buildMinimumSignalScoreTrace>[0]["trace"]
  > = {},
): MinimumSignalScoreTrace {
  return buildMinimumSignalScoreTrace({
    trace: {
      symbol: "VLW",
      stageReached: "WATCHLIST",
      blockers: [],
      executionImpact: "NONE",
      ...patch,
    },
    hasGate1Blocker: true,
    regime: "R3_EARLY",
    marketSession: "NORMAL",
    supplyProviderHealth: verifiedSupply,
    supplyConfluenceState: "NEUTRAL",
    hasSectorEnergyDiagnostic: false,
  });
}

function volComponent(patch: Parameters<typeof minTrace>[0]) {
  return minTrace(patch).components.find((c) => c.code === "VOLUME_LIQUIDITY");
}

describe("Gate1 VOLUME_LIQUIDITY wiring flag reader", () => {
  const original = process.env[FLAG];
  afterEach(() => {
    if (original === undefined) delete process.env[FLAG];
    else process.env[FLAG] = original;
  });

  it("default ON (미설정, ADR-0647) — `!== 'false'` opt-OUT", () => {
    delete process.env[FLAG];
    expect(isGate1VolumeLiquidityWiringEnabled()).toBe(true);
  });

  it("explicit 'true' 도 ON (default 와 동일)", () => {
    process.env[FLAG] = "true";
    expect(isGate1VolumeLiquidityWiringEnabled()).toBe(true);
  });

  it("정확히 'false' 만 kill-switch OFF, 그 외 임의값은 ON (ADR-0157·0647 거울)", () => {
    process.env[FLAG] = "false";
    expect(isGate1VolumeLiquidityWiringEnabled()).toBe(false);
    // 정확히 'false' 가 아니면 전부 ON (opt-OUT 거울 대칭)
    for (const v of ["1", "TRUE", "yes", "on", "False", "0", "off"]) {
      process.env[FLAG] = v;
      expect(isGate1VolumeLiquidityWiringEnabled()).toBe(true);
    }
  });
});

describe("VOLUME_LIQUIDITY wiring — OFF byte-identical (`=false` kill-switch, ADR-0647)", () => {
  // ADR-0647 로 default 가 ON 으로 flip 됐으므로, legacy OFF byte-identical baseline 의도를
  // 보존하기 위해 explicit `=false` 로 pin 한다(단언 약화 0). afterEach 로 격리.
  beforeEach(() => {
    process.env[FLAG] = "false";
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("OFF: avgVolume20d+volume 만 있고 plain avgVolume 부재 → 기존처럼 0/MISSING (회귀 baseline)", () => {
    const vol = volComponent({
      quote: { avgVolume20d: 1_000_000, volume: 1_500_000 },
    } as Parameters<typeof minTrace>[0]);
    expect(vol?.confidence).toBe("MISSING");
    expect(vol?.weightedScore).toBe(0);
    expect(vol?.normalizedScore).toBe(0);
  });

  it("OFF: plain avgVolume+volume 존재 시 기존 ratio 채점은 그대로 동작(무변경)", () => {
    const vol = volComponent({ volume: 1_500_000, avgVolume: 1_000_000 });
    expect(vol?.confidence).toBe("VERIFIED");
    expect(vol?.normalizedScore).toBe(100);
  });

  it("OFF: volumeLiquidityPassed fallback 보존", () => {
    const passedTrue = volComponent({ volumeLiquidityPassed: true });
    expect(passedTrue?.confidence).toBe("VERIFIED");
    expect(passedTrue?.weightedScore).toBe(8);
  });
});

describe("VOLUME_LIQUIDITY wiring — ON raw volume → 양수 점수", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("ON: avgVolume20d+volume → ratio 기반 VERIFIED 양수 점수 복원", () => {
    const vol = volComponent({
      quote: { avgVolume20d: 1_000_000, volume: 1_500_000 },
    } as Parameters<typeof minTrace>[0]);
    expect(vol?.confidence).toBe("VERIFIED");
    // ratio 1.5 → clamp(60 + (0.5/0.5)*40,0,100) = 100
    expect(vol?.normalizedScore).toBe(100);
    expect(vol?.weightedScore).toBeGreaterThan(0);
    expect(vol?.rawValue).toMatchObject({ volume: 1_500_000, avgVolume: 1_000_000, ratio: 1.5 });
  });

  it("ON: symbolFeatures.avgVolume20d(무점경로 확장)로도 복원된다 (저유동성 페널티)", () => {
    const vol = volComponent({
      symbolFeatures: { avgVolume20d: 2_000_000 },
      volume: 400_000,
    } as Parameters<typeof minTrace>[0]);
    expect(vol?.confidence).toBe("VERIFIED");
    // ratio 0.2 (<0.5) → LIQUIDITY_LOW 페널티 + marketSignal=true
    expect(vol?.rawValue).toMatchObject({ ratio: 0.2 });
    expect(vol?.marketSignal).toBe(true);
    expect(vol?.penaltyReason).toBe("LIQUIDITY_LOW");
  });

  it("ON: 사전계산 volumeRatio 만 있어도 동일 곡선식으로 복원", () => {
    const vol = volComponent({
      quote: { volumeRatio: 1.5 },
    } as Parameters<typeof minTrace>[0]);
    expect(vol?.confidence).toBe("VERIFIED");
    expect(vol?.normalizedScore).toBe(100);
  });

  it("ON: 입력 진짜 결손 → 0 graceful (페널티 아님, marketSignal=false, 불변식 #6)", () => {
    const vol = volComponent({});
    expect(vol?.weightedScore).toBe(0);
    expect(vol?.confidence).toBe("MISSING");
    expect(vol?.marketSignal).toBe(false);
    expect(vol?.penaltyApplied).toBe(false);
  });

  it("ON: 이미 plain avgVolume 으로 VERIFIED 면 무변경(이중계상 회피)", () => {
    const vol = volComponent({ volume: 1_500_000, avgVolume: 1_000_000 });
    expect(vol?.confidence).toBe("VERIFIED");
    expect(vol?.normalizedScore).toBe(100);
  });
});

describe("VOLUME_LIQUIDITY wiring — default ON (미설정, ADR-0647) == explicit 'true'", () => {
  // ADR-0645/0611 default-ON 케이스 모사: 미설정(default ON)이 explicit ='true' 와 동치임을 검증.
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("default(미설정): avgVolume20d+volume → ratio 기반 VERIFIED 양수 점수 복원 (== explicit ='true')", () => {
    delete process.env[FLAG];
    const dflt = volComponent({
      quote: { avgVolume20d: 1_000_000, volume: 1_500_000 },
    } as Parameters<typeof minTrace>[0]);
    expect(dflt?.confidence).toBe("VERIFIED");
    expect(dflt?.normalizedScore).toBe(100);
    expect(dflt?.weightedScore).toBeGreaterThan(0);
    expect(dflt?.rawValue).toMatchObject({ volume: 1_500_000, avgVolume: 1_000_000, ratio: 1.5 });

    process.env[FLAG] = "true";
    const explicitOn = volComponent({
      quote: { avgVolume20d: 1_000_000, volume: 1_500_000 },
    } as Parameters<typeof minTrace>[0]);
    expect(dflt?.weightedScore).toBeCloseTo(explicitOn?.weightedScore ?? -1, 5);
  });

  it("default(미설정): 입력 진짜 결손 → 0 graceful (페널티 아님, 불변식 #6)", () => {
    delete process.env[FLAG];
    const vol = volComponent({});
    expect(vol?.weightedScore).toBe(0);
    expect(vol?.confidence).toBe("MISSING");
    expect(vol?.marketSignal).toBe(false);
    expect(vol?.penaltyApplied).toBe(false);
  });
});

describe("VOLUME_LIQUIDITY wiring — hypothetical 관측 stamp (flag 무관)", () => {
  // hypothetical stamp 는 flag 와 무관하므로, 원래 "flag OFF" 관측 의도를 보존하기 위해
  // explicit `=false` 로 pin 한다(ADR-0647 default ON flip 이후 격리).
  beforeEach(() => {
    process.env[FLAG] = "false";
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it("flag OFF 에서도 force-ON delta 가 stamp 되어 효과 크기를 관측한다", () => {
    const trace = minTrace({
      quote: { avgVolume20d: 1_000_000, volume: 1_500_000 },
    } as Parameters<typeof minTrace>[0]);
    expect(trace.volumeLiquidityWiringDelta).toBeGreaterThan(0);
    expect(typeof trace.volumeLiquidityWiringHypotheticalPassed).toBe("boolean");
  });

  it("결손 종목은 hypothetical delta 0 (force-ON 에서도 0 graceful)", () => {
    const trace = minTrace({});
    expect(trace.volumeLiquidityWiringDelta).toBe(0);
  });
});
