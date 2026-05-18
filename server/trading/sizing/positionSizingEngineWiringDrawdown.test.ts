/**
 * positionSizingEngineWiringDrawdown.test.ts (ADR-0164)
 *
 * Phase 2-D wiring + peakEquity 영속 통합 회귀 — drawdown multiplier 활성화 검증.
 * mapToPositionSizingInput 의 peakEquity 입력 + applyPositionSizingEngine 의 자동 갱신 hook.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = mkdtempSync(join(tmpdir(), 'sizingDrawdown-'));
process.env.PERSIST_DATA_DIR = TEST_DIR;

let wiring: typeof import('./positionSizingEngineWiring.js');
let repo: typeof import('../../persistence/peakEquityRepo.js');
let paths: typeof import('../../persistence/paths.js');

const ORIGINAL_ENV = process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;

beforeEach(async () => {
  await import('./positionSizingEngineWiring.js').then((m) => { wiring = m; });
  await import('../../persistence/peakEquityRepo.js').then((m) => { repo = m; });
  await import('../../persistence/paths.js').then((m) => { paths = m; });
  if (existsSync(paths.PEAK_EQUITY_FILE)) {
    try { unlinkSync(paths.PEAK_EQUITY_FILE); } catch { /* ignore */ }
  }
  delete process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
});

afterEach(() => {
  if (existsSync(paths.PEAK_EQUITY_FILE)) {
    try { unlinkSync(paths.PEAK_EQUITY_FILE); } catch { /* ignore */ }
  }
  if (ORIGINAL_ENV === undefined) delete process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY;
  else process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = ORIGINAL_ENV;
});

process.on('exit', () => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const validCtx = {
  totalAssets: 15_000_000,
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

// ─── mapToPositionSizingInput peakEquity 입력 ────────────────────────────

describe('mapToPositionSizingInput — peakEquity 입력 (ADR-0164)', () => {
  it('영속 부재 → peakEquity = totalAssets fallback (drawdown 0)', () => {
    const result = wiring.mapToPositionSizingInput(validCtx);
    expect(result).not.toBeNull();
    expect(result!.peakEquity).toBe(validCtx.totalAssets);
    expect(result!.accountEquity).toBe(validCtx.totalAssets);
  });

  it('SHADOW 영속 존재 → peakEquity = 영속값 (drawdown 활성화)', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000,
      shadowPeakAt: '2026-05-01T00:00:00Z',
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.mapToPositionSizingInput(validCtx);
    expect(result!.peakEquity).toBe(20_000_000);
    expect(result!.accountEquity).toBe(15_000_000);
    // drawdown = (15M - 20M) / 20M = -25%
  });

  it('peakEquityMode=LIVE 명시 → LIVE 영속값 사용', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: null,
      livePeakEquity: 100_000_000, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.mapToPositionSizingInput({ ...validCtx, peakEquityMode: 'LIVE' });
    expect(result!.peakEquity).toBe(100_000_000);
  });

  it('peakEquityMode 미전달 → SHADOW default', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: null,
      livePeakEquity: 100_000_000, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.mapToPositionSizingInput(validCtx);
    expect(result!.peakEquity).toBe(20_000_000); // SHADOW
  });
});

// ─── applyPositionSizingEngine 자동 갱신 hook ──────────────────────────────

describe('applyPositionSizingEngine — peakEquity 자동 갱신 hook (ADR-0164)', () => {
  it('ENV ON + 첫 호출 → peak 자동 영속 (totalAssets 갱신)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    wiring.applyPositionSizingEngine(true, validCtx);
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000); // 자동 갱신
  });

  it('ENV ON + totalAssets > 영속 peak → 갱신', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 12_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    wiring.applyPositionSizingEngine(true, validCtx); // totalAssets=15M > peak=12M
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000);
  });

  it('ENV ON + totalAssets < 영속 peak → no-op (drawdown 보존)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    wiring.applyPositionSizingEngine(true, validCtx); // totalAssets=15M < peak=20M
    expect(repo.getPeakEquity('SHADOW')).toBe(20_000_000); // 보존
  });

  it('ENV OFF → 자동 갱신 hook 미실행 (영속 0 유지)', () => {
    // ENV 미설정
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.sizingSource).toBe('LIVE_SIZING_MIRROR');
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000);
  });

  it('LIVE 모드 → 자동 갱신 hook 미실행 (LIVE 회귀 격리)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    wiring.applyPositionSizingEngine(false, validCtx); // LIVE
    expect(repo.getPeakEquity('SHADOW')).toBe(0); // 미갱신 (LIVE skip)
    expect(repo.getPeakEquity('LIVE')).toBe(0);
  });
});

// ─── drawdown multiplier 활성화 통합 검증 ──────────────────────────────────

describe('drawdown multiplier 활성화 통합 검증 (ADR-0164)', () => {
  it('영속 peak 부재 → drawdownMultiplier=1.0 (drawdown 0)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(true);
    expect(result.result!.drawdownMultiplier).toBe(1.0);
  });

  it('영속 peak = 16.7M, current = 15M → drawdown=-10% → multiplier=0.85', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    // 사전 영속 (자동 갱신 전)
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 16_700_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(true);
    expect(result.result!.drawdownMultiplier).toBe(0.85);
    // peak 자동 갱신 안 됨 (15M < 16.7M)
    expect(repo.getPeakEquity('SHADOW')).toBe(16_700_000);
  });

  it('영속 peak = 18M, current = 15M → drawdown=-16.67% → multiplier=0.7', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 18_000_000, shadowPeakAt: null, // -16.67% drawdown (-15% boundary 명확 통과)
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(true);
    expect(result.result!.drawdownMultiplier).toBe(0.7);
  });

  it('영속 peak = 21.5M, current = 15M → drawdown=-30% → blocked (multiplier=0)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 21_500_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    // drawdown <= -30% → engine blocked → applied=false (BLOCKED_BY_ENGINE)
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('BLOCKED_BY_ENGINE');
    expect(result.sizingSource).toBe('LEGACY_SSOT');
  });
});
