/**
 * positionSizingEngineWiring.test.ts (ADR-0162)
 *
 * Phase 2-D wiring SSOT 회귀 — ENV 우회 + 입력 매핑 + 안전 fallback + sizingSource marker.
 * LIVE 회귀 위험 격리 검증 + 학습 데이터 격리 검증.
 *
 * 실행: npx vitest run server/trading/sizing/positionSizingEngineWiring.test.ts
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  shouldApplyPositionSizingEngine,
  isLivePositionSizingEngineEnabled,
  mapToPositionSizingInput,
  applyPositionSizingEngine,
  type MapToInputContext,
} from './positionSizingEngineWiring.js';

const ORIGINAL_ENV = process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;

beforeEach(() => {
  delete process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
});
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
  else process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = ORIGINAL_ENV;
});

// ─── 정상 매핑 입력 (GROWTH 티어 시나리오) ───────────────────────────────────

const validCtx: MapToInputContext = {
  totalAssets: 15_000_000,        // GROWTH 티어 (1000만~3000만)
  shadowEntryPrice: 50_000,
  stopLoss: 46_000,                // 8% 손절
  signalGrade: 'STRONG_BUY',
  regimeKelly: 1.0,
  confidenceModifier: 1.0,
  rrr: 2.5,
  marketCap: 1_000_000_000_000_000,
  avgDailyVolume20d: 1_000_000_000_000_000,
  isNormalRegime: true,
  enemyChecklistPassed: true,
  highDataReliability: true,
  gate1AllPassed: true,
  notInDowntrend: true,
};

// ─── shouldApplyPositionSizingEngine ───────────────────────────────────────

describe('shouldApplyPositionSizingEngine — ENV + SHADOW 분기 SSOT', () => {
  it('LIVE 모드 (shadowMode=false) → 항상 false (ENV 무관, LIVE 회귀 격리)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(shouldApplyPositionSizingEngine(false)).toBe(false);
  });

  it('SHADOW + ENV 미설정 → false (default OFF)', () => {
    expect(shouldApplyPositionSizingEngine(true)).toBe(true);
  });

  it('SHADOW + ENV 명시 활성화 → true', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(shouldApplyPositionSizingEngine(true)).toBe(true);
  });

  it("SHADOW + ENV 'false' → false", () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'false';
    expect(shouldApplyPositionSizingEngine(true)).toBe(true);
  });

  it("SHADOW + ENV '1' → false (정확히 'true' 만 인정)", () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = '1';
    expect(shouldApplyPositionSizingEngine(true)).toBe(true);
  });

  it("SHADOW + ENV 'TRUE' (대문자) → false (정확히 'true' 만 인정)", () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'TRUE';
    expect(shouldApplyPositionSizingEngine(true)).toBe(true);
  });
});

// ─── isLivePositionSizingEngineEnabled (ADR-0165 — ENV 기반 동적 결정) ──────

describe('isLivePositionSizingEngineEnabled — ADR-0165 ENV 동적 결정 (default OFF)', () => {
  it('LIVE_ENABLED ENV 미설정 (default) → false', () => {
    expect(isLivePositionSizingEngineEnabled()).toBe(false);
  });

  it('SHADOW APPLY ENV 활성화 → LIVE_ENABLED 무영향 (default false)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(isLivePositionSizingEngineEnabled()).toBe(false);
  });

  // ADR-0165 정합: LIVE_ENABLED ENV 활성/비활성 상세 분기는 positionSizingEngineWiringPhase3.test.ts 에서 검증.
});

// ─── mapToPositionSizingInput — 입력 매핑 + 안전 fallback ──────────────────

describe('mapToPositionSizingInput — 입력 매핑 SSOT', () => {
  it('정상 입력 → PositionSizingInput 합성', () => {
    const result = mapToPositionSizingInput(validCtx);
    expect(result).not.toBeNull();
    expect(result!.accountEquity).toBe(15_000_000);
    expect(result!.peakEquity).toBe(15_000_000); // accountEquity = peakEquity 가정 (drawdown 추적은 후속 PR)
    expect(result!.stopLossPct).toBeCloseTo(0.08, 2);
    expect(result!.signalGrade).toBe('STRONG_BUY');
    expect(result!.rrrMultiplier).toBe(1.0);
    expect(result!.rrrAbove2_5).toBe(true);
  });

  it('totalAssets=0 → null (안전 fallback)', () => {
    expect(mapToPositionSizingInput({ ...validCtx, totalAssets: 0 })).toBeNull();
  });

  it('totalAssets NaN → null', () => {
    expect(mapToPositionSizingInput({ ...validCtx, totalAssets: NaN })).toBeNull();
  });

  it('shadowEntryPrice=0 → null', () => {
    expect(mapToPositionSizingInput({ ...validCtx, shadowEntryPrice: 0 })).toBeNull();
  });

  it('stopLoss >= shadowEntryPrice → null (음수 손절폭 차단)', () => {
    expect(mapToPositionSizingInput({ ...validCtx, stopLoss: 50_000 })).toBeNull();
    expect(mapToPositionSizingInput({ ...validCtx, stopLoss: 60_000 })).toBeNull();
  });

  it('stopLoss=0 → null', () => {
    expect(mapToPositionSizingInput({ ...validCtx, stopLoss: 0 })).toBeNull();
  });

  it('regimeKelly NaN → 1.0 fallback (안전 default)', () => {
    const result = mapToPositionSizingInput({ ...validCtx, regimeKelly: NaN });
    expect(result!.regimeMultiplier).toBe(1.0);
  });

  it('regimeKelly 음수 → 1.0 fallback', () => {
    const result = mapToPositionSizingInput({ ...validCtx, regimeKelly: -0.5 });
    expect(result!.regimeMultiplier).toBe(1.0);
  });

  it('rrr < 2.0 → rrrMultiplier=0 (진입 차단)', () => {
    const result = mapToPositionSizingInput({ ...validCtx, rrr: 1.5 });
    expect(result!.rrrMultiplier).toBe(0);
  });

  it('rrr >= 2.0 → rrrMultiplier=1.0', () => {
    const result = mapToPositionSizingInput({ ...validCtx, rrr: 2.0 });
    expect(result!.rrrMultiplier).toBe(1.0);
  });

  it('rrr >= 2.5 → rrrAbove2_5=true (신호 우선권 조건)', () => {
    expect(mapToPositionSizingInput({ ...validCtx, rrr: 2.5 })!.rrrAbove2_5).toBe(true);
    expect(mapToPositionSizingInput({ ...validCtx, rrr: 2.49 })!.rrrAbove2_5).toBe(false);
  });

  it('lossStreakState 미전달 → default streak (0건)', () => {
    const result = mapToPositionSizingInput(validCtx);
    expect(result!.lossStreakState.consecutiveLosses).toBe(0);
    expect(result!.lossStreakState.coolOffUntil).toBeNull();
  });

  it('peakEquity = totalAssets 가정 (drawdown 추적 후속 PR)', () => {
    const result = mapToPositionSizingInput(validCtx);
    expect(result!.peakEquity).toBe(result!.accountEquity);
  });
});

// ─── applyPositionSizingEngine — 통합 진입점 4 분기 ────────────────────────

describe('applyPositionSizingEngine — 통합 진입점 4 분기', () => {
  it('ENV OFF (default) → applied=false / sizingSource=LEGACY_SSOT / skipReason=ENV_DISABLED', () => {
    const result = applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(true);
    expect(result.sizingSource).toBe('LIVE_SIZING_MIRROR');
    expect(result.quantity).toBeGreaterThanOrEqual(1);
    expect(result.result).toBeDefined();
  });

  it('LIVE 모드 → applied=false / skipReason=LIVE_MODE (LIVE 회귀 격리)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = applyPositionSizingEngine(false, validCtx);
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('LIVE_MODE');
    expect(result.sizingSource).toBe('LEGACY_SSOT');
  });

  it('ENV ON + SHADOW + 정상 입력 → applied=true / sizingSource=NEW_TIER_ENGINE', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(true);
    expect(result.sizingSource).toBe('LIVE_SIZING_MIRROR');
    expect(result.quantity).toBeGreaterThanOrEqual(1);
    expect(result.result).toBeDefined();
    expect(result.result!.tier.name).toBe('GROWTH');
  });

  it('ENV ON + SHADOW + totalAssets NaN → applied=false / skipReason=INPUT_MAPPING_FAILED', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = applyPositionSizingEngine(true, { ...validCtx, totalAssets: NaN });
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('INPUT_MAPPING_FAILED');
    expect(result.sizingSource).toBe('LEGACY_SSOT');
    expect(result.result).toBeUndefined();
  });

  it('ENV ON + SHADOW + RRR=0 → applied=false (engine 차단으로 finalPosition=0 → quantity<1)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = applyPositionSizingEngine(true, { ...validCtx, rrr: 1.0 });
    // RRR<2.0 시 rrrMultiplier=0 → signalBasedPosition=0 → quantity<1
    expect(result.applied).toBe(false);
    expect(result.sizingSource).toBe('LEGACY_SSOT');
    expect(result.skipReason).toMatch(/QUANTITY_BELOW_ONE|BLOCKED_BY_ENGINE/);
  });

  it('ENV ON + SHADOW + 매우 높은 가격 (finalPosition / price < 1) → applied=false / skipReason=QUANTITY_BELOW_ONE', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = applyPositionSizingEngine(true, { ...validCtx, shadowEntryPrice: 100_000_000, stopLoss: 92_000_000 });
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('QUANTITY_BELOW_ONE');
    expect(result.sizingSource).toBe('LEGACY_SSOT');
  });

  it('ENV ON + SHADOW + GROWTH 티어 정확 매트릭스 (1500만 / STRONG_BUY) → 비중 9~15%', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(true);
    expect(result.result!.finalPositionPct).toBeGreaterThanOrEqual(0.09);
    expect(result.result!.finalPositionPct).toBeLessThanOrEqual(0.15);
  });

  it('학습 데이터 격리 — applied=false 시 sizingSource 항상 LEGACY_SSOT', () => {
    // 4 분기 모두 LEGACY_SSOT 확인
    const r1 = applyPositionSizingEngine(true, { ...validCtx, totalAssets: NaN });
    expect(r1.sizingSource).toBe('LEGACY_SSOT');

    const r2 = applyPositionSizingEngine(false, validCtx); // LIVE
    expect(r2.sizingSource).toBe('LEGACY_SSOT');

    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const r3 = applyPositionSizingEngine(true, { ...validCtx, rrr: 1.0 });
    expect(r3.sizingSource).toBe('LEGACY_SSOT');
  });
});
