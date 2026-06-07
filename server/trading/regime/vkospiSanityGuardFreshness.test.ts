// @responsibility ADR-0584 — vkospiSanityGuard flat-during-move 격리(flag-gated, default OFF byte-identical) 회귀.
import { describe, it, expect, afterEach } from 'vitest';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import { classifyVkospiSanity } from './vkospiSanityGuard.js';

const ms = (o: Partial<MacroState>): MacroState => o as MacroState;

const ENV_KEYS = ['VKOSPI_STALE_GUARD_ENABLED', 'VKOSPI_SANITY_GUARD_DISABLED', 'VKOSPI_VIX_DIVERGENCE_CAP', 'VKOSPI_GUARD_KOSPI_FLOOR'];
const ORIG: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIG[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

// 실측 시나리오: KOSPI -5.54% 폭락일에 VKOSPI 73.4 가 flat(변화 0.00) = frozen/stale.
// ADR-0530 클래식 가드는 G2(KOSPI 비스트레스)가 false 라 미발동 → 폭락일에 stale-high 통과하던 갭.
const CRASH_FLAT = (): MacroState => ms({
  vkospi: 73.4, vix: 16.1,
  kospiCloseReturn: -5.54, kospiDayReturn: -5.54, kospiIntradayLowReturn: -6.96,
  vkospiDayChange: 0.0,
});

describe('vkospiSanityGuard — flat-during-move 격리 (ADR-0584)', () => {
  it('flag OFF(default) + 폭락일 flat → 격리 안 됨 (byte-identical: classic 가드 G2 false)', () => {
    delete process.env.VKOSPI_STALE_GUARD_ENABLED;
    const v = classifyVkospiSanity(CRASH_FLAT());
    expect(v.trustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(v.guardTriggered).toBe(false);
    expect(v.reasons).not.toContain('VKOSPI_STALE_FLAT_DURING_MOVE');
  });

  it('flag ON + 폭락일 flat → UNTRUSTED_IMPLAUSIBLE 격리 (G2 무관)', () => {
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'true';
    const v = classifyVkospiSanity(CRASH_FLAT());
    expect(v.trustState).toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(v.guardTriggered).toBe(true);
    expect(v.reasons).toContain('VKOSPI_STALE_FLAT_DURING_MOVE');
    expect(v.marketSignal).toBe(false); // 불변식 #6: provider 이슈, market signal 아님
  });

  it('flag ON + 진짜 폭락 spike(VKOSPI +18) → 격리 안 함 (flat=false, 오진 방지)', () => {
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'true';
    const v = classifyVkospiSanity(ms({
      vkospi: 35, vix: 16.1, kospiCloseReturn: -5.54, kospiDayReturn: -5.54,
      kospiIntradayLowReturn: -6.96, vkospiDayChange: 18.0,
    }));
    expect(v.trustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
    expect(v.reasons).not.toContain('VKOSPI_STALE_FLAT_DURING_MOVE');
  });

  it('클래식 VIX 괴리(평온 KOSPI) → flag 무관 IMPLAUSIBLE 유지 (ADR-0530 회귀)', () => {
    const calmDivergent = (): MacroState => ms({
      vkospi: 73, vix: 16, kospiCloseReturn: 0.5, kospiDayReturn: 0.5,
      kospiIntradayLowReturn: -0.5, vkospiDayChange: 0.0,
    });
    delete process.env.VKOSPI_STALE_GUARD_ENABLED;
    expect(classifyVkospiSanity(calmDivergent()).trustState).toBe('UNTRUSTED_IMPLAUSIBLE');
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'true';
    expect(classifyVkospiSanity(calmDivergent()).trustState).toBe('UNTRUSTED_IMPLAUSIBLE');
  });

  it('kill-switch VKOSPI_SANITY_GUARD_DISABLED=true → flag ON 이어도 미발동', () => {
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'true';
    process.env.VKOSPI_SANITY_GUARD_DISABLED = 'true';
    const v = classifyVkospiSanity(CRASH_FLAT());
    expect(v.guardTriggered).toBe(false);
    expect(v.trustState).not.toBe('UNTRUSTED_IMPLAUSIBLE');
  });
});
