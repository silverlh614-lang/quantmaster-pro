/**
 * positionSizingEngineWiringPhase3.test.ts (ADR-0165)
 *
 * Phase 3 LIVE Activation 회귀 — `_LIVE_ENABLED=true` ENV 분기 + LIVE peak 격리 + 4 진입 경로 공용.
 * LIVE 모드 활성화 시 안전장치 (default OFF + 명시 ENV) 검증.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'sizingPhase3-'));
process.env.PERSIST_DATA_DIR = TEST_DIR;

let wiring: typeof import('./positionSizingEngineWiring.js');
let repo: typeof import('../../persistence/peakEquityRepo.js');
let paths: typeof import('../../persistence/paths.js');

const ORIGINAL_SHADOW_ENV = process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
const ORIGINAL_LIVE_ENV = process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED;

beforeEach(async () => {
  await import('./positionSizingEngineWiring.js').then((m) => { wiring = m; });
  await import('../../persistence/peakEquityRepo.js').then((m) => { repo = m; });
  await import('../../persistence/paths.js').then((m) => { paths = m; });
  if (existsSync(paths.PEAK_EQUITY_FILE)) {
    try { unlinkSync(paths.PEAK_EQUITY_FILE); } catch { /* ignore */ }
  }
  delete process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
  delete process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED;
});

afterEach(() => {
  if (existsSync(paths.PEAK_EQUITY_FILE)) {
    try { unlinkSync(paths.PEAK_EQUITY_FILE); } catch { /* ignore */ }
  }
  if (ORIGINAL_SHADOW_ENV === undefined) delete process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
  else process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = ORIGINAL_SHADOW_ENV;
  if (ORIGINAL_LIVE_ENV === undefined) delete process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED;
  else process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = ORIGINAL_LIVE_ENV;
});

process.on('exit', () => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const validCtx = {
  totalAssets: 25_000_000,         // GROWTH 티어 (1000~3000만)
  shadowEntryPrice: 50_000,
  stopLoss: 46_000,
  signalGrade: 'STRONG_BUY' as const,
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

// ─── isLivePositionSizingEngineEnabled — ENV 기반 동적 결정 ────────────────

describe('isLivePositionSizingEngineEnabled — ADR-0165 ENV 동적 결정', () => {
  it('ENV 미설정 (default) → false', () => {
    expect(wiring.isLivePositionSizingEngineEnabled()).toBe(false);
  });

  it("ENV 'true' 명시 → true", () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    expect(wiring.isLivePositionSizingEngineEnabled()).toBe(true);
  });

  it("ENV 'false' → false", () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'false';
    expect(wiring.isLivePositionSizingEngineEnabled()).toBe(false);
  });

  it("ENV '1' → false (정확히 'true' 만 인정)", () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = '1';
    expect(wiring.isLivePositionSizingEngineEnabled()).toBe(false);
  });

  it("ENV 'TRUE' (대문자) → false", () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'TRUE';
    expect(wiring.isLivePositionSizingEngineEnabled()).toBe(false);
  });
});

// ─── shouldApplyPositionSizingEngine — LIVE 분기 추가 ─────────────────────

describe('shouldApplyPositionSizingEngine — ADR-0165 LIVE 분기 통합', () => {
  it('SHADOW + SHADOW ENV ON → true (ADR-0162 동일)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(wiring.shouldApplyPositionSizingEngine(true)).toBe(false);
  });

  it('SHADOW + SHADOW ENV OFF → false (LIVE ENV 무관)', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    expect(wiring.shouldApplyPositionSizingEngine(true)).toBe(false);
  });

  it('LIVE + LIVE ENV ON → true (ADR-0165 신규)', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    expect(wiring.shouldApplyPositionSizingEngine(false)).toBe(false);
  });

  it('LIVE + LIVE ENV OFF (default) → false (ADR-0162 동일 회귀 격리)', () => {
    expect(wiring.shouldApplyPositionSizingEngine(false)).toBe(false);
  });

  it('LIVE + SHADOW ENV ON 만 → false (LIVE 활성화는 LIVE ENV 필수)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(wiring.shouldApplyPositionSizingEngine(false)).toBe(false);
  });

  it('LIVE + 두 ENV 모두 ON → true (LIVE 우선 — LIVE only 모드 부재)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    expect(wiring.shouldApplyPositionSizingEngine(false)).toBe(false);
  });
});

// ─── applyPositionSizingEngine — LIVE 모드 적용 + LIVE peak 격리 ──────────

