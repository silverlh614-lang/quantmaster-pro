// @responsibility KIS 시장 프로그램 매매 스냅샷 조립(불변식 판정 포함)과 macroState 영속 섹션
/**
 * programMarketSection.ts — ADR-0595 marketDataRefresh 섹션 모듈 분해.
 *
 * 본체 marketDataRefresh.ts 에서 텍스트 그대로 이동 (byte-equivalent, behavior change 0).
 * KIS 호출은 kisClient 단일 통로(fetchKisMarketProgramTrade) 그대로 경유한다.
 */

import { fetchKisMarketProgramTrade } from '../../clients/kisClient.js';
import { resolveCombinedSource } from '../programMarketSnapshot.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { MarketRefreshComputed, ProgramMarketFinalStatus } from './types.js';
import {
  buildProgramMarketSnapshotId,
  hasSnapshotInvariantViolation,
  formatEokAmount,
  buildUnitCandidates,
  normalizeMarketProgramLeg,
  sumNullablePair,
} from './helpers.js';
import { emitMarketDataProviderWarn } from './refreshObservability.js';

// KIS 시장 종합 프로그램 매매 헬퍼 (호출부 ③-c 섹션 헤더 참조).
// 사용자 12 아이디어 #4 — 시장 단위 프로그램 자금 흐름. KIS 응답은 원 단위 →
// macroState 는 *억원* 환산 (foreignNetBuy5d 등 다른 자금 흐름 필드와 단위 정합).
// 호출 실패 시 programSource='NONE' 마커 + 기존 값 보존 (silent degradation 차단).
type KisMarketProgramTrade = NonNullable<Awaited<ReturnType<typeof fetchKisMarketProgramTrade>>>;

/** outputLength=0 인데 raw/selected/display 값이 남아 있는 leg 불변식 위반 판정 (find 술어 SSOT). */
function hasLegRowInvariantViolation(leg: ReturnType<typeof normalizeMarketProgramLeg>): boolean {
  return (
    leg.outputLength === 0
    && (leg.selectedBsopHour !== null
      || leg.rawWholeNetBuy !== null
      || leg.rawArbitrageNetBuy !== null
      || leg.rawNonArbitrageNetBuy !== null
      || leg.displayWholeNetBuy !== 'N/A')
  ) || (leg.rawWholeNetBuy !== null && leg.outputLength === 0);
}

