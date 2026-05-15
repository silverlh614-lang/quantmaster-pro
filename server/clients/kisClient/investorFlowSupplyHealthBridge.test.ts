// @responsibility ADR-0517 KIS investor flow → supplyProviderHealth bridge SSOT 회귀
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSupplyProviderHealthFromKisFlow,
  applySupplyProviderHealthFromKisFlow,
  isKisForensicFlowWiringDisabled,
} from './investorFlowSupplyHealthBridge.js';
import type { KisInvestorTradeByStockDaily, KisInvestorFlowActualRowCarrier } from './types.js';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

/**
 * ADR-0517 — Patch ADR-P0-SUPPLY-WIRE 회귀.
 *
 * 안전 invariants (ADR-0146 PR 자가 review 정합):
 *   - LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient orders)
 *   - KIS 주문 함수 5종 import 0건 (placeKisMarket·placeKisSell·placeKisStop·cancelKisOrder·placeKisTakeProfit)
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - 외부 API (fetch / axios / node-fetch) 호출 0건
 *   - ENV `KIS_FORENSIC_FLOW_WIRING_DISABLED=true` (default OFF, ADR-0157 정확 비교) 1줄 즉시 legacy 동작 100% 복원
 *   - 호출자 측 inline ENV 검사 0건 (`isKisForensicFlowWiringDisabled()` SSOT 위임 의무)
 *   - carrier.actualRows[0] 가 raw KIS row 그대로 보존 (한글 alias frgn_ntby_qty 등)
 */

const ORIGINAL_ENV_VALUE = process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;

function restoreEnv(): void {
  if (ORIGINAL_ENV_VALUE === undefined) {
    delete process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;
  } else {
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = ORIGINAL_ENV_VALUE;
  }
}

