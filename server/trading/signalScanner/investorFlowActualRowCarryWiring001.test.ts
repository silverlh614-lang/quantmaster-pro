/**
 * @responsibility INVESTOR-FLOW-ACTUAL-ROW-CARRY-WIRING-001 회귀 — adapter actual
 * investor row 를 selectedProvider 와 분리해 router/forensic/semantic 단계로 carry.
 *
 * 핵심 불변식 (본 테스트가 영구 보호):
 *   1. selectedProvider==='NONE' 도 adapter row 보유 시 cross-provider carry 인정.
 *   2. diagnosticActualInvestorRow 는 selectedProvider 무관 carry (DIAGNOSTIC_ONLY scope).
 *   3. hasActualInvestorNumericRow 는 dummy/wrapper/metadata-only 객체를 거부.
 *   4. carry 됐으나 숫자 필드 없으면 NO_NUMERIC_INVESTOR_FIELD_FOUND (단절 위치 정밀 진단).
 *   5. 모든 carry 결과 executionImpact='NONE' / liveExecutionAllowed=false — CORE 무영향.
 */

import { describe, it, expect } from 'vitest';
import {
  hasActualInvestorNumericRow,
  evaluateInvestorFlowSemanticAvailabilityV2,
} from '../../supply/investorFlowSemanticAvailability.js';
import { buildInvestorFlowProviderRouteResultAdr0477 } from './investorFlowProviderRouterAdr0477.js';

// ── hasActualInvestorNumericRow — dummy/wrapper 거부 SSOT ────────────────────

describe('hasActualInvestorNumericRow — 숫자 투자자 필드 검증 SSOT', () => {
  it('1. null / undefined → false', () => {
    expect(hasActualInvestorNumericRow(null)).toBe(false);
    expect(hasActualInvestorNumericRow(undefined)).toBe(false);
  });

  it('2. non-object (string/number) → false', () => {
    expect(hasActualInvestorNumericRow('foreignNetBuy')).toBe(false);
    expect(hasActualInvestorNumericRow(1500)).toBe(false);
  });

  it('3. array → false (wrapper 거부)', () => {
    expect(hasActualInvestorNumericRow([{ foreignNetBuy: 100 }])).toBe(false);
  });

  it('4. metadata-only 객체 (숫자 투자자 필드 0) → false', () => {
    expect(hasActualInvestorNumericRow({ provider: 'KIS_API', sourceDate: '2026-05-08' })).toBe(false);
  });

  it('5. 빈 객체 → false', () => {
    expect(hasActualInvestorNumericRow({})).toBe(false);
  });

  it('6. finite number 투자자 필드 1개 이상 → true', () => {
    expect(hasActualInvestorNumericRow({ foreignNetBuy: 1500 })).toBe(true);
    expect(hasActualInvestorNumericRow({ institutionalNetBuy: -800 })).toBe(true);
  });

  it('7. KIS raw alias 숫자-문자열 (콤마 포함) → true', () => {
    expect(hasActualInvestorNumericRow({ frgn_ntby_qty: '1,234' })).toBe(true);
    expect(hasActualInvestorNumericRow({ orgn_ntby_tr_pbmn: '-2,000' })).toBe(true);
  });

  it('8. placeholder/빈 문자열 값만 있는 객체 → false', () => {
    expect(hasActualInvestorNumericRow({ foreignNetBuy: '', institutionalNetBuy: '   ' })).toBe(false);
    expect(hasActualInvestorNumericRow({ foreign: 'N/A' })).toBe(false);
  });
});

// ── evaluateInvestorFlowSemanticAvailabilityV2 — NO_NUMERIC_INVESTOR_FIELD_FOUND ──

