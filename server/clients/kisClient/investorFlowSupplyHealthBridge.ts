// @responsibility KIS investor flow → supplyProviderHealth bridge SSOT (ADR-0517)
/**
 * investorFlowSupplyHealthBridge.ts — KIS actual investor flow row → Gate1 forensic 입력 단절 차단 SSOT
 *
 * 결함 (Patch ADR-P0-SUPPLY-WIRE / ADR-0517):
 *   - `fetchKisInvestorTradeByStockDaily(code)` 가 이미 `actualInvestorFlowRowCarrier`
 *     (KIS_API + actualRows + 6 field-key 분류) 를 채워서 반환하지만
 *   - `buyPipeline.fetchGateData()` 가 반환 schema `{quote, gate}` 에서 kisFlow 를 *드롭*
 *   - `mergeSupplyProviderHealth(w, context)` 의 fallback `w.supplyProviderHealth` 가
 *     buyListLoop 내부에서 절대 set 되지 않아 영원히 undefined → forensic 의
 *     `actualInvestorFlowCarried=false` / `semanticAvailable=0/N` / `forensicInputCarriesSemanticRow=0/N`
 *     → 전 후보 supplyUnknownPenalty 누적 → R2_BULL 40 후보 0 entries.
 *
 * 본 SSOT — 호출자(buyListLoop / intradayLoop) 가 fetchGateData 결과의 kisFlow 를
 * 즉시 `stock.supplyProviderHealth` 로 매핑하도록 SSOT 헬퍼 + ENV gate 제공.
 *
 * 절대 불변식 (사용자 명시 + ADR-0146 PR 자가 review 정합):
 *   1. Live 매매 본체 0줄 변경 — 본 SSOT 는 순수 매핑 함수 + ENV 헬퍼만
 *   2. KIS 주문 함수 5종 import 0건 — placeKisMarket / placeKisSell / placeKisStop / cancelKisOrder
 *   3. autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   4. 외부 API 신규 호출 0건 — 이미 fetch 한 KisInvestorTradeByStockDaily 만 활용
 *   5. `executionImpact: 'NONE'` — supplyProviderHealth 매핑은 forensic 진단 입력만
 *   6. ENV `KIS_FORENSIC_FLOW_WIRING_DISABLED=true` (default OFF, ADR-0157 정확 비교 `=== 'true'`)
 *      1줄로 즉시 ADR-P0-SUPPLY-WIRE 이전 동작 (w.supplyProviderHealth=undefined → forensic
 *      semanticAvailable=0/N) byte-equivalent 복원
 *   7. 호출자 측 inline ENV 검사 0건 — `isKisForensicFlowWiringDisabled()` SSOT 위임 의무
 *   8. carrier.actualRows[0] 가 ADR-0421 hasActualInvestorNumericRow 통과 의무 —
 *      hasCoreField (foreignNetBuy / institutionalNetBuy) 또는 KIS raw alias 에 finite numeric 보유
 *
 * mergeSupplyProviderHealth (perSymbolEvaluation.ts:56-86) 와 정합:
 *   - context.supplyRouterResult / investorFlowRouteResult / investorFlowRouter 부재 시
 *     `w.supplyProviderHealth` fallback 반환 → 본 SSOT 가 채운 supplyProviderHealth 가 그대로 사용
 *   - 후속 candidate snapshot map (index.ts:167-275 buyList + intradayList) 이
 *     `supplyProviderHealth: w.supplyProviderHealth` 필드 propagate → forensic collector 가 수신
 */

import type { KisInvestorTradeByStockDaily, KisInvestorFlowActualRowCarrier } from './types.js';

/**
 * supplyProviderHealth 의 forensic-relevant 필드 shape (mergeSupplyProviderHealth 정합).
 * 모든 필드 옵셔널 — 호출자가 부분 set 후 Object.assign 으로 merge 가능.
 */
export interface SupplyProviderHealthFromKisFlow {
  actualInvestorRow?: Record<string, unknown> | null;
  semanticInvestorRow?: { foreignNetBuy: number; institutionalNetBuy: number } | null;
  supplySemanticRow?: { foreignNetBuy: number; institutionalNetBuy: number } | null;
  actualInvestorFlowRows?: Array<Record<string, unknown>>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowRowSourcePath?: string | null;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  actualInvestorFlowCarried?: boolean;
  selectedCandidate?: {
    actualInvestorRow?: Record<string, unknown> | null;
    semanticInvestorRow?: { foreignNetBuy: number; institutionalNetBuy: number } | null;
    supplySemanticRow?: { foreignNetBuy: number; institutionalNetBuy: number } | null;
    actualInvestorFlowRows?: Array<Record<string, unknown>>;
    actualInvestorFlowRowCount?: number;
    actualInvestorFlowRowSourcePath?: string | null;
    actualInvestorFlowFieldKeys?: string[];
    actualInvestorFlowNumericKeys?: string[];
    actualInvestorFlowNumericStringKeys?: string[];
    actualInvestorFlowCarried?: boolean;
  };
}