function computeProgramMarketSnapshot(marketProgram: KisMarketProgramTrade): {
  programMarketSnapshot: NonNullable<MacroState['programMarket']>;
  rawWhole: number; rawArb: number | null; rawNonArb: number | null; rawNonZero: boolean;
  combinedSource: string; splitAvailable: boolean; combinedOnly: boolean; snapshotId: string;
} {
    const rawWhole = marketProgram.programNetBuyAmount as number;
    const rawArb = marketProgram.programArbitrageNetBuy;
    const rawNonArb = marketProgram.programNonArbitrageNetBuy ?? null;
    const rawNonZero = [rawWhole, rawArb, rawNonArb].some((v) => typeof v === 'number' && v !== 0);
    const agg = (marketProgram.aggregateDiagnostic as Record<string, unknown> | undefined) ?? {};
    const bundle = (agg.rowBreakdownBundle as Record<string, unknown> | undefined) ?? {};
    const bk = (bundle.kospi as Record<string, unknown> | undefined) ?? {};
    const bq = (bundle.kosdaq as Record<string, unknown> | undefined) ?? {};
    const bc = (bundle.combined as Record<string, unknown> | undefined) ?? {};
    const kospiLen = Number(bk.outputLength ?? marketProgram.kospiDiagnostics?.rowCount ?? 0);
    const kosdaqLen = Number(bq.outputLength ?? marketProgram.kosdaqDiagnostics?.rowCount ?? 0);
    const kisRawOutput = (((agg as any)?.output as Array<Record<string, unknown>> | undefined) ?? []);
    const combinedLen = Number(bc.outputLength ?? kisRawOutput.length ?? (kospiLen + kosdaqLen));
    const combinedSource = resolveCombinedSource({
      kospiRequested: true, kosdaqRequested: true, kospiOutputLength: kospiLen, kosdaqOutputLength: kosdaqLen,
      combinedOutputLength: combinedLen, combinedMatchesSplit: combinedLen === (kospiLen + kosdaqLen), upstreamHint: String(agg.combinedSource ?? ''),
    });
    const hasSplitRows = (kospiLen + kosdaqLen) > 0 && combinedLen === (kospiLen + kosdaqLen);
    const provisionalSplitAvailable = combinedSource === 'KOSPI_PLUS_KOSDAQ' && hasSplitRows;
    const kospiRows = provisionalSplitAvailable ? (((bundle.kospi as any)?.rows as Array<Record<string, unknown>> | undefined) ?? []) : [];
    const kosdaqRows = provisionalSplitAvailable ? (((bundle.kosdaq as any)?.rows as Array<Record<string, unknown>> | undefined) ?? []) : [];
    const combinedRows = provisionalSplitAvailable
      ? ((((bundle.combined as any)?.rows as Array<Record<string, unknown>> | undefined) ?? [...kospiRows, ...kosdaqRows]))
      : ((((bundle.combined as any)?.rows as Array<Record<string, unknown>> | undefined) ?? kisRawOutput));
    const kospiLeg = normalizeMarketProgramLeg({ rows: kospiRows });
    const kosdaqLeg = normalizeMarketProgramLeg({ rows: kosdaqRows });
    const combinedLeg = normalizeMarketProgramLeg({ rows: combinedRows });
    const combinedWholeNetBuy = sumNullablePair(kospiLeg.rawWholeNetBuy, kosdaqLeg.rawWholeNetBuy);
    const combinedArbitrageNetBuy = sumNullablePair(kospiLeg.rawArbitrageNetBuy, kosdaqLeg.rawArbitrageNetBuy);
    const combinedNonArbitrageNetBuy = sumNullablePair(kospiLeg.rawNonArbitrageNetBuy, kosdaqLeg.rawNonArbitrageNetBuy);
    const invariants = hasSnapshotInvariantViolation({
      kospiLen,
      kosdaqLen,
      combinedLen: combinedLeg.outputLength,
      combinedNonZero: combinedLeg.nonZeroRows,
      combinedSource,
      rawTopFirstBsopHour: String((agg as any)?.firstRowSample?.bsop_hour ?? ''),
      selectedBsopHour: combinedLeg.selectedBsopHour ?? '',
    });
    const rowInvariantViolation = [kospiLeg, kosdaqLeg, combinedLeg].find(hasLegRowInvariantViolation);
    const legInvariantViolated = kospiLeg.invariantViolated || kosdaqLeg.invariantViolated || combinedLeg.invariantViolated || Boolean(rowInvariantViolation);
    const anyInvariantViolated = invariants.violated || legInvariantViolated;
    const legInvariantReason = rowInvariantViolation ? 'RAW_EXISTS_WITH_EMPTY_ROWS' : (kospiLeg.invariantReason ?? kosdaqLeg.invariantReason ?? combinedLeg.invariantReason);
    const finalStatus: ProgramMarketFinalStatus = anyInvariantViolated
      ? 'SNAPSHOT_INCONSISTENT'
      : (provisionalSplitAvailable ? 'OFFICIAL_PARAMS_VERIFIED' : 'SINGLE_RESPONSE_VERIFIED');
    const resolvedCombinedSource = anyInvariantViolated ? 'UNKNOWN' : combinedSource;
    const splitAvailable = !anyInvariantViolated && resolvedCombinedSource === 'KOSPI_PLUS_KOSDAQ';
    const combinedOnly = !splitAvailable;
    const snapshotId = buildProgramMarketSnapshotId();
    const programMarketSnapshot: NonNullable<MacroState['programMarket']> = {
      status: marketProgram.marketProgramStatus ?? 'OK_NONZERO',
      rawStatus: marketProgram.marketProgramStatus ?? 'OK_NONZERO',
      snapshotId,
      finalStatus,
      source: marketProgram.source ?? 'KIS_API',
      paramMode: 'OFFICIAL',
      asOfKst: marketProgram.fetchedAt,
      selectedBsopHour: marketProgram.selectedBsopHour ?? '',
      selectedReason: marketProgram.selectedReason ?? 'LATEST_BY_BSOP_HOUR',
      raw: {
        wholeNetBuyTradeAmount: rawWhole,
        arbitrageNetBuyTradeAmount: rawArb,
        nonArbitrageNetBuyTradeAmount: rawNonArb,
        arbitrageSellAmount: marketProgram.programArbitrageSellAmount ?? null,
        nonArbitrageSellAmount: marketProgram.programNonArbitrageSellAmount ?? null,
        arbitrageBuyAmount: marketProgram.programArbitrageBuyAmount ?? null,
        nonArbitrageBuyAmount: marketProgram.programNonArbitrageBuyAmount ?? null,
      },
      display: {
        wholeNetBuy: formatEokAmount(rawWhole, 'KRW_1K'),
        arbitrageNetBuy: formatEokAmount(rawArb, 'KRW_1K'),
        nonArbitrageNetBuy: formatEokAmount(rawNonArb, 'KRW_1K'),
      },
      unit: { rawUnitAssumption: 'KRW_1K', displayUnit: 'EOK_KRW', mappingConfidence: 'MAPPING_VERIFIED' },
      unitCandidates: buildUnitCandidates(rawWhole),
      policy: {
        scoring: (invariants.violated || legInvariantViolated) ? 'excluded' : 'advisory',
        useForExecution: false,
        useForShadow: true,
        executionImpact: 'NONE',
        providerIssue: false,
        marketSignal: false,
        blockGateUsage: true,
        blockRegimeUsage: true,
      },
      rawNonZero,
      combinedSource: resolvedCombinedSource,
      splitAvailable,
      combinedOnly,
      snapshotMismatch: invariants.snapshotMismatch,
      inconsistencyReason: (invariants.violated || legInvariantViolated) ? (legInvariantReason ?? invariants.reason) : null,
      aggregateDiagnostic: agg as any,
      rowBreakdown: {
        kospi: { outputLength: kospiLeg.outputLength, nonZeroRows: kospiLeg.nonZeroRows, selectedBsopHour: kospiLeg.selectedBsopHour ?? 'N/A', rawWholeNetBuy: kospiLeg.rawWholeNetBuy, rawArbitrageNetBuy: kospiLeg.rawArbitrageNetBuy, rawNonArbitrageNetBuy: kospiLeg.rawNonArbitrageNetBuy, displayWholeNetBuy: kospiLeg.displayWholeNetBuy, unitCandidates: kospiLeg.unitCandidates },
        kosdaq: { outputLength: kosdaqLeg.outputLength, nonZeroRows: kosdaqLeg.nonZeroRows, selectedBsopHour: kosdaqLeg.selectedBsopHour ?? 'N/A', rawWholeNetBuy: kosdaqLeg.rawWholeNetBuy, rawArbitrageNetBuy: kosdaqLeg.rawArbitrageNetBuy, rawNonArbitrageNetBuy: kosdaqLeg.rawNonArbitrageNetBuy, displayWholeNetBuy: kosdaqLeg.displayWholeNetBuy, unitCandidates: kosdaqLeg.unitCandidates },
        combined: {
          outputLength: combinedLeg.outputLength,
          nonZeroRows: combinedLeg.nonZeroRows,
          selectedBsopHour: marketProgram.selectedBsopHour ?? combinedLeg.selectedBsopHour ?? 'N/A',
          rawWholeNetBuy: combinedWholeNetBuy,
          rawArbitrageNetBuy: combinedArbitrageNetBuy,
          rawNonArbitrageNetBuy: combinedNonArbitrageNetBuy,
          displayWholeNetBuy: formatEokAmount(combinedWholeNetBuy, 'KRW_1K'),
          unitCandidates: buildUnitCandidates(combinedWholeNetBuy),
        },
      },
    };
    programMarketSnapshot.snapshotSource = resolvedCombinedSource;
  return { programMarketSnapshot, rawWhole, rawArb, rawNonArb, rawNonZero, combinedSource, splitAvailable, combinedOnly, snapshotId };
}