describe('evaluateInvestorFlowSemanticAvailabilityV2 — carry 단절 위치 정밀 진단', () => {
  const base = {
    symbolMatched: true,
    providerScope: 'SYMBOL_LEVEL' as const,
  };

  it('9. carry=true + core 필드 부재 + 숫자 필드 없음 → NO_NUMERIC_INVESTOR_FIELD_FOUND', () => {
    const result = evaluateInvestorFlowSemanticAvailabilityV2({
      ...base,
      flow: { provider: 'KIS_API', sourceDate: '2026-05-08' },
      actualInvestorRowCarried: true,
    });
    expect(result.reason).toBe('NO_NUMERIC_INVESTOR_FIELD_FOUND');
    expect(result.available).toBe(false);
    expect(result.executionImpact).toBe('NONE');
  });

  it('10. carry=false + core 필드 부재 → ACTUAL_INVESTOR_ROW_NOT_CARRIED (기존 동작 보존)', () => {
    const result = evaluateInvestorFlowSemanticAvailabilityV2({
      ...base,
      flow: { provider: 'KIS_API' },
      actualInvestorRowCarried: false,
    });
    expect(result.reason).toBe('ACTUAL_INVESTOR_ROW_NOT_CARRIED');
    expect(result.available).toBe(false);
  });

  it('11. carry=true + core 필드 존재 → NO_NUMERIC_INVESTOR_FIELD_FOUND 아님 (AVAILABLE)', () => {
    const result = evaluateInvestorFlowSemanticAvailabilityV2({
      ...base,
      flow: { foreignNetBuy: 1500, institutionalNetBuy: -800 },
      actualInvestorRowCarried: true,
    });
    expect(result.reason).not.toBe('NO_NUMERIC_INVESTOR_FIELD_FOUND');
    expect(result.available).toBe(true);
  });

  it('12. carry=true + core 필드 부재 + 숫자 alias 필드 보유 → NO_NUMERIC_INVESTOR_FIELD_FOUND 아님', () => {
    const result = evaluateInvestorFlowSemanticAvailabilityV2({
      ...base,
      flow: { frgn_ntby_qty: '1,234' },
      actualInvestorRowCarried: true,
    });
    expect(result.reason).not.toBe('NO_NUMERIC_INVESTOR_FIELD_FOUND');
  });
});

// ── Router — selectedProvider 와 actual row carry 분리 ───────────────────────

describe('Router — adapter actual row carry / selectedProvider 분리', () => {
  it('13. KIS raw materialized → diagnosticActualInvestorRow + actualInvestorRowProvider=KIS_API', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
        orgn_ntby_tr_pbmn: '-2,000',
        indv_ntby_tr_pbmn: '766',
      },
      kisTriedForInvestorFlow: true,
    });
    expect(route.diagnosticActualInvestorRow).not.toBeNull();
    expect(route.diagnosticActualInvestorRow).toBeDefined();
    expect(route.actualInvestorRowProvider).toBe('KIS_API');
    expect(hasActualInvestorNumericRow(route.diagnosticActualInvestorRow)).toBe(true);
  });

  it('14. KIS_API 가 selectedProvider 이면 useScope=SELECTED_PROVIDER + adapterForwarded=false', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
        orgn_ntby_tr_pbmn: '-2,000',
      },
      kisTriedForInvestorFlow: true,
    });
    if (route.selectedProvider === 'KIS_API') {
      expect(route.actualInvestorRowUseScope).toBe('GATE_SCORE_ELIGIBLE');
      expect(route.selectedProviderActualInvestorRow).not.toBeNull();
      // selectedProvider === actualRowProvider → cross-provider forward 아님
      expect(route.adapterRowsForwardedAcrossProviders).toBe(false);
    } else {
      // selectedProvider !== KIS_API 면 DIAGNOSTIC_ONLY + cross-provider carry
      expect(route.actualInvestorRowUseScope).toBe('DIAGNOSTIC_ONLY');
      expect(route.adapterRowsForwardedAcrossProviders).toBe(true);
    }
  });

  it('15. KIS raw 부재 → diagnosticActualInvestorRow=null, adapterForwarded=false', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      naverCollectorWired: false,
      cacheRaw: null,
      kisTriedForInvestorFlow: true,
      marketProgramStatus: 'ACCEPTED_EMPTY',
      fssSourceAgeTradingDays: 5,
    });
    expect(route.diagnosticActualInvestorRow ?? null).toBeNull();
    expect(route.actualInvestorRowProvider ?? null).toBeNull();
    expect(route.adapterRowsForwardedAcrossProviders).toBe(false);
  });

  it('16. 4 신규 carry 필드가 bySymbol payload 에도 전파됨', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
        orgn_ntby_tr_pbmn: '-2,000',
      },
      kisTriedForInvestorFlow: true,
    });
    const payload = route.bySymbol?.['005930'];
    expect(payload).toBeDefined();
    expect(payload).toHaveProperty('diagnosticActualInvestorRow');
    expect(payload).toHaveProperty('selectedProviderActualInvestorRow');
    expect(payload).toHaveProperty('actualInvestorRowProvider');
    expect(payload).toHaveProperty('actualInvestorRowUseScope');
    expect(payload?.diagnosticActualInvestorRow).toEqual(route.diagnosticActualInvestorRow);
  });

  it('17. carry 결과는 CORE 무영향 — executionImpact=NONE / liveExecutionAllowed=false', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        sourceDate: '2026-05-08',
        frgn_ntby_tr_pbmn: '1,234',
      },
      kisTriedForInvestorFlow: true,
    });
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
  });
});

