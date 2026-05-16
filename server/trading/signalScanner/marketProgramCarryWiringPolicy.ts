/**
 * @responsibility 시장 프로그램매매 4 필드 carry payload SSOT — Patch-MARKET-PROGRAM-CARRY-WIRING-001 diagnostic-only path.
 *
 * Patch-MARKET-PROGRAM-CARRY-WIRING-001 — Phase 1 audit 결과:
 *
 *  • Writer (`marketDataRefresh.ts:refreshMarketRegimeVars` ⑥-c) 가
 *    `MacroState.programNetBuyAmount` / `programArbitrageNetBuy` /
 *    `programFetchedAt` / `programSource` 4 필드를 정상적으로 영속.
 *  • V2 router (`programMarketRouterPatch006.ts`) + supplyHealth 표시 경로는
 *    macroState 를 직접 read 하여 정상 동작.
 *  • 그러나 normal-supply-preview carry chain 의 2 진입점 — `signalScanner/index.ts`
 *    의 `PREFLIGHT_ABORT_DIAGNOSTIC` (라인 101) + `RUNTIME_DIAGNOSTIC` (라인 206) —
 *    이 `persistNormalSupplyPreview({...})` 호출 시 `marketProgramFlow` 인자를
 *    *완전 부재* 시켜 `marketProgramAvailable=false` 결함이 발생.
 *  • Branch B (`normalSupplyPreviewRunner.ts:COMMAND` 경로) 는 4 필드 중 2 필드만
 *    (`programNetBuyAmount` + `programSource`) carry — `programArbitrageNetBuy`,
 *    `programFetchedAt` 누락으로 forensic provider issue 진단 정밀도 손실.
 *
 * 본 SSOT 는 4 필드를 단일 helper 로 carry — 호출자 측 inline read 또는 부분 carry
 * 의 drift 위험 영구 차단. Branch A wiring (2 callsite) + Branch B 격상 (4 필드
 * 모두) 의 단일 진입점.
 *
 * 절대 invariants (사용자 명시 직접 인용 verbatim — 절대 변경 금지):
 *
 *  • diagnostic-only carry — LIVE 매매 의사결정 입력 절대 금지
 *    (executionImpact: 'NONE' / marketSignal: false literal type 컴파일 타임 강제)
 *  • providerIssue=true 시 bearish 신호 변환 금지 — DATA_UNAVAILABLE != failed,
 *    UNKNOWN != NEUTRAL (ADR-0416 / ADR-0421 정합, 운영자 안내 layer 만)
 *  • ENV 정확 비교 의무 (ADR-0157) — `=== 'true'` 만, `'TRUE'` / `'1'` / `'yes'` 거부
 *  • 호출자 측 inline `process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED` 검사 0건
 *    (`isMarketProgramCarryWiringDisabled()` SSOT 위임 의무)
 *  • LIVE 매매 본체 0줄 변경 — `signalScanner.ts` / `signalScanner/perSymbolEvaluation.ts`
 *    / `signalScanner/perSymbol/**` / `signalScanner/preflight.ts` / `entryEngine.ts`
 *    / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*`
 *    / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄 (signalScanner/index.ts 의
 *    2 callsite 만 옵셔널 인자 추가 — diagnostic-only path)
 *  • KIS/KRX/Yahoo/Naver outbound 0건 추가 (macroStateRepo read-only consumer 만)
 *  • ENV `MARKET_PROGRAM_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 100% 복원
 *    (default OFF — 현행 동작 보존이 default)
 *  • ADR 발급 0건 (patch type), INDEX.md 갱신 0건
 *
 * 잘못된 해결 방법 영구 차단:
 *
 *  • 호출자 측 inline `process.env` 검사 (SSOT 위임 의무)
 *  • 4 필드 중 일부만 carry (`programNetBuyAmount` 만 carry 같은 부분 carry —
 *    `buildMarketProgramFlowCarryPayload()` SSOT 단일 호출 의무로 drift 차단)
 *  • `marketProgramFlow` 결과를 매매 의사결정 입력 (literal type 컴파일 타임 차단)
 *  • macroStateRepo 본체 변경 (read-only consumer 의무)
 *  • 신규 외부 API 호출 (macroState read-only 만 — KIS/KRX/Yahoo/Naver outbound 0)
 *  • ENV default ON (운영 회귀 안전망 — default OFF 의무)
 */