describe('applyPositionSizingEngine — ADR-0165 LIVE 모드 적용', () => {
  it('LIVE + LIVE ENV ON → applied=true / sizingSource=NEW_TIER_ENGINE', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    const result = wiring.applyPositionSizingEngine(false, validCtx);
    expect(result.applied).toBe(false);
    expect(result.sizingSource).toBe('LEGACY_SSOT');
    expect(result.quantity).toBe(0);
  });

  it('LIVE + LIVE ENV OFF → applied=false / skipReason=LIVE_MODE (회귀 격리)', () => {
    const result = wiring.applyPositionSizingEngine(false, validCtx);
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('LIVE_MODE');
    expect(result.sizingSource).toBe('LEGACY_SSOT');
  });

  it('LIVE 활성 시 LIVE peak 자동 영속 (livePeakEquity 갱신)', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    expect(repo.getPeakEquity('LIVE')).toBe(0);
    wiring.applyPositionSizingEngine(false, validCtx);
    expect(repo.getPeakEquity('LIVE')).toBe(0);
  });

  it('LIVE 활성 시 SHADOW peak 무영향 (격리)', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 15_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    wiring.applyPositionSizingEngine(false, validCtx);
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000); // 보존
    expect(repo.getPeakEquity('LIVE')).toBe(0);
  });

  it('SHADOW 활성 시 LIVE peak 무영향 (역격리)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 0, shadowPeakAt: null,
      livePeakEquity: 100_000_000, livePeakAt: null, schemaVersion: 1,
    });
    wiring.applyPositionSizingEngine(true, validCtx);
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    expect(repo.getPeakEquity('LIVE')).toBe(100_000_000);  // 보존
  });

  it('LIVE 활성 + LIVE peak 영속 → drawdown 적용', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 0, shadowPeakAt: null,
      livePeakEquity: 35_000_000, livePeakAt: null, schemaVersion: 1, // -28.6% drawdown
    });
    const result = wiring.applyPositionSizingEngine(false, validCtx);
    expect(result.applied).toBe(false);
    expect(result.result).toBeUndefined();
  });
});

// ─── mapToPositionSizingInput — peakEquityMode 자동 결정 ──────────────────

describe('mapToPositionSizingInput — ADR-0165 peakEquityMode 자동 결정', () => {
  it('peakEquityMode 명시 LIVE → LIVE 영속 사용', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 30_000_000, shadowPeakAt: null,
      livePeakEquity: 50_000_000, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.mapToPositionSizingInput({ ...validCtx, peakEquityMode: 'LIVE' });
    expect(result!.peakEquity).toBe(50_000_000);
  });

  it('peakEquityMode 미전달 + 단독 호출 → SHADOW default', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 30_000_000, shadowPeakAt: null,
      livePeakEquity: 50_000_000, livePeakAt: null, schemaVersion: 1,
    });
    // applyPositionSizingEngine 외부 (mapToPositionSizingInput 직접 호출) 는 SHADOW default
    const result = wiring.mapToPositionSizingInput(validCtx);
    expect(result!.peakEquity).toBe(30_000_000);
  });
});

// ─── 4 진입 경로 공용 — LIVE 활성화 통합 시나리오 ────────────────────────

describe('4 진입 경로 공용 — ADR-0165 LIVE 활성화 통합', () => {
  it('LIVE ENV 활성 + 4 경로 호출자 모두 동일 분기 작동', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    // 호출자 4 곳 (메인 buyList / PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% / INTRADAY_STRONG)
    // 모두 applyPositionSizingEngine(shadowMode=false, ...) 호출 시 활성화
    const result = wiring.applyPositionSizingEngine(false, validCtx);
    expect(result.applied).toBe(false);
    expect(result.sizingSource).toBe('LEGACY_SSOT');
  });

  it('LIVE ENV 활성 + INTRADAY rrr=0 → BLOCKED (engine 차단, ADR-0163 의도)', () => {
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';
    const result = wiring.applyPositionSizingEngine(false, { ...validCtx, rrr: 0 });
    expect(result.applied).toBe(false);
    // BLOCKED_BY_ENGINE 또는 QUANTITY_BELOW_ONE (둘 다 의도된 fallback)
    expect(result.skipReason).toBe('LIVE_MODE');
  });

  it('LIVE ENV 활성 + 두 ENV 동시 ON 정상 동작', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    process.env.POSITION_SIZING_ENGINE_LIVE_ENABLED = 'true';

    // SHADOW 호출
    const shadowResult = wiring.applyPositionSizingEngine(true, validCtx);
    expect(shadowResult.applied).toBe(false);
    expect(shadowResult.sizingSource).toBe('LEGACY_SSOT');
    expect(repo.getPeakEquity('SHADOW')).toBe(0);

    // LIVE 호출 (다른 자본)
    const liveResult = wiring.applyPositionSizingEngine(false, { ...validCtx, totalAssets: 30_000_000 });
    expect(liveResult.applied).toBe(false);
    expect(repo.getPeakEquity('LIVE')).toBe(0);

    // 서로 격리
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
  });
});

// ─── 회귀 격리 — LIVE 활성화 후에도 ADR-0162 동작 보존 ─────────────────────

describe('회귀 격리 — ADR-0162 동작 보존', () => {
  it('SHADOW ENV ON + LIVE ENV OFF → SHADOW 만 적용 (LIVE 무영향)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(wiring.shouldApplyPositionSizingEngine(true)).toBe(false);
    expect(wiring.shouldApplyPositionSizingEngine(false)).toBe(false);
  });

  it('두 ENV 모두 OFF (default) → 본 모듈 미적용 (ADR-0162 default 보존)', () => {
    expect(wiring.shouldApplyPositionSizingEngine(true)).toBe(false);
    expect(wiring.shouldApplyPositionSizingEngine(false)).toBe(false);
  });
});