/**
 * ENV `KIS_FORENSIC_FLOW_WIRING_DISABLED=true` (default OFF) 정확 비교 SSOT (ADR-0157).
 * 1줄 즉시 ADR-P0-SUPPLY-WIRE 이전 동작 (w.supplyProviderHealth=undefined → forensic
 * semanticAvailable=0/N) byte-equivalent 복원.
 */
export function isKisForensicFlowWiringDisabled(): boolean {
  return process.env.KIS_FORENSIC_FLOW_WIRING_DISABLED === 'true';
}

/**
 * KisInvestorTradeByStockDaily → supplyProviderHealth (forensic-relevant 필드) 매핑 SSOT.
 *
 * 결정 트리 (사용자 명시 절대 변경 금지):
 *   1. ENV disabled → null (호출자 측 mutate 0)
 *   2. kisFlow null/undefined → null (no-op)
 *   3. carrier 부재 → semanticInvestorRow 만 보존 (foreignNetBuy / institutionalNetBuy)
 *   4. carrier 존재 → 전체 actualInvestorFlowRows + field keys + selectedCandidate 매핑
 *
 * carrier.actualRows[0] 자체는 raw KIS row (한글 alias frgn_ntby_qty 등) 그대로 보존 —
 * forensic 의 hasActualInvestorNumericRow (ADR-0421) 가 16-key SSOT 매칭으로 검증.
 */
export function buildSupplyProviderHealthFromKisFlow(
  kisFlow: KisInvestorTradeByStockDaily | null | undefined,
): SupplyProviderHealthFromKisFlow | null {
  if (isKisForensicFlowWiringDisabled()) return null;
  if (!kisFlow) return null;

  const carrier: KisInvestorFlowActualRowCarrier | undefined = kisFlow.actualInvestorFlowRowCarrier;
  const semanticInvestorRow = {
    foreignNetBuy: kisFlow.foreignNetBuy,
    institutionalNetBuy: kisFlow.institutionalNetBuy,
  };

  if (!carrier) {
    return {
      semanticInvestorRow,
      supplySemanticRow: semanticInvestorRow,
      actualInvestorFlowCarried: false,
      selectedCandidate: {
        semanticInvestorRow,
        supplySemanticRow: semanticInvestorRow,
        actualInvestorFlowCarried: false,
      },
    };
  }

  const actualInvestorRow = carrier.actualRows.length > 0 ? carrier.actualRows[0] : null;
  const carried = carrier.actualRows.length > 0;

  return {
    actualInvestorRow,
    semanticInvestorRow,
    supplySemanticRow: semanticInvestorRow,
    actualInvestorFlowRows: carrier.actualRows,
    actualInvestorFlowRowCount: carrier.actualRows.length,
    actualInvestorFlowRowSourcePath: carrier.rowSourcePath,
    actualInvestorFlowFieldKeys: carrier.rawFieldKeys,
    actualInvestorFlowNumericKeys: carrier.numberFieldKeys,
    actualInvestorFlowNumericStringKeys: carrier.numericStringFieldKeys,
    actualInvestorFlowCarried: carried,
    selectedCandidate: {
      actualInvestorRow,
      semanticInvestorRow,
      supplySemanticRow: semanticInvestorRow,
      actualInvestorFlowRows: carrier.actualRows,
      actualInvestorFlowRowCount: carrier.actualRows.length,
      actualInvestorFlowRowSourcePath: carrier.rowSourcePath,
      actualInvestorFlowFieldKeys: carrier.rawFieldKeys,
      actualInvestorFlowNumericKeys: carrier.numberFieldKeys,
      actualInvestorFlowNumericStringKeys: carrier.numericStringFieldKeys,
      actualInvestorFlowCarried: carried,
    },
  };
}

/**
 * 호출자 측 mutate 헬퍼 — `stock.supplyProviderHealth = ...buildSupplyProviderHealthFromKisFlow(kisFlow)` 패턴 중복 차단.
 * 기존 stock.supplyProviderHealth 가 있을 시 spread merge (ADR-0421 fallback 데이터 보존).
 *
 * 호출자 사용 예:
 *   const kisFlow = await fetchKisInvestorTradeByStockDaily(stock.code).catch(() => null);
 *   applySupplyProviderHealthFromKisFlow(stock, kisFlow);
 *
 * ENV disabled 시 stock 객체 무수정 (legacy byte-equivalent).
 */
export function applySupplyProviderHealthFromKisFlow(
  stock: { supplyProviderHealth?: Record<string, unknown> | undefined },
  kisFlow: KisInvestorTradeByStockDaily | null | undefined,
): void {
  const mapped = buildSupplyProviderHealthFromKisFlow(kisFlow);
  if (!mapped) return;
  stock.supplyProviderHealth = {
    ...(stock.supplyProviderHealth ?? {}),
    ...(mapped as Record<string, unknown>),
  };
}