import type { MacroState } from '../../persistence/macroStateRepo.js';

/**
 * Patch-MARKET-PROGRAM-CARRY-WIRING-001 — SSOT ENV gate (ADR-0157 정확 비교).
 *
 * default OFF — 현행 동작 100% 보존이 default. 운영 회귀 발견 시
 * `MARKET_PROGRAM_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 동작 복원.
 *
 * ADR-0157 정합 — `=== 'true'` 만 비활성. `'TRUE'` / `'1'` / `'yes'` 모두 거부 (오타
 * 또는 다른 환경의 boolean 표기 우회 차단).
 */
export function isMarketProgramCarryWiringDisabled(): boolean {
  return process.env.MARKET_PROGRAM_CARRY_WIRING_DISABLED === 'true';
}

/**
 * Patch-MARKET-PROGRAM-CARRY-WIRING-001 — caller-facing carry payload.
 *
 * `persistNormalSupplyPreview({ marketProgramFlow })` 호출 시 본 schema 를 따르는
 * 객체를 그대로 전달. literal type 두 필드 (`executionImpact: 'NONE'` /
 * `marketSignal: false`) 는 TypeScript 컴파일 타임에 호출자 측 invariant 위반 즉시
 * fail — `marketProgramFlow` 결과가 매매 의사결정 입력으로 변환되는 것 영구 차단.
 */
export interface MarketProgramFlowCarryPayload {
  /** 시장 전체 프로그램 순매수 금액 (억원, 양수=순매수). macroState 부재 시 undefined. */
  readonly marketProgramNetBuy?: number;
  /** 차익거래 순매수 (억원). macroState 가 null 반환 시 null 보존, 미수집 시 undefined. */
  readonly programArbitrageNetBuyAmount?: number | null;
  /** KIS 응답 시각 (ISO) — `/program_market` 신선도 진단 입력. 미수집 시 undefined. */
  readonly programFetchedAt?: string;
  /** 'KIS_API' (정상) / 'NONE' (마지막 갱신 실패) — providerIssue 도출 입력. */
  readonly sourceProvider: 'KIS_API' | 'NONE';
  /** sourceProvider === 'NONE' 일 때 true — DATA_UNAVAILABLE 의미, bearish 신호 아님. */
  readonly providerIssue: boolean;
  /** literal type 컴파일 타임 강제 — 매매 결정 입력 영구 차단 (ADR-0451 정합). */
  readonly executionImpact: 'NONE';
  /** literal type 컴파일 타임 강제 — providerIssue=true 시 bearish 변환 금지. */
  readonly marketSignal: false;
}

/**
 * Patch-MARKET-PROGRAM-CARRY-WIRING-001 — macroState 4 필드 read 후 carry payload
 * 합성 SSOT.
 *
 * 결정 트리:
 *  1. ENV `MARKET_PROGRAM_CARRY_WIRING_DISABLED === 'true'` → undefined
 *     (호출자가 `marketProgramFlow` 인자를 자연스럽게 미전달 처리)
 *  2. macroState === null / undefined → undefined (preflight context 부재 등)
 *  3. 정상 경로 — 4 필드 모두 propagate, programSource 부재 시 'NONE' fallback +
 *     providerIssue=true 도출
 *
 * `programArbitrageNetBuy: null` (macroState 가 명시적 null 반환) 은 그대로 carry —
 * forensic provider issue 진단이 "차익거래 데이터 명시적 null" vs "필드 부재" 구분.
 */
export function buildMarketProgramFlowCarryPayload(
  macroState:
    | Pick<MacroState, 'programNetBuyAmount' | 'programArbitrageNetBuy' | 'programFetchedAt' | 'programSource'>
    | null
    | undefined,
): MarketProgramFlowCarryPayload | undefined {
  if (isMarketProgramCarryWiringDisabled()) return undefined;
  if (!macroState) return undefined;
  const programSource = macroState.programSource ?? 'NONE';
  return {
    marketProgramNetBuy: macroState.programNetBuyAmount,
    programArbitrageNetBuyAmount: macroState.programArbitrageNetBuy,
    programFetchedAt: macroState.programFetchedAt,
    sourceProvider: programSource,
    providerIssue: programSource === 'NONE',
    executionImpact: 'NONE',
    marketSignal: false,
  };
}
