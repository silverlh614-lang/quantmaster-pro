// @responsibility ADR-0544 후속 회귀 — 휴일/세션닫힘 SectorEnergy scan_blockers summary 중립 표시. executionImpact=NONE.

import { describe, expect, it } from 'vitest';
import { buildSectorEnergyQualitySection } from './scanBlockersMessageSections.js';

function input(canonical: Record<string, unknown> | undefined) {
  return {
    sectorEnergyQuality: 'DEGRADED',
    validSectorCount: 0,
    sectorEnergyReasons: [],
    sectorEnergyCanonicalState: canonical,
  } as never;
}

describe('ADR-0544 buildSectorEnergyQualitySection — session-closed neutral display', () => {
  it('SESSION_NOT_VERIFIABLE → 중립 SESSION_CLOSED 블록 (실패성 표현 미노출)', () => {
    const text = buildSectorEnergyQualitySection(input({
      promotionCoveragePass: false,
      dataQuality: 'SESSION_NOT_VERIFIABLE',
      sectorIndexVerifyMode: 'VERIFY_SKIPPED_SESSION_CLOSED',
      officialSectorCount: 11,
      shadowLeadershipAllowed: true,
      counterfactualAllowed: true,
    })).join('\n');
    expect(text).toContain('status=VERIFY_SKIPPED_SESSION_CLOSED');
    expect(text).toContain('verifiedOfficialSectorCount=N/A_SESSION_CLOSED');
    expect(text).toContain('promotionCoverage=N/A_SESSION_CLOSED');
    expect(text).toContain('promotion=DISABLED_FOR_SESSION');
    expect(text).toContain('providerIssue=false');
    expect(text).toContain('marketSignal=false');
    expect(text).toContain('operatorAction=OBSERVE_NEXT_TRADING_SESSION');
    // 실패성 표현 미노출
    expect(text).not.toContain('데이터 품질');
    expect(text).not.toContain('❌');
    expect(text).not.toContain('🔶');
  });

  it('대조군: 장중 실제 FAIL(MISSING) → 기존 legacy DEGRADED 블록 유지', () => {
    const text = buildSectorEnergyQualitySection(input({
      promotionCoveragePass: false,
      dataQuality: 'MISSING',
      sectorIndexVerifyMode: 'LIVE_VERIFY',
      officialSectorCount: 11,
    })).join('\n');
    expect(text).toContain('데이터 품질');
    expect(text).not.toContain('VERIFY_SKIPPED_SESSION_CLOSED');
  });

  it('canonical PASS → VERIFIED summary (무회귀)', () => {
    const text = buildSectorEnergyQualitySection(input({
      promotionCoveragePass: true,
      dataQuality: 'VERIFIED',
      officialSectorCount: 11,
      verifiedOfficialSectorCount: 11,
      promotionCoverage: 1,
      promotionAllowed: true,
      sectorBoostAllowed: true,
      strongBuyAllowed: true,
    })).join('\n');
    expect(text).toContain('status=VERIFIED');
  });
});
