// @responsibility Regime Kelly passthrough combiner regression tests (FOMC gating removed).

/**
 * FOMC/R6 게이팅 제거 후의 combineRegimeAndFomcKelly 계약 회귀.
 *
 * 출력 drift 근거 (intent proof — 맹목 갱신 아님):
 *   1. 패치 이력: docs/ai/10-patch-history-index.md `Patch-FOMC-DEAD-CODE-REMOVAL-001 · FOMC, dead-code`.
 *   2. production @responsibility: regimeFomcCombiner.ts L1 "FOMC 게이팅 제거됨 (regime-only)".
 *   3. 본체 (L22~33): regimeKelly 를 그대로 반환, source 는 항상 'REGIME',
 *      fomcKelly/fomcPhase/regime 인자는 시그니처 호환용으로만 보존.
 *   4. 유일 caller dryRunScanner.ts:117 도 항상 'NORMAL' phase + fomcKelly 1.0 전달
 *      ("VIX/FOMC 게이팅 제거됨" 주석) — FOMC override 경로가 production 에서 dead.
 *
 * 따라서 구 v3 계약(R6_DEFENSE→REGIME_ADJUSTMENT_ONLY, PRE/POST→FOMC source,
 * FOMC_REGIME_OVERRIDE_DISABLED→LEGACY_PRODUCT) 단언은 제거된 동작이므로
 * 현행 passthrough 계약을 검증하도록 정정한다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  combineRegimeAndFomcKelly,
  describeRegimeFomcCombination,
} from './regimeFomcCombiner.js';

describe('combineRegimeAndFomcKelly — regime-only passthrough (FOMC 게이팅 제거됨)', () => {
  const originalEnv = process.env.FOMC_REGIME_OVERRIDE_DISABLED;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FOMC_REGIME_OVERRIDE_DISABLED;
    else process.env.FOMC_REGIME_OVERRIDE_DISABLED = originalEnv;
  });

  it('R6_DEFENSE 도 regimeKelly 를 그대로 통과 (FOMC override 제거 후 REGIME)', () => {
    const r = combineRegimeAndFomcKelly(0.3, 1.0, 'NORMAL', 'R6_DEFENSE');

    expect(r.value).toBe(0.3);
    expect(r.source).toBe('REGIME');
    expect(r.reason).toContain('R6_DEFENSE');
    // 게이팅 제거 사실이 진단 reason 에 노출됨 (운영자 가시성).
    expect(r.reason).toContain('FOMC/VIX 게이팅 제거됨');
  });

  it('PRE_1/POST_1 phase 여도 fomcKelly 를 무시하고 regimeKelly 통과 (override 제거)', () => {
    const pre = combineRegimeAndFomcKelly(0.3, 0.75, 'PRE_1', 'R6_DEFENSE');
    const post = combineRegimeAndFomcKelly(0.3, 1.30, 'POST_1', 'R6_DEFENSE');

    // fomcKelly(0.75/1.30) 는 더 이상 채택되지 않음 — regimeKelly(0.3) 통과.
    expect(pre).toMatchObject({ value: 0.3, source: 'REGIME' });
    expect(post).toMatchObject({ value: 0.3, source: 'REGIME' });
  });

  it('NORMAL phase 면 regimeKelly 통과 (변동 없음)', () => {
    const r = combineRegimeAndFomcKelly(0.8, 1.0, 'NORMAL', 'R2_BULL');

    expect(r.value).toBe(0.8);
    expect(r.source).toBe('REGIME');
  });

  it('FOMC active(PRE_1) phase + 비-R6 레짐이어도 regimeKelly 통과 (FOMC 미채택)', () => {
    const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');

    // 구 계약: 0.75/FOMC. 현행(제거 후): 0.8/REGIME.
    expect(r.value).toBe(0.8);
    expect(r.source).toBe('REGIME');
  });

  it('FOMC_REGIME_OVERRIDE_DISABLED rollback env 도 동작 변화 없음 (override 자체가 제거됨)', () => {
    process.env.FOMC_REGIME_OVERRIDE_DISABLED = 'true';
    const r = combineRegimeAndFomcKelly(0.8, 0.75, 'PRE_1', 'R2_BULL');

    // 구 계약: legacy product 0.6/LEGACY_PRODUCT. 현행: env 무시, regimeKelly passthrough.
    expect(r.value).toBe(0.8);
    expect(r.source).toBe('REGIME');
  });
});

describe('describeRegimeFomcCombination — passthrough 진단 라인', () => {
  it('R6_DEFENSE 를 매수 차단이 아닌 regime 통과로 렌더 (게이팅 제거 노출)', () => {
    const r = combineRegimeAndFomcKelly(0.3, 1.0, 'NORMAL', 'R6_DEFENSE');
    const desc = describeRegimeFomcCombination(r);

    expect(desc).toContain('R6_DEFENSE');
    expect(desc).toContain('FOMC/VIX 게이팅 제거됨');
    expect(desc).toContain('×0.30');
    // R6 가 매수 차단으로 표기되면 안 됨 (제거 후 adjustment-only 도 아닌 단순 passthrough).
    expect(desc).not.toContain('매수 차단');
  });
});