describe('KIS normalized row bridge — diagnostic-only promotion', () => {
  it('18. normalized row numeric field → diagnosticActualInvestorRow promotion + DIAGNOSTIC_ONLY', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        normalizedRow: {
          symbol: '005930',
          foreignNetBuy: '1,234',
          institutionNetBuy: '-2,000',
        },
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.investorRowMaterializationClass).toBe('NORMALIZED_NUMERIC_ROW');
    expect(route.diagnosticActualInvestorRowFromNormalized).toBe(true);
    expect(route.diagnosticActualInvestorRow).toEqual(expect.objectContaining({ foreignNetBuy: '1,234', institutionNetBuy: '-2,000' }));
    expect(route.actualInvestorRowProvider).toBe('KIS_API');
    expect(route.actualInvestorRowUseScope).toBe('GATE_SCORE_ELIGIBLE');
    expect(route.executionImpact).toBe('NONE');
    expect(route.liveExecutionAllowed).toBe(false);
  });

  it('19. normalized row metadata-only → actual row로 오판하지 않음', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        symbol: '005930',
        normalizedRow: {
          symbol: '005930',
          provider: 'KIS_API',
          providerScope: 'SYMBOL_LEVEL',
        },
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.investorRowMaterializationClass).toBe('NORMALIZED_METADATA_ONLY');
    expect(route.diagnosticActualInvestorRowFromNormalized).toBe(false);
    expect(route.diagnosticActualInvestorRow ?? null).toBeNull();
    expect(route.actualInvestorRowProvider ?? null).toBeNull();
  });

  it('20. wrapper-only object → rawInvestorRowAvailable=false equivalent and no diagnostic row', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        selectedProvider: 'KIS_API',
        materialized: true,
        usableForRouter: true,
      },
      kisTriedForInvestorFlow: true,
    });

    expect(route.investorRowMaterializationClass).toBe('WRAPPER_ONLY');
    expect(route.kisRawRowAvailableAtAdapter).toBe(false);
    expect(route.diagnosticActualInvestorRow ?? null).toBeNull();
  });

  it('21. bySymbol payload carries normalized diagnostic row for SELL_ONLY merge path', () => {
    const route = buildInvestorFlowProviderRouteResultAdr0477({
      code: '005930',
      kisInvestorRaw: {
        normalizedRow: {
          foreignNetBuy: '1,234',
          institutionNetBuy: '-2,000',
        },
      },
      kisTriedForInvestorFlow: true,
    });

    const payload = route.bySymbol?.['005930'];
    expect(payload?.diagnosticActualInvestorRowFromNormalized).toBe(true);
    expect(payload?.diagnosticActualInvestorRow).toEqual(route.diagnosticActualInvestorRow);
    expect(payload?.actualInvestorRowUseScope).toBe('GATE_SCORE_ELIGIBLE');
  });
});
