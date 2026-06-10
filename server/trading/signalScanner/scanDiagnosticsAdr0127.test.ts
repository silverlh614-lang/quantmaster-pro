/**
 * @responsibility ADR-0127 PR-3 ScanSummary.sectorEnergyQuality + emptyScanReason
 * DATA_INVALID 가중 + formatScanBlockersMessage 노출 회귀 테스트.
 */

import { describe, expect, it } from 'vitest';
import { classifyEmptyScanReason } from './emptyScanClassifier.js';
import { formatScanBlockersMessage } from './scanDiagnostics.js';
import type { ScanSummary, MacroGateState, WaitDistribution } from './scanDiagnostics.js';

const baseMacro: MacroGateState = {
  emergencyStop: false,
  autoTradeEnabled: true,
  regime: 'R3_EARLY',
  kellyMultiplierFromRegime: 1.0,
  fomcPhase: 'NORMAL',
  fomcKellyMultiplier: 1.0,
  finalKellyMultiplier: 1.0,
  vixGatingActive: false,
  bearDefenseMode: false,
  mhsBelow30: false,
  watchlistEmpty: false,
  sellOnlyMode: false,
};

const baseWait: WaitDistribution = {
  dataHold: 0, preBreakout: 0, gateFail: 0, sizingBlocked: 0,
  driftRemove: 0, corpAction: 0, volumeDrop: 0, other: 0,
};

function makeSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    time: '14:30 KST',
    candidates: 10,
    trackB: 10,
    swing: 0,
    catalyst: 0,
    momentum: 0,
    quoteFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    waitDistribution: { ...baseWait },
    macroGateState: { ...baseMacro },
    ...overrides,
  };
}

describe('ADR-0127: classifyEmptyScanReason — sectorEnergyQuality FAILED → DATA_INVALID', () => {
  it('sectorEnergyQuality=FAILED + 정상 wait 분포 → DATA_INVALID 우선 분류', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'FAILED',
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality=FAILED + gateFail 50%+ → DATA_INVALID 우선 (TOO_STRICT 보다 위)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'FAILED',
      waitDistribution: { ...baseWait, gateFail: 6 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });

  it('sectorEnergyQuality=PARTIAL → DATA_INVALID 미진입 (FAILED 만 가중)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'PARTIAL',
    });
    // PARTIAL 은 부분 데이터 — 다른 분기 평가 (gateFail 0 → UNKNOWN)
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });

  it('sectorEnergyQuality=STALE → DATA_INVALID 미진입', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'STALE',
    });
    expect(classifyEmptyScanReason(summary)).toBe('UNKNOWN');
  });

  it('sectorEnergyQuality=OK → 기존 분기만 적용', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'OK',
      waitDistribution: { ...baseWait, gateFail: 6 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('TOO_STRICT'); // FAILED 가중 안 됨
  });

  it('sectorEnergyQuality 부재 → 기존 분기 (후방호환)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      // sectorEnergyQuality 미부여
      waitDistribution: { ...baseWait, dataHold: 5 },
    });
    expect(classifyEmptyScanReason(summary)).toBe('DATA_INVALID');
  });

  it('우선순위 충돌 — FAILED + macro R6_DEFENSE → MARKET_WEAK 우선 (3 > 5)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'FAILED',
      macroGateState: { ...baseMacro, regime: 'R6_DEFENSE' },
    });
    // 매크로 차단 (3) 이 sectorEnergyQuality FAILED (5) 보다 우선
    expect(classifyEmptyScanReason(summary)).toBe('MARKET_WEAK');
  });

  it('우선순위 충돌 — FAILED + emergencyStop → ORDER_BLOCKED 우선 (4 > 5)', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'FAILED',
      macroGateState: { ...baseMacro, emergencyStop: true },
    });
    expect(classifyEmptyScanReason(summary)).toBe('ORDER_BLOCKED');
  });
});

describe('ADR-0127: formatScanBlockersMessage — sectorEnergyQuality 노출', () => {
  it('OK 시 ✅ 마커 + validSectorCount 12/12', () => {
    const summary = makeSummary({
      sectorEnergyQuality: 'OK',
      validSectorCount: 12,
      sectorEnergyReasons: [],
    });
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/섹터 에너지 데이터 품질/);
    expect(msg).toMatch(/dataQuality.*✅.*OK/);
    expect(msg).toMatch(/validSectorCount: 12\/12/);
  });

  it('PARTIAL 시 🟡 마커 + 8/12 노출', () => {
    const summary = makeSummary({
      sectorEnergyQuality: 'PARTIAL',
      validSectorCount: 8,
      sectorEnergyReasons: ['PARTIAL: validSectorCount=8/12'],
    });
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/dataQuality.*🟡.*PARTIAL/);
    expect(msg).toMatch(/validSectorCount: 8\/12/);
  });

  it('STALE 시 🟠 마커', () => {
    const summary = makeSummary({
      sectorEnergyQuality: 'STALE',
      validSectorCount: 5,
      sectorEnergyReasons: ['validSectorCount=5 < min=8'],
    });
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/dataQuality.*🟠.*STALE/);
  });

  it('FAILED 시 ❌ 마커 + DATA_INVALID 가중 안내', () => {
    const summary = makeSummary({
      sectorEnergyQuality: 'FAILED',
      validSectorCount: 0,
      sectorEnergyReasons: ['symmetry validation failed', 'today indexCode 충실도 50%'],
    });
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/dataQuality.*❌.*FAILED/);
    expect(msg).toMatch(/DATA_INVALID 자동 가중/);
    expect(msg).toMatch(/ADR-0127/);
  });

  it('reasons 배열 — 최대 3개까지 표시', () => {
    const summary = makeSummary({
      sectorEnergyQuality: 'FAILED',
      validSectorCount: 0,
      sectorEnergyReasons: ['reason1', 'reason2', 'reason3', 'reason4', 'reason5'],
    });
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/reason1; reason2; reason3/);
    expect(msg).not.toMatch(/reason4|reason5/);
  });

  it('sectorEnergyQuality 부재 → 섹터 에너지 섹션 미표시 (후방호환)', () => {
    const summary = makeSummary({});
    const msg = formatScanBlockersMessage(summary);
    expect(msg).not.toMatch(/섹터 에너지 데이터 품질/);
  });

  it('reasons 빈 배열 → reasons 라인 미표시', () => {
    const summary = makeSummary({
      sectorEnergyQuality: 'OK',
      validSectorCount: 12,
      sectorEnergyReasons: [],
    });
    const msg = formatScanBlockersMessage(summary);
    expect(msg).toMatch(/dataQuality.*OK/);
    expect(msg).not.toMatch(/^.*reasons:.*$/m);
  });

  it('1차 로그 사용자 시나리오 — FAILED + symmetry 미통과 노출', () => {
    const summary = makeSummary({
      candidates: 10,
      entries: 0,
      sectorEnergyQuality: 'FAILED',
      validSectorCount: 0,
      sectorEnergyReasons: [
        'symmetry validation failed',
        'today indexCode 충실도 50.0% < 90%',
      ],
      emptyScanReason: classifyEmptyScanReason(makeSummary({
        candidates: 10,
        entries: 0,
        sectorEnergyQuality: 'FAILED',
      })) ?? undefined,
    });
    const msg = formatScanBlockersMessage(summary);
    // FAILED 마커 + DATA_INVALID 분류 + reasons 노출 모두 충족
    expect(msg).toMatch(/❌.*FAILED/);
    expect(msg).toMatch(/symmetry validation failed/);
    expect(msg).toMatch(/DATA_INVALID/);
  });
});
