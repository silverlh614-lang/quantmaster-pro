// @responsibility ADR-0584 — detectVkospiFlatDuringMove 진리표 + flag + classifyVkospiFreshness 회귀.
import { describe, it, expect, afterEach } from 'vitest';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import {
  detectVkospiFlatDuringMove,
  isVkospiStaleGuardEnabled,
  isVkospiFetchCorrectionEnabled,
  classifyVkospiFreshness,
} from './vkospiFreshness.js';

const ms = (o: Partial<MacroState>): MacroState => o as MacroState;

const ENV_KEYS = ['VKOSPI_STALE_GUARD_ENABLED', 'VKOSPI_FETCH_CORRECTION_ENABLED', 'VKOSPI_STALE_MOVE_PCT', 'VKOSPI_STALE_FLAT_EPS'];
const ORIG: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIG[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

describe('detectVkospiFlatDuringMove (ADR-0584)', () => {
  it('실측 stale 케이스: KOSPI -5.54% 인데 VKOSPI 변화 0.00 → flat=true', () => {
    const r = detectVkospiFlatDuringMove(ms({ kospiCloseReturn: -5.54, kospiDayReturn: -5.54, vkospiDayChange: 0.0 }));
    expect(r.flat).toBe(true);
  });

  it('진짜 폭락 spike: KOSPI -5.54% + VKOSPI +18 → flat=false (마스킹 안 함)', () => {
    const r = detectVkospiFlatDuringMove(ms({ kospiDayReturn: -5.54, vkospiDayChange: 18.0 }));
    expect(r.flat).toBe(false);
  });

  it('소폭 변동: KOSPI -1.0% + VKOSPI 0 → flat=false (move 임계 미만)', () => {
    const r = detectVkospiFlatDuringMove(ms({ kospiDayReturn: -1.0, vkospiDayChange: 0.0 }));
    expect(r.flat).toBe(false);
  });

  it('vkospiDayChange 부재 → flat=false (판정 불가는 안전하게 미발동)', () => {
    const r = detectVkospiFlatDuringMove(ms({ kospiDayReturn: -5.54 }));
    expect(r.flat).toBe(false);
  });

  it('kospiCloseReturn 우선(없으면 kospiDayReturn)', () => {
    const r = detectVkospiFlatDuringMove(ms({ kospiCloseReturn: -6.0, kospiDayReturn: 0.1, vkospiDayChange: 0.0 }));
    expect(r.kospiMovePct).toBe(-6.0);
    expect(r.flat).toBe(true);
  });

  it('env 임계 튜닝 적용 (MOVE_PCT=10 → -5.54 는 미달)', () => {
    process.env.VKOSPI_STALE_MOVE_PCT = '10';
    const r = detectVkospiFlatDuringMove(ms({ kospiDayReturn: -5.54, vkospiDayChange: 0.0 }));
    expect(r.flat).toBe(false);
  });
});

describe('isVkospiStaleGuardEnabled — default OFF (ADR-0584)', () => {
  it('미설정 → false', () => {
    delete process.env.VKOSPI_STALE_GUARD_ENABLED;
    expect(isVkospiStaleGuardEnabled()).toBe(false);
  });
  it("'false'/임의값 → false", () => {
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'false';
    expect(isVkospiStaleGuardEnabled()).toBe(false);
    process.env.VKOSPI_STALE_GUARD_ENABLED = '1';
    expect(isVkospiStaleGuardEnabled()).toBe(false);
  });
  it("'true' → true", () => {
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'true';
    expect(isVkospiStaleGuardEnabled()).toBe(true);
  });
});

describe('isVkospiFetchCorrectionEnabled — default OFF, 격리 flag와 독립 (ADR-0585)', () => {
  it('미설정/임의값 → false', () => {
    delete process.env.VKOSPI_FETCH_CORRECTION_ENABLED;
    expect(isVkospiFetchCorrectionEnabled()).toBe(false);
    process.env.VKOSPI_FETCH_CORRECTION_ENABLED = 'yes';
    expect(isVkospiFetchCorrectionEnabled()).toBe(false);
  });
  it("'true' → true", () => {
    process.env.VKOSPI_FETCH_CORRECTION_ENABLED = 'true';
    expect(isVkospiFetchCorrectionEnabled()).toBe(true);
  });
  it('STALE_GUARD 와 독립 (한쪽만 켜도 서로 영향 없음)', () => {
    process.env.VKOSPI_STALE_GUARD_ENABLED = 'true';
    delete process.env.VKOSPI_FETCH_CORRECTION_ENABLED;
    expect(isVkospiStaleGuardEnabled()).toBe(true);
    expect(isVkospiFetchCorrectionEnabled()).toBe(false);
  });
});

describe('classifyVkospiFreshness (ADR-0584)', () => {
  it('flat-during-move → stale=true + reason + baseDate/fetchedAt 패스스루', () => {
    const v = classifyVkospiFreshness(ms({
      kospiDayReturn: -5.54, vkospiDayChange: 0.0,
      vkospiBaseDate: '20260605', vkospiFetchedAt: '2026-06-07T08:20:00Z',
    }));
    expect(v.stale).toBe(true);
    expect(v.reasons).toContain('FLAT_DURING_KOSPI_MOVE');
    expect(v.baseDate).toBe('20260605');
    expect(v.fetchedAt).toBe('2026-06-07T08:20:00Z');
  });

  it('정상(변동성 반응) → stale=false', () => {
    const v = classifyVkospiFreshness(ms({ kospiDayReturn: -5.54, vkospiDayChange: 18.0 }));
    expect(v.stale).toBe(false);
    expect(v.reasons).toEqual([]);
  });
});
