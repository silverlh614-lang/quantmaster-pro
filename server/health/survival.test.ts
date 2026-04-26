/**
 * @responsibility ADR-0050 SurvivalSnapshot tier 분류·HHI·합성 회귀 테스트
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDailyLossTier,
  classifySectorTier,
  classifyKellyTier,
  composeOverallTier,
  computeHhi,
  type SurvivalTier,
  type SectorTier,
  type KellyTier,
} from './survival';

describe('classifyDailyLossTier — ADR-0050 §2.2', () => {
  it('bufferPct=75 → OK (충분 완충)', () => {
    expect(classifyDailyLossTier(75)).toBe<SurvivalTier>('OK');
  });
  it('bufferPct=50 정확히 → OK (경계값 포함)', () => {
    expect(classifyDailyLossTier(50)).toBe('OK');
  });
  it('bufferPct=40 → WARN (50% 미만)', () => {
    expect(classifyDailyLossTier(40)).toBe('WARN');
  });
  it('bufferPct=25 정확히 → WARN (경계값 포함)', () => {
    expect(classifyDailyLossTier(25)).toBe('WARN');
  });
  it('bufferPct=10 → CRITICAL (25% 미만 + 양수)', () => {
    expect(classifyDailyLossTier(10)).toBe('CRITICAL');
  });
  it('bufferPct=0 → EMERGENCY (한도 도달)', () => {
    expect(classifyDailyLossTier(0)).toBe('EMERGENCY');
  });
  it('bufferPct=-5 → EMERGENCY (한도 초과)', () => {
    expect(classifyDailyLossTier(-5)).toBe('EMERGENCY');
  });
  it('bufferPct=NaN → EMERGENCY (안전 fallback)', () => {
    expect(classifyDailyLossTier(NaN)).toBe('EMERGENCY');
  });
});

describe('classifySectorTier — ADR-0050 §2.2', () => {
  it('activePositions=0 → NA (위험 없음)', () => {
    expect(classifySectorTier(5000, 0)).toBe<SectorTier>('NA');
  });
  it('hhi=2000, active=3 → OK (분산 양호)', () => {
    expect(classifySectorTier(2000, 3)).toBe('OK');
  });
  it('hhi=2500 정확히 → OK (경계값 포함)', () => {
    expect(classifySectorTier(2500, 3)).toBe('OK');
  });
  it('hhi=3000 → WARN', () => {
    expect(classifySectorTier(3000, 3)).toBe('WARN');
  });
  it('hhi=4000 정확히 → WARN (경계값 포함)', () => {
    expect(classifySectorTier(4000, 3)).toBe('WARN');
  });
  it('hhi=5000 → CRITICAL (집중 과대)', () => {
    expect(classifySectorTier(5000, 3)).toBe('CRITICAL');
  });
  it('hhi=NaN, active>0 → NA (안전 fallback)', () => {
    expect(classifySectorTier(NaN, 3)).toBe('NA');
  });
  it('hhi=음수, active>0 → NA (안전 fallback)', () => {
    expect(classifySectorTier(-100, 3)).toBe('NA');
  });
});

describe('classifyKellyTier — ADR-0050 §2.2', () => {
  it('sampleSize=4 → CALIBRATING (표본 부족)', () => {
    expect(classifyKellyTier(0.8, 0.5, 4)).toBe<KellyTier>('CALIBRATING');
  });
  it('sampleSize=5 정확히 + 정상 ratio → OK (경계값 포함)', () => {
    expect(classifyKellyTier(0.8, 0.5, 5)).toBe('OK');
  });
  it('recommendedKelly=0 → CALIBRATING (권고값 미수렴)', () => {
    expect(classifyKellyTier(null, 0, 100)).toBe('CALIBRATING');
  });
  it('ratio=null + 표본 충분 + 권고 양수 → CALIBRATING', () => {
    expect(classifyKellyTier(null, 0.5, 100)).toBe('CALIBRATING');
  });
  it('ratio=NaN → CALIBRATING (안전 fallback)', () => {
    expect(classifyKellyTier(NaN, 0.5, 100)).toBe('CALIBRATING');
  });
  it('ratio=0.8 → OK (보수)', () => {
    expect(classifyKellyTier(0.8, 0.5, 100)).toBe('OK');
  });
  it('ratio=1.0 정확히 → OK (능선 정합)', () => {
    expect(classifyKellyTier(1.0, 0.5, 100)).toBe('OK');
  });
  it('ratio=1.3 → WARN (공격)', () => {
    expect(classifyKellyTier(1.3, 0.5, 100)).toBe('WARN');
  });
  it('ratio=1.5 정확히 → WARN (경계값 포함)', () => {
    expect(classifyKellyTier(1.5, 0.5, 100)).toBe('WARN');
  });
  it('ratio=2.0 → CRITICAL (능선 이탈)', () => {
    expect(classifyKellyTier(2.0, 0.5, 100)).toBe('CRITICAL');
  });
});

describe('computeHhi — Σ weight² × 10000', () => {
  it('단일 섹터 100% → HHI=10000', () => {
    expect(computeHhi({ '반도체': 1.0 })).toBe(10000);
  });
  it('균등 5섹터 (각 0.2) → HHI=2000', () => {
    expect(computeHhi({ a: 0.2, b: 0.2, c: 0.2, d: 0.2, e: 0.2 })).toBe(2000);
  });
  it('2:1:1 분포 (0.5/0.25/0.25) → HHI=3750', () => {
    // 0.5² + 0.25² + 0.25² = 0.25 + 0.0625 + 0.0625 = 0.375 → 3750
    expect(computeHhi({ a: 0.5, b: 0.25, c: 0.25 })).toBe(3750);
  });
  it('빈 입력 → HHI=0', () => {
    expect(computeHhi({})).toBe(0);
  });
  it('NaN 가중치 무시', () => {
    expect(computeHhi({ a: 1.0, b: NaN })).toBe(10000);
  });
  it('음수 가중치 무시', () => {
    expect(computeHhi({ a: 0.5, b: -0.5, c: 0.5 })).toBe(5000);
  });
});

describe('composeOverallTier — ADR-0050 §2.3 max-of-three', () => {
  it('OK + OK + OK → OK', () => {
    expect(composeOverallTier('OK', 'OK', 'OK')).toBe('OK');
  });
  it('CRITICAL + WARN + OK → CRITICAL (worst-of-three)', () => {
    expect(composeOverallTier('CRITICAL', 'WARN', 'OK')).toBe('CRITICAL');
  });
  it('EMERGENCY + OK + OK → EMERGENCY (loss 가 최우선)', () => {
    expect(composeOverallTier('EMERGENCY', 'OK', 'OK')).toBe('EMERGENCY');
  });
  it('OK + NA + CALIBRATING → OK (NA/CALIBRATING 합성 제외)', () => {
    expect(composeOverallTier('OK', 'NA', 'CALIBRATING')).toBe('OK');
  });
  it('WARN + NA + CALIBRATING → WARN', () => {
    expect(composeOverallTier('WARN', 'NA', 'CALIBRATING')).toBe('WARN');
  });
  it('CRITICAL + CRITICAL + CRITICAL → CRITICAL', () => {
    expect(composeOverallTier('CRITICAL', 'CRITICAL', 'CRITICAL')).toBe('CRITICAL');
  });
  it('OK + CRITICAL + WARN → CRITICAL', () => {
    expect(composeOverallTier('OK', 'CRITICAL', 'WARN')).toBe('CRITICAL');
  });
});
