/**
 * positionSizingEngineWiringDrawdown.test.ts (ADR-0164)
 *
 * Phase 2-D wiring + peakEquity 영속 통합 회귀.
 * mapToPositionSizingInput 의 peakEquity 입력(여전히 활성·아래 describe 1)
 * + applyPositionSizingEngine gate (Simplification Step 2 로 engine 영구 disable).
 *
 * ── Simplification Step 2 (seed 4452bd3) 후 계약 변경 ──────────────────────────
 * shouldApplyPositionSizingEngine() 가 ENV/모드 무관 항상 false 를 반환한다
 * ("Kelly/probability-based sizing engine is disabled. Callers fall back to the
 * regime-only position policy SSOT" — positionSizingEngineWiring.ts:52~57).
 * 따라서 applyPositionSizingEngine 은 POSITION_SIZING_ENGINE_SHADOW_APPLY='true'
 * 여도 항상 early-return: applied=false / sizingSource='LEGACY_SSOT' /
 * skipReason='ENV_DISABLED'(SHADOW) 이며 peakEquity 자동 갱신 hook(early-return
 * 이후 코드)도 실행되지 않는다.
 *
 * 본 disablement 은 production .ts 코드와 이미-검증된 sibling 테스트
 * (positionSizingEngineWiring.test.ts: "ENV ON + SHADOW → applied=false /
 * skipReason='ENV_DISABLED'", shouldApplyPositionSizingEngine(true)===false)가
 * 동일 SSOT 로 단언하는, 의도된 contract 다. 본 파일의 drawdown-multiplier 활성화
 * 통합 단언은 engine 활성 전제라 disablement 이후 도달 불가 → engine-disabled gate
 * 계약(no peak 갱신·no drawdown 적용)으로 재지정한다. drawdown 산식 자체는
 * computeFinalPosition 단위 테스트 책임이며 본 wiring 게이트의 책임이 아니다.
 * (production 버그 아님 — disablement 이 call-graph 전반 일관, sibling green.)
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

describe('applyPositionSizingEngine — engine disabled gate (Simplification Step 2)', () => {
  // 계약: engine 영구 disable → ENV ON 이어도 early-return, peakEquity 자동 갱신
  // hook(early-return 이후 코드) 미실행. peak 영속은 항상 0 유지(어떤 분기에서도).
  it('ENV ON + 첫 호출 → engine disabled, peak 자동 갱신 미실행 (영속 0 유지)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
    expect(repo.getPeakEquity('SHADOW')).toBe(0); // hook 도달 전 early-return
  });

  it('ENV ON + 사전 영속 peak 존재 → 갱신 후보여도 disabled 라 보존(미갱신)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 12_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx); // totalAssets=15M > peak=12M
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
    expect(repo.getPeakEquity('SHADOW')).toBe(12_000_000); // hook 미실행 → 갱신 안 됨
  });

  it('ENV ON + totalAssets < 영속 peak → 어차피 disabled, 보존', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    wiring.applyPositionSizingEngine(true, validCtx); // totalAssets=15M < peak=20M
    expect(repo.getPeakEquity('SHADOW')).toBe(20_000_000); // 보존
  });

  it('ENV OFF → engine disabled, LEGACY_SSOT fallback (영속 0 유지)', () => {
    // ENV 미설정 — disablement 과 무관하게 동일 결과(ENV 미반영).
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(false);
    expect(result.sizingSource).toBe('LEGACY_SSOT');
    expect(result.skipReason).toBe('ENV_DISABLED');
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
  });

  it('LIVE 모드 → disabled, LIVE 회귀 격리 (peak 미갱신)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    const result = wiring.applyPositionSizingEngine(false, validCtx); // LIVE
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('LIVE_MODE'); // LIVE 분기 사유
    expect(repo.getPeakEquity('SHADOW')).toBe(0); // 미갱신 (LIVE skip)
    expect(repo.getPeakEquity('LIVE')).toBe(0);
  });
});

// ─── drawdown multiplier 통합 검증 — engine disabled 라 도달 불가 ────────────────

describe('drawdown multiplier 게이트 — engine disabled 라 적용 도달 불가 (Simplification Step 2)', () => {
  // engine 활성 전제의 drawdown-multiplier 산식은 disablement 으로 applyPositionSizingEngine
  // 경로에서 도달 불가. 어떤 영속 peak/drawdown 조합이어도 항상 disabled gate 결과.
  it('영속 peak 부재 → applied=false (drawdown 미적용)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
    expect(result.result).toBeUndefined(); // engine 미실행 → result 부재
  });

  it('영속 peak = 16.7M (구 -10%→0.85) → disabled, drawdown 미적용', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 16_700_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
    expect(repo.getPeakEquity('SHADOW')).toBe(16_700_000); // 보존
  });

  it('영속 peak = 18M (구 -16.67%→0.7) → disabled, drawdown 미적용', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 18_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
  });

  it('영속 peak = 21.5M (구 -30%→blocked) → disabled gate (BLOCKED_BY_ENGINE 도달 안 함)', () => {
    process.env.POSITION_SIZING_ENGINE_SHADOW_APPLY = 'true';
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 21_500_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const result = wiring.applyPositionSizingEngine(true, validCtx);
    // engine 비활성 → computeFinalPosition 미도달 → BLOCKED_BY_ENGINE 아닌 ENV_DISABLED.
    expect(result.applied).toBe(false);
    expect(result.skipReason).toBe('ENV_DISABLED');
    expect(result.sizingSource).toBe('LEGACY_SSOT');
  });
});
