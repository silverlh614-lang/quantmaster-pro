// @responsibility PRE_OPEN KIS fallback guard 회귀 테스트
import { describe, expect, it } from 'vitest';
import {
  evaluateKisChartFallbackAllowed,
  formatPreopenKisFallbackSkippedLog,
  isKisChartFallbackAllowed,
} from './kisChartFallbackGuard.js';

const kst = (hhmm: string) => new Date(`2026-05-14T${hhmm}:00+09:00`);

describe('PRE_OPEN KIS chart/current-price fallback guard', () => {
  it('A. 08:35 PRE_OPEN Stage1/FinalScreen 신규 후보 fallback 차단 + 오염 없음', () => {
    const decision = evaluateKisChartFallbackAllowed(kst('08:35'), 'FINAL_SCREEN_FALLBACK');
    expect(decision.allowed).toBe(false);
    expect(decision.session).toBe('PRE_OPEN');
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.marketSignal).toBe(false);
    expect(decision.dataVacuum).toBe(false);
    expect(decision.newBuyBlocked).toBe(false);
    expect(decision.generalBuyBlocked).toBe(false);
    expect(decision.shadowLearning).toBe(true);
    expect(decision.engineAlive).toBe(true);
    expect(decision.evaluationState).toBe('NOT_EVALUATED_PREOPEN_KIS_GUARD');
    expect(decision.sourcePath).toBe('KRX_CACHE_ONLY_PREOPEN');

    const log = formatPreopenKisFallbackSkippedLog({ stage: 'Stage1' });
    expect(log).toContain('[PREOPEN_KIS_FALLBACK_SKIPPED]');
    expect(log).toContain('fallback=KRX_CACHE_ONLY');
    expect(log).toContain('executionImpact=NONE');
    expect(log).toContain('marketSignal=false');
  });

  it('B. 10:00 REGULAR session 에서는 기존 KIS fallback 허용', () => {
    expect(isKisChartFallbackAllowed(kst('10:00'), 'FINAL_SCREEN_FALLBACK')).toBe(true);
    const decision = evaluateKisChartFallbackAllowed(kst('10:00'), 'STAGE2_DISCOVERY');
    expect(decision.allowed).toBe(true);
    expect(decision.session).toBe('REGULAR_TRADING');
  });

  it('E. OPEN_POSITION/P1_POSITION_MANAGEMENT 는 PRE_OPEN 에도 보호', () => {
    expect(isKisChartFallbackAllowed(kst('08:35'), 'OPEN_POSITION')).toBe(true);
    expect(isKisChartFallbackAllowed(kst('08:35'), 'P1_POSITION_MANAGEMENT')).toBe(true);
  });
});
