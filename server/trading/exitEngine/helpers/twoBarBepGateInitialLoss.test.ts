// @responsibility ADR-0625 손실초기 손절 2-bar 확대 게이트 회귀 — ENV OFF byte-equiv / LIVE 보존 / SHADOW confirm / 깊은하락 우회 / 결정트리
/**
 * twoBarBepGateInitialLoss.test.ts — ADR-0625 INITIAL_LOSS 2-bar 확대 (shadow-only) 회귀.
 *
 * 기존 BEP 경로(twoBarBepGate.test.ts)는 무회귀 — 본 파일은 신규 확대 게이트만 검증.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeMockShadow } from '../rules/__tests__/_testHelpers.js';

vi.mock('../../../state.js', () => ({
  getTradingMode: vi.fn(() => 'SHADOW'),
}));
vi.mock('../helpers/ma60.js', () => ({
  kstBusinessDateStr: vi.fn(() => '2026-05-01'),
}));

const {
  applyTwoBarBepGate,
  isInitialLossTwoBarShadowEnabled,
  SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT,
} = await import('./twoBarBepGate.js');
const { getTradingMode } = await import('../../../state.js');
const { kstBusinessDateStr } = await import('../helpers/ma60.js');

const ENV = 'SHAKEOUT_INITIAL_LOSS_TWOBAR_SHADOW_ENABLED';

describe('twoBarBepGate INITIAL_LOSS 확대 (ADR-0625)', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.BEP_PROTECTION_DISABLED;
    delete process.env.BEP_TWO_BAR_LIVE_ENABLED;
    delete process.env.BEP_TWO_BAR_CONFIRMATION_DISABLED;
    delete process.env[ENV];
    (getTradingMode as any).mockReturnValue('SHADOW');
    (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.clearAllMocks();
  });

  // 손실초기 손절 입력 (isBepProtection=false, stopLossExitType=INITIAL, 얕은하락 -5%).
  function initialLossInput(over: Record<string, unknown> = {}) {
    return {
      shadow: makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: undefined }),
      currentPrice: 89,
      hardStopLoss: 90,
      isBepProtection: false,
      stopLossExitType: 'INITIAL' as const,
      returnPct: -5,
      ...over,
    };
  }

  it('상수/ENV SSOT 정합', () => {
    expect(SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT).toBe(-12.0);
    expect(isInitialLossTwoBarShadowEnabled()).toBe(false); // default OFF
    process.env[ENV] = 'true';
    expect(isInitialLossTwoBarShadowEnabled()).toBe(true);
    process.env[ENV] = '1';
    expect(isInitialLossTwoBarShadowEnabled()).toBe(false); // 정확 비교
  });

  it('twobar_envOff_byteequiv: ENV OFF → SHADOW·LIVE 모두 SKIP (즉시손절 byte-equiv)', () => {
    // SHADOW
    (getTradingMode as any).mockReturnValue('SHADOW');
    const rShadow = applyTwoBarBepGate(initialLossInput());
    expect(rShadow.action).toBe('SKIP');
    expect(rShadow.reason).toContain('즉시 청산 위임');
    // LIVE
    (getTradingMode as any).mockReturnValue('LIVE');
    const rLive = applyTwoBarBepGate(initialLossInput());
    expect(rLive.action).toBe('SKIP');
  });

  it('twobar_live_preserved: ENV ON + LIVE + INITIAL → SKIP (즉시손절·byte-identical)', () => {
    process.env[ENV] = 'true';
    (getTradingMode as any).mockReturnValue('LIVE');
    const r = applyTwoBarBepGate(initialLossInput());
    expect(r.action).toBe('SKIP'); // LIVE 절대 우회 금지 (조건 b)
  });

  it('twobar_shadow_confirm: ENV ON + SHADOW + INITIAL + -5% (얕은) + 1차터치 → WAIT (영속)', () => {
    process.env[ENV] = 'true';
    (getTradingMode as any).mockReturnValue('SHADOW');
    const r = applyTwoBarBepGate(initialLossInput());
    expect(r.action).toBe('WAIT');
    expect(r.shadowUpdate).toEqual({ bepGlideTouchAt: '2026-05-01' });
  });

  it('twobar_shadow_2bar_exit: 1차터치 다음 영업일 재미달 → CONTINUE_EXIT', () => {
    process.env[ENV] = 'true';
    (getTradingMode as any).mockReturnValue('SHADOW');
    (kstBusinessDateStr as any).mockReturnValue('2026-05-01');
    const r = applyTwoBarBepGate(
      initialLossInput({
        shadow: makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: '2026-04-30' }),
      }),
    );
    expect(r.action).toBe('CONTINUE_EXIT');
  });

  it('twobar_deep_drop_bypass: ENV ON + SHADOW + INITIAL + -15% (≤-12%) → SKIP (즉시손절 우회)', () => {
    process.env[ENV] = 'true';
    (getTradingMode as any).mockReturnValue('SHADOW');
    const r = applyTwoBarBepGate(initialLossInput({ returnPct: -15 }));
    expect(r.action).toBe('SKIP');
  });

  it('twobar_recovery_reset: SHADOW + currentPrice>stopLoss → RESET (터치 초기화·청산 미수행)', () => {
    process.env[ENV] = 'true';
    (getTradingMode as any).mockReturnValue('SHADOW');
    const r = applyTwoBarBepGate(
      initialLossInput({
        currentPrice: 95, // > 90 stopLoss → 회복
        returnPct: -5,
        shadow: makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: '2026-04-30' }),
      }),
    );
    expect(r.action).toBe('RESET');
    expect(r.shadowUpdate).toEqual({ bepGlideTouchAt: undefined });
  });

  it('twobar_bep_path_preserved: PROFIT_PROTECTION → 기존 BEP 경로 (확대 게이트 무관)', () => {
    // ENV OFF 라도 isBepProtection=true 면 기존 BEP 2-bar 경로 작동 (회귀 보존).
    (getTradingMode as any).mockReturnValue('SHADOW');
    const r = applyTwoBarBepGate({
      shadow: makeMockShadow({ shadowEntryPrice: 100, bepGlideTouchAt: undefined }),
      currentPrice: 89,
      hardStopLoss: 90,
      isBepProtection: true,
      stopLossExitType: 'PROFIT_PROTECTION',
      returnPct: 2,
    });
    expect(r.action).toBe('WAIT'); // 기존 BEP 1차 터치
  });

  it('twobar_decision_tree: stopLossExitType × ENV × mode 매트릭스 분기 정합', () => {
    process.env[ENV] = 'true';
    (getTradingMode as any).mockReturnValue('SHADOW');

    // REGIME 얕은하락 → WAIT (확대 적용)
    expect(applyTwoBarBepGate(initialLossInput({ stopLossExitType: 'REGIME' })).action).toBe('WAIT');
    // INITIAL_AND_REGIME 얕은하락 → WAIT
    expect(
      applyTwoBarBepGate(initialLossInput({ stopLossExitType: 'INITIAL_AND_REGIME' })).action,
    ).toBe('WAIT');
    // returnPct 부재 → 보수적 SKIP (즉시손절)
    expect(applyTwoBarBepGate(initialLossInput({ returnPct: undefined })).action).toBe('SKIP');
    // PAPER 모드 (LIVE 아님) → 확대 적용 (WAIT)
    (getTradingMode as any).mockReturnValue('PAPER');
    expect(applyTwoBarBepGate(initialLossInput()).action).toBe('WAIT');
  });
});