function makeCarrier(
  rows: Array<Record<string, unknown>> = [{ frgn_ntby_qty: 100, orgn_ntby_qty: 50 }],
  overrides: Partial<KisInvestorFlowActualRowCarrier> = {},
): KisInvestorFlowActualRowCarrier {
  return {
    provider: 'KIS_API',
    requestSymbol: '005930',
    normalizedSymbol: '005930',
    providerScope: 'SYMBOL_LEVEL',
    actualRows: rows,
    rowSourcePath: 'output1',
    rawFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty', 'prsn_ntby_qty'],
    numericStringFieldKeys: [],
    numberFieldKeys: ['frgn_ntby_qty', 'orgn_ntby_qty'],
    placeholderFieldKeys: [],
    carriedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeKisFlow(
  overrides: Partial<KisInvestorTradeByStockDaily> = {},
): KisInvestorTradeByStockDaily {
  return {
    stockCode: '005930',
    tradingDate: '2026-05-15',
    foreignNetBuy: 100,
    institutionalNetBuy: 50,
    individualNetBuy: -150,
    source: 'KIS_API',
    fetchedAt: '2026-05-15T00:00:00.000Z',
    actualInvestorFlowRowCarrier: makeCarrier(),
    ...overrides,
  };
}

describe('ADR-0517 — Group A: ENV gate (정확 비교 ADR-0157)', () => {
  afterEach(() => restoreEnv());

  it('A1. ENV 미설정 시 default OFF — isKisForensicFlowWiringDisabled() === false', () => {
    delete process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;
    expect(isKisForensicFlowWiringDisabled()).toBe(false);
  });

  it('A2. ENV "true" 명시 시 true 반환 (운영자 의도)', () => {
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = 'true';
    expect(isKisForensicFlowWiringDisabled()).toBe(true);
  });

  it('A3. ENV "1" / "TRUE" / "yes" 모두 거부 — ADR-0157 정확 비교 의무', () => {
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = '1';
    expect(isKisForensicFlowWiringDisabled()).toBe(false);
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = 'TRUE';
    expect(isKisForensicFlowWiringDisabled()).toBe(false);
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = 'yes';
    expect(isKisForensicFlowWiringDisabled()).toBe(false);
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = '';
    expect(isKisForensicFlowWiringDisabled()).toBe(false);
  });

  it('A4. ENV "false" 명시 시 false 반환 (legacy 동작 복원 OFF)', () => {
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = 'false';
    expect(isKisForensicFlowWiringDisabled()).toBe(false);
  });
});

describe('ADR-0517 — Group B: buildSupplyProviderHealthFromKisFlow null/undefined 입력', () => {
  afterEach(() => restoreEnv());

  beforeEach(() => {
    delete process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;
  });

  it('B1. ENV disabled 시 kisFlow 가 valid 여도 null 반환 (legacy 동작)', () => {
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = 'true';
    const result = buildSupplyProviderHealthFromKisFlow(makeKisFlow());
    expect(result).toBeNull();
  });

  it('B2. kisFlow=null → null', () => {
    expect(buildSupplyProviderHealthFromKisFlow(null)).toBeNull();
  });

  it('B3. kisFlow=undefined → null', () => {
    expect(buildSupplyProviderHealthFromKisFlow(undefined)).toBeNull();
  });
});

describe('ADR-0517 — Group C: carrier 부재 시 semantic-only 매핑', () => {
  beforeEach(() => {
    delete process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;
  });

  it('C1. carrier 부재 시 semanticInvestorRow + supplySemanticRow 만 채움', () => {
    const kisFlow = makeKisFlow({ actualInvestorFlowRowCarrier: undefined });
    const result = buildSupplyProviderHealthFromKisFlow(kisFlow);
    expect(result).not.toBeNull();
    expect(result?.semanticInvestorRow).toEqual({ foreignNetBuy: 100, institutionalNetBuy: 50 });
    expect(result?.supplySemanticRow).toEqual({ foreignNetBuy: 100, institutionalNetBuy: 50 });
    expect(result?.actualInvestorFlowCarried).toBe(false);
    expect(result?.actualInvestorRow).toBeUndefined();
    expect(result?.actualInvestorFlowRows).toBeUndefined();
  });

  it('C2. carrier 부재 시 selectedCandidate 도 semantic-only 분기 동일 형태', () => {
    const kisFlow = makeKisFlow({ actualInvestorFlowRowCarrier: undefined });
    const result = buildSupplyProviderHealthFromKisFlow(kisFlow);
    expect(result?.selectedCandidate).toEqual({
      semanticInvestorRow: { foreignNetBuy: 100, institutionalNetBuy: 50 },
      supplySemanticRow: { foreignNetBuy: 100, institutionalNetBuy: 50 },
      actualInvestorFlowCarried: false,
    });
  });
});

describe('ADR-0517 — Group D: carrier 존재 시 full 매핑 + selectedCandidate', () => {
  beforeEach(() => {
    delete process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;
  });

  it('D1. carrier 존재 + actualRows ≥1 → actualInvestorFlowCarried=true + 16-key field metadata 모두 propagate', () => {
    const kisFlow = makeKisFlow();
    const result = buildSupplyProviderHealthFromKisFlow(kisFlow);
    expect(result?.actualInvestorFlowCarried).toBe(true);
    expect(result?.actualInvestorFlowRowCount).toBe(1);
    expect(result?.actualInvestorRow).toEqual({ frgn_ntby_qty: 100, orgn_ntby_qty: 50 });
    expect(result?.actualInvestorFlowFieldKeys).toEqual(['frgn_ntby_qty', 'orgn_ntby_qty', 'prsn_ntby_qty']);
    expect(result?.actualInvestorFlowNumericKeys).toEqual(['frgn_ntby_qty', 'orgn_ntby_qty']);
    expect(result?.actualInvestorFlowNumericStringKeys).toEqual([]);
    expect(result?.actualInvestorFlowRowSourcePath).toBe('output1');
  });

  it('D2. selectedCandidate 가 top-level 과 byte-equivalent 동일 데이터 (mergeSupplyProviderHealth fallback)', () => {
    const kisFlow = makeKisFlow();
    const result = buildSupplyProviderHealthFromKisFlow(kisFlow);
    expect(result?.selectedCandidate?.actualInvestorRow).toEqual(result?.actualInvestorRow);
    expect(result?.selectedCandidate?.actualInvestorFlowRows).toEqual(result?.actualInvestorFlowRows);
    expect(result?.selectedCandidate?.actualInvestorFlowFieldKeys).toEqual(result?.actualInvestorFlowFieldKeys);
    expect(result?.selectedCandidate?.actualInvestorFlowNumericKeys).toEqual(result?.actualInvestorFlowNumericKeys);
    expect(result?.selectedCandidate?.actualInvestorFlowCarried).toBe(true);
    expect(result?.selectedCandidate?.semanticInvestorRow).toEqual({ foreignNetBuy: 100, institutionalNetBuy: 50 });
  });

  it('D3. carrier.actualRows=[] (빈 배열) → actualInvestorFlowCarried=false + actualInvestorRow=null', () => {
    const kisFlow = makeKisFlow({ actualInvestorFlowRowCarrier: makeCarrier([]) });
    const result = buildSupplyProviderHealthFromKisFlow(kisFlow);
    expect(result?.actualInvestorFlowCarried).toBe(false);
    expect(result?.actualInvestorFlowRowCount).toBe(0);
    expect(result?.actualInvestorRow).toBeNull();
    expect(result?.actualInvestorFlowRows).toEqual([]);
    expect(result?.selectedCandidate?.actualInvestorFlowCarried).toBe(false);
  });

  it('D4. carrier.actualRows[0] 가 raw KIS row (한글 alias) 그대로 보존 — ADR-0421 hasActualInvestorNumericRow 16-key SSOT 입력', () => {
    const rawRow = { frgn_ntby_qty: '12,345', orgn_ntby_qty: -5000, prsn_ntby_qty: '−7,345' };
    const kisFlow = makeKisFlow({
      actualInvestorFlowRowCarrier: makeCarrier([rawRow]),
    });
    const result = buildSupplyProviderHealthFromKisFlow(kisFlow);
    // raw row 가 그대로 보존되어야 함 (mutation 없음)
    expect(result?.actualInvestorRow).toBe(rawRow);
    expect(result?.actualInvestorFlowRows?.[0]).toBe(rawRow);
    expect(result?.selectedCandidate?.actualInvestorRow).toBe(rawRow);
  });
});

describe('ADR-0517 — Group E: applySupplyProviderHealthFromKisFlow (호출자 mutate 헬퍼)', () => {
  beforeEach(() => {
    delete process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED;
  });

  it('E1. ENV disabled 시 stock 객체 무수정 (legacy byte-equivalent)', () => {
    process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED = 'true';
    const stock: { supplyProviderHealth?: Record<string, unknown> } = {};
    applySupplyProviderHealthFromKisFlow(stock, makeKisFlow());
    expect(stock.supplyProviderHealth).toBeUndefined();
  });

  it('E2. kisFlow=null 시 stock 객체 무수정', () => {
    const stock: { supplyProviderHealth?: Record<string, unknown> } = {};
    applySupplyProviderHealthFromKisFlow(stock, null);
    expect(stock.supplyProviderHealth).toBeUndefined();
  });

  it('E3. kisFlow valid 시 stock.supplyProviderHealth 세팅 + carrier 메타데이터 모두 propagate', () => {
    const stock: { supplyProviderHealth?: Record<string, unknown> } = {};
    applySupplyProviderHealthFromKisFlow(stock, makeKisFlow());
    expect(stock.supplyProviderHealth).toBeDefined();
    expect(stock.supplyProviderHealth?.actualInvestorFlowCarried).toBe(true);
    expect(stock.supplyProviderHealth?.semanticInvestorRow).toEqual({ foreignNetBuy: 100, institutionalNetBuy: 50 });
    expect(stock.supplyProviderHealth?.actualInvestorFlowRowCount).toBe(1);
    expect((stock.supplyProviderHealth?.selectedCandidate as Record<string, unknown>)?.actualInvestorFlowCarried).toBe(true);
  });

  it('E4. 기존 supplyProviderHealth 보유 시 spread merge — 기존 필드 보존 + 신규 필드 우선', () => {
    const stock: { supplyProviderHealth?: Record<string, unknown> } = {
      supplyProviderHealth: {
        legacyField: 'preserved',
        actualInvestorFlowCarried: false, // overridden by new mapping
      },
    };
    applySupplyProviderHealthFromKisFlow(stock, makeKisFlow());
    expect(stock.supplyProviderHealth?.legacyField).toBe('preserved');
    expect(stock.supplyProviderHealth?.actualInvestorFlowCarried).toBe(true); // ADR-0517 우선
    expect(stock.supplyProviderHealth?.semanticInvestorRow).toEqual({ foreignNetBuy: 100, institutionalNetBuy: 50 });
  });
});

describe('ADR-0517 — Group F: 정적 grep 가드 (LIVE 매매 본체 0줄 변경)', () => {
  it('F1. SSOT 모듈에 KIS 주문 함수 5종 import 0건 (block comment strip 후 코드 본문 검사)', () => {
    const ssotPath = resolve(__dirnameLocal, 'investorFlowSupplyHealthBridge.ts');
    const src = readFileSync(ssotPath, 'utf-8');
    // header docstring 의 invariant 명시 (block comment) 는 제외하고 실제 코드 본문만 검사.
    // 라인 주석 + 블록 주석 strip → 코드 본문에 KIS 주문 함수 식별자 0건 검증.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/placeKisMarket\b/);
    expect(stripped).not.toMatch(/placeKisSell\b/);
    expect(stripped).not.toMatch(/placeKisStop\b/);
    expect(stripped).not.toMatch(/placeKisTakeProfit\b/);
    expect(stripped).not.toMatch(/cancelKisOrder\b/);
  });

  it('F2. SSOT 모듈에 autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const ssotPath = resolve(__dirnameLocal, 'investorFlowSupplyHealthBridge.ts');
    const src = readFileSync(ssotPath, 'utf-8');
    // 파일 본문 (header docstring 제외) 만 검사 — header 의 invariant 명시는 제외
    const importLines = src.split('\n').filter((line) => /^import\s/.test(line));
    const importBlock = importLines.join('\n');
    expect(importBlock).not.toMatch(/autoTradeEngine/);
    expect(importBlock).not.toMatch(/orderExecutor/);
    expect(importBlock).not.toMatch(/trancheExecutor/);
  });

  it('F3. SSOT 모듈에 외부 API 호출 (fetch / axios / node-fetch) 0건', () => {
    const ssotPath = resolve(__dirnameLocal, 'investorFlowSupplyHealthBridge.ts');
    const src = readFileSync(ssotPath, 'utf-8');
    const importLines = src.split('\n').filter((line) => /^import\s/.test(line));
    const importBlock = importLines.join('\n');
    expect(importBlock).not.toMatch(/from ['"]axios['"]/);
    expect(importBlock).not.toMatch(/from ['"]node-fetch['"]/);
    // fetch( 직접 호출도 본문에 부재
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\baxios\./);
  });

  it('F4. ENV 정확 비교 의무 (`=== \'true\'`) — ADR-0157 정합', () => {
    const ssotPath = resolve(__dirnameLocal, 'investorFlowSupplyHealthBridge.ts');
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).toContain("process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED === 'true'");
    // 잘못된 patterns 부재
    expect(src).not.toMatch(/KIS_FORENSIC_FLOW_WIRING_DISABLED\s*!==\s*['"]false['"]/);
    expect(src).not.toMatch(/Boolean\s*\(\s*process\.env\.KIS_FORENSIC_FLOW_WIRING_DISABLED/);
  });

  it('F5. barrel index.ts 가 3 export + 1 type re-export', () => {
    const indexPath = resolve(__dirnameLocal, 'index.ts');
    const src = readFileSync(indexPath, 'utf-8');
    expect(src).toContain('buildSupplyProviderHealthFromKisFlow');
    expect(src).toContain('applySupplyProviderHealthFromKisFlow');
    expect(src).toContain('isKisForensicFlowWiringDisabled');
    expect(src).toMatch(/export type \{ SupplyProviderHealthFromKisFlow \}/);
    expect(src).toMatch(/from ['"]\.\/investorFlowSupplyHealthBridge\.js['"]/);
  });

  it('F6. ADR-0517 추적 주석 명시 (헤더 docstring + barrel 주석)', () => {
    const ssotPath = resolve(__dirnameLocal, 'investorFlowSupplyHealthBridge.ts');
    const indexPath = resolve(__dirnameLocal, 'index.ts');
    const ssotSrc = readFileSync(ssotPath, 'utf-8');
    const indexSrc = readFileSync(indexPath, 'utf-8');
    expect(ssotSrc).toMatch(/ADR-0517/);
    expect(indexSrc).toMatch(/ADR-0517/);
  });
});

describe('ADR-0517 — Group G: caller wiring 정적 grep 가드 (4 callsite + 2 snapshot)', () => {
  it('G1. buyListLoop.ts 가 SSOT 위임 import + 3 callsite (FOLLOWTHROUGH / PRE_BREAKOUT 30% / 메인 buyList) wiring', () => {
    const callerPath = resolve(__dirnameLocal, '../../trading/signalScanner/perSymbol/buyListLoop.ts');
    const src = readFileSync(callerPath, 'utf-8');
    expect(src).toContain('investorFlowSupplyHealthBridge');
    expect(src).toContain('applySupplyProviderHealthFromKisFlow');
    // 호출 횟수 ≥3 (3 wiring callsite)
    const matches = src.match(/applySupplyProviderHealthFromKisFlow\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('G2. intradayLoop.ts 가 SSOT 위임 import + 1 callsite (INTRADAY) wiring', () => {
    const callerPath = resolve(__dirnameLocal, '../../trading/signalScanner/perSymbol/intradayLoop.ts');
    const src = readFileSync(callerPath, 'utf-8');
    expect(src).toContain('investorFlowSupplyHealthBridge');
    expect(src).toContain('applySupplyProviderHealthFromKisFlow');
  });

  it('G3. signalScanner/index.ts 의 snapshot maps 가 supplyProviderHealth 필드 propagate', () => {
    const indexPath = resolve(__dirnameLocal, '../../trading/signalScanner/index.ts');
    const src = readFileSync(indexPath, 'utf-8');
    // snapshot map 안 supplyProviderHealth 필드 ≥2 (buyList + intradayList)
    const matches = src.match(/supplyProviderHealth: w\.supplyProviderHealth/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/ADR-0517/);
  });

  it('G4. buyPipeline.ts GateData 가 kisFlow 필드 + fetchGateData 반환에 포함', () => {
    const callerPath = resolve(__dirnameLocal, '../../trading/buyPipeline.ts');
    const src = readFileSync(callerPath, 'utf-8');
    expect(src).toContain('kisFlow: KisInvestorTradeByStockDaily | null');
    expect(src).toContain("from '../clients/kisClient/types.js'");
    // fetchGateData 가 kisFlow 를 반환
    expect(src).toMatch(/return\s*\{\s*quote,\s*gate,\s*kisFlow\s*\}/);
  });

  it('G5. 호출자 측 inline ENV 검사 0건 (`isKisForensicFlowWiringDisabled()` SSOT 위임 의무)', () => {
    const buyListPath = resolve(__dirnameLocal, '../../trading/signalScanner/perSymbol/buyListLoop.ts');
    const intradayPath = resolve(__dirnameLocal, '../../trading/signalScanner/perSymbol/intradayLoop.ts');
    const buyListSrc = readFileSync(buyListPath, 'utf-8');
    const intradaySrc = readFileSync(intradayPath, 'utf-8');
    expect(buyListSrc).not.toMatch(/process\.env\.KIS_FORENSIC_FLOW_WIRING_DISABLED/);
    expect(intradaySrc).not.toMatch(/process\.env\.KIS_FORENSIC_FLOW_WIRING_DISABLED/);
  });
});