export async function refreshProgramMarketSection(computed: MarketRefreshComputed): Promise<void> {
  const marketProgram = await fetchKisMarketProgramTrade().catch(() => null);
  if (marketProgram && marketProgram.programNetBuyAmount !== null) {
    const eokwon = marketProgram.programNetBuyAmount / 100_000_000;
    const arbEokwon = marketProgram.programArbitrageNetBuy === null
      ? null
      : marketProgram.programArbitrageNetBuy / 100_000_000;
    computed.programNetBuyAmount = eokwon;
    computed.programArbitrageNetBuy = arbEokwon;
    computed.programFetchedAt = marketProgram.fetchedAt;
    computed.programSource = 'KIS_API';
    const { programMarketSnapshot, rawWhole, rawArb, rawNonArb, rawNonZero, combinedSource, splitAvailable, combinedOnly, snapshotId } = computeProgramMarketSnapshot(marketProgram);
    computed.programMarket = programMarketSnapshot;
    const structured = `snapshotId=${snapshotId} selectedBsopHour=${programMarketSnapshot.selectedBsopHour || 'NONE'} rawWholeNetBuy=${rawWhole} rawArbitrageNetBuy=${rawArb} rawNonArbitrageNetBuy=${rawNonArb} displayWholeNetBuy=${programMarketSnapshot.display.wholeNetBuy} selectedDisplayUnitAssumption=KRW_1K rawUnitAssumption=KRW_1K mappingConfidence=MAPPING_VERIFIED scoring=advisory useForExecution=false useForShadow=true executionImpact=NONE regimeStatus=DECOUPLED programMarketImpact=NONE`;
    console.log(`[PROGRAM_MARKET_KIS_OFFICIAL_VERIFIED] ${structured}`);
    console.log(`[PROGRAM_MARKET_UNIT_UNVERIFIED] ${structured}`);
    console.log(`[PROGRAM_MARKET_MACROSTATE_PERSISTED] ${structured}`);
    if (rawNonZero) console.log(`[PROGRAM_MARKET_RAW_NONZERO_PRESERVED] ${structured}`);
    console.log(`[PROGRAM_MARKET_EXECUTION_IMPACT_NONE] ${structured}`);
    console.log(`[PROGRAM_MARKET_REGIME_DECOUPLED] ${structured}`);
    const srcLog = `kospiOutputLength=${marketProgram.kospiDiagnostics?.rowCount ?? 0} kosdaqOutputLength=${marketProgram.kosdaqDiagnostics?.rowCount ?? 0} combinedOutputLength=${programMarketSnapshot.rowBreakdown?.combined.outputLength ?? 0} combinedSource=${combinedSource} splitAvailable=${splitAvailable} combinedOnly=${combinedOnly} mappingConfidence=${programMarketSnapshot.unit.mappingConfidence} scoring=${programMarketSnapshot.policy.scoring} useForExecution=${programMarketSnapshot.policy.useForExecution} executionImpact=${programMarketSnapshot.policy.executionImpact}`;
    console.log(`[KIS_MARKET_PROGRAM_KOSPI_RESPONSE] ${srcLog}`);
    console.log(`[KIS_MARKET_PROGRAM_KOSDAQ_RESPONSE] ${srcLog}`);
    console.log(`[KIS_MARKET_PROGRAM_COMBINED_SOURCE_RESOLVED] ${srcLog}`);
    if (!splitAvailable) console.log(`[PROGRAM_MARKET_SPLIT_UNAVAILABLE] ${srcLog}`);
    if (programMarketSnapshot.unit.mappingConfidence === 'UNIT_UNVERIFIED' || combinedSource === 'UNKNOWN') console.log(`[PROGRAM_MARKET_SIGNAL_CANDIDATE_ONLY] ${srcLog}`);
    console.log(
      `[MarketRefresh] KIS 시장 프로그램 매매: ` +
      `${eokwon >= 0 ? '+' : ''}${eokwon.toFixed(1)}억원` +
      (arbEokwon !== null ? ` (차익 ${arbEokwon >= 0 ? '+' : ''}${arbEokwon.toFixed(1)}억원)` : ' (차익 미수집)'),
    );
  } else {
    computed.programSource = 'NONE';
    emitMarketDataProviderWarn('PROGRAM_TRADING_QUERY_FAILED', {
      programSource: 'NONE',
      carryForward: true,
    });
  }
}
