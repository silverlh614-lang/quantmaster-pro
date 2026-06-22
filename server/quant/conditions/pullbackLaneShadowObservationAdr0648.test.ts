// @responsibility ADR-0648 눌림목 레인 force-ON hypothetical shadow 관측 stamp/summary/format 단위 테스트
import { describe, expect, it } from 'vitest';
import {
  buildPullbackLaneShadowStamp,
  buildPullbackLaneShadowSummary,
  formatPullbackLaneShadowLine,
} from './pullbackLaneShadowObservationAdr0648.js';

describe('buildPullbackLaneShadowStamp (ADR-0648 force-ON hypothetical)', () => {
  // 눌림목 충족: price/high20d=0.95, price≥ma20, vol/avgVol=0.7. high5d 높여 추격 미발화.
  const pullbackQuote = {
    price: 95, high5d: 200, high20d: 100, ma20: 90, volume: 70, avgVolume: 100,
  };

  it('flag 무관 — 눌림목 임계 충족 시 pullbackLaneHypotheticalFired=true', () => {
    const s = buildPullbackLaneShadowStamp(pullbackQuote);
    expect(s.pullbackLaneHypotheticalFired).toBe(true);
    expect(s.pullbackLanePosVsHigh20d).toBeCloseTo(0.95, 5);
    expect(s.pullbackLaneVolRatio).toBeCloseTo(0.7, 5);
    expect(s.pullbackLaneAboveMa20).toBe(true);
    expect(s.breakoutChaseLaneFired).toBe(false);
  });

  it('추격(레인 C) FIRED 대조군 + 과열 가드 trigger 산출', () => {
    // price/high5d=1.10 (>1.06) → 과열 + 거래량 2배 → 추격 FIRED.
    const s = buildPullbackLaneShadowStamp({
      price: 110, high5d: 100, high20d: 100, ma20: 90, volume: 200, avgVolume: 100,
    });
    expect(s.breakoutChaseLaneFired).toBe(true);
    expect(s.overheatGuardTriggered).toBe(true);
    expect(s.pullbackLaneHypotheticalFired).toBe(false);
  });

  it('데이터 부재(high20d/avgVolume=0) — null 안전 처리, 미FIRED', () => {
    const s = buildPullbackLaneShadowStamp({ price: 95, high20d: 0, avgVolume: 0 });
    expect(s.pullbackLaneHypotheticalFired).toBe(false);
    expect(s.pullbackLanePosVsHigh20d).toBeNull();
    expect(s.pullbackLaneVolRatio).toBeNull();
  });
});

describe('buildPullbackLaneShadowSummary + formatPullbackLaneShadowLine', () => {
  it('집계 — pullbackOnlyFired = 눌림목 FIRED but 추격 미FIRED', () => {
    const stamps = [
      buildPullbackLaneShadowStamp({ price: 95, high5d: 200, high20d: 100, ma20: 90, volume: 70, avgVolume: 100 }),
      buildPullbackLaneShadowStamp({ price: 110, high5d: 100, high20d: 100, ma20: 90, volume: 200, avgVolume: 100 }),
    ];
    const sum = buildPullbackLaneShadowSummary(stamps);
    expect(sum.totalSamples).toBe(2);
    expect(sum.pullbackHypotheticalFired).toBe(1);
    expect(sum.breakoutChaseFired).toBe(1);
    expect(sum.overheatGuardTriggered).toBe(1);
    expect(sum.pullbackOnlyFired).toBe(1);
  });

  it('format — marketSignal=false 표기 + 샘플 0 시 null', () => {
    expect(formatPullbackLaneShadowLine(undefined)).toBeNull();
    expect(formatPullbackLaneShadowLine(buildPullbackLaneShadowSummary([]))).toBeNull();
    const line = formatPullbackLaneShadowLine(buildPullbackLaneShadowSummary([
      buildPullbackLaneShadowStamp({ price: 95, high5d: 200, high20d: 100, ma20: 90, volume: 70, avgVolume: 100 }),
    ]));
    expect(line).toContain('marketSignal=false');
    expect(line).toContain('눌림목');
  });
});
