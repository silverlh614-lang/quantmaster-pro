// @responsibility ADR-0624 D4 computeShadowCandidateUpdate 회귀 — shadow→candidate 가중치 결정(core 보호·#7)·clamp·소표본 무변화.
import { describe, it, expect } from 'vitest';
import { computeShadowCandidateUpdate } from './signalCalibrator.js';

const mk = (recommendation: string, totalTrades: number, winRate = 0.4, sharpe = 0.2) =>
  ({ recommendation, totalTrades, winRate, sharpe });

describe('ADR-0624 D4 computeShadowCandidateUpdate (shadow→candidate, core 보호)', () => {
  it('MAINTAIN → null (변화 없음)', () => {
    expect(computeShadowCandidateUpdate(mk('MAINTAIN', 200), 'ichimoku', 1.0)).toBeNull();
  });

  it('DECREASE + 충분 샘플(≥100) → 하향 clamp 값(<prev, ≥CORE_FLOOR 0.30)', () => {
    const w = computeShadowCandidateUpdate(mk('DECREASE_WEIGHT', 120), 'ichimoku', 1.0);
    expect(w).not.toBeNull();
    expect(w!).toBeLessThan(1.0);
    expect(w!).toBeGreaterThanOrEqual(0.3);
  });

  it('INCREASE + 충분 샘플 → 상향 값(>prev)', () => {
    const w = computeShadowCandidateUpdate(mk('INCREASE_WEIGHT', 120), 'ichimoku', 1.0);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThan(1.0);
  });

  it('샘플 부족(<30) → guardrail 무델타 → null (소표본 candidate 무변화)', () => {
    expect(computeShadowCandidateUpdate(mk('DECREASE_WEIGHT', 20), 'ichimoku', 1.0)).toBeNull();
  });

  it('CRITICAL 조건(momentum) DECREASE 도 candidate 값 산출(core 미반영은 source=SHADOW 로 보장)', () => {
    const w = computeShadowCandidateUpdate(mk('DECREASE_WEIGHT', 150, 0.4, 0.4), 'momentum', 1.0);
    expect(w).not.toBeNull();
    expect(w!).toBeGreaterThanOrEqual(0.3);
  });
});
