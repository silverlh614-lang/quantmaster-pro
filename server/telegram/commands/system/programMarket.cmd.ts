// @responsibility programMarket.cmd 텔레그램 모듈
// @responsibility: /program_market — KIS 시장 종합 프로그램 매매 추이 진단. SYS ADMIN read-only KIS 1회.
//
// ADR-0138 — 코스피 시장 단위 프로그램 자금 흐름. ADR-0137 (/program_today) 종목 단위와 별도.
// 운영자가 macroState 영속 값 + 직전 KIS 응답을 비교 진단 가능.

import { fetchKisMarketProgramTrade } from '../../../clients/kisClient/index.js';
import { diagnoseKisMarketProgramRaw } from '../../../clients/kisClient/supplyDiagnostics.js';
import { MARKET_PROGRAM_INDEX_CODE } from '../../../clients/kisClient/programMaterializer.js';
import { routeProgramMarketEmptyWithKrxAggregate } from '../../../clients/krxClient/programMarketRouterPatch006.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { captureLatestIntradayProgramFlowSnapshotFromRuntimeContext } from '../../../replay/intradayProgramFlowSnapshotRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

/** 억원 변환 — ADR-0137 패턴 차용. 음수 부호 보존, 소수점 1자리. */
function formatKrwInEokwon(amountWon: number | null | undefined): string {
  if (amountWon === null || amountWon === undefined || !Number.isFinite(amountWon)) return 'N/A';
  const eokwon = amountWon / 100_000_000;
  if (amountWon !== 0 && Math.abs(eokwon) < 0.01) return '0.01억원 미만';
  if (amountWon !== 0 && eokwon.toFixed(2) === '0.00') return `약 0억원(raw: ${amountWon})`;
  const sign = eokwon > 0 ? '+' : '';
  return `${sign}${eokwon.toFixed(2)}억원`;
}

/** macroState 영속값(이미 억원 단위) 포맷. */
function formatEokwonSaved(eokwon: number | null | undefined): string {
  if (eokwon === null || eokwon === undefined || !Number.isFinite(eokwon)) return 'N/A';
  if (Math.abs(eokwon) < 0.05) return '0억원';
  const sign = eokwon > 0 ? '+' : '';
  return `${sign}${eokwon.toFixed(1)}억원`;
}


function isDisplayRoundedZero(display: string): boolean {
  const v = display.trim();
  return v === '0억원' || v === '+0.00억원' || v === '-0.00억원';
}

function hasRawNonZeroValue(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

function isAcceptedEmptyMarketProgram(live: Awaited<ReturnType<typeof fetchKisMarketProgramTrade>>): boolean {
  if (!live) return false;
  const status = live.marketProgramStatus ?? '';
  const zeroReason = live.zeroReason ?? live.selectedReason ?? '';
  return status === 'OK_EMPTY_OUTPUT'
    || zeroReason === 'ACCEPTED_EMPTY'
    || zeroReason === 'EMPTY_OUTPUT'
    || zeroReason === 'OUTPUT_EMPTY'
    || live.rowCount === 0;
}

type LiveMarketProgramTrade = NonNullable<Awaited<ReturnType<typeof fetchKisMarketProgramTrade>>>;

function appendProgramMarketHeader(lines: string[]): void {
  lines.push('📊 <b>[Market Program]</b> (시장 종합 프로그램 매매)');
  lines.push('');
}

function appendProgramMarketKisFailureLines(lines: string[]): void {
  lines.push('🟡 KIS 실시간 조회 실패');
  lines.push('');
  lines.push('💡 <i>운영자 안내</i>:');
  lines.push('  • <code>KIS_APP_KEY</code> 또는 실계좌 클라이언트 미설정 가능성');
  lines.push('  • KIS 회로차단 활성 또는 24h 블랙리스트 가능성');
  lines.push('  • TR ID 검증 — <code>KIS_MARKET_PROGRAM_TRADE_TR_ID</code> ENV 우회');
  lines.push('  • Path 검증 — <code>KIS_MARKET_PROGRAM_TRADE_PATH</code> ENV 우회');
}

async function appendAcceptedEmptyProgramMarketDiagnostic(
  lines: string[],
  live: LiveMarketProgramTrade,
): Promise<void> {
  const rawDiag = await diagnoseKisMarketProgramRaw('LOW');
  const decision = await routeProgramMarketEmptyWithKrxAggregate({
    rawDiag: {
      zeroReason: rawDiag.zeroReason ?? live.zeroReason ?? 'ACCEPTED_EMPTY',
      outputLength: rawDiag.outputKeys?.length ?? live.rowCount ?? 0,
      outputKeys: rawDiag.outputKeys,
      marketCode: MARKET_PROGRAM_INDEX_CODE,
      trId: rawDiag.trId,
      endpoint: rawDiag.path,
    },
  });
  const compactSource = decision.routedStatus === 'SHAPE_CANDIDATE' ? 'KRX' : decision.source;
  const compactReason = decision.routedStatus === 'SHAPE_CANDIDATE'
    ? 'KRX intraday shape candidate (observe only)'
    : decision.routedStatus === 'UNSUPPORTED_INTRADAY'
      ? 'KIS accepted empty + KRX intraday empty'
      : decision.decisionDetail;
  lines.push('4. ⚪ 시장 프로그램매매');
  lines.push(`  status: ${decision.routedStatus}`);
  lines.push(`  source: ${compactSource}`);
  lines.push(`  reason: ${compactReason}`);
  lines.push(`  scoring: ${decision.scoring}`);
  lines.push(`  action: ${decision.routedStatus === 'PARAM_MISMATCH' ? 'fix_params' : 'observe'}`);
  lines.push('  providerIssue: false');
  lines.push('  marketSignal: false');
  lines.push('  executionImpact: NONE');
  lines.push('  detail: /program_market_raw');
  lines.push('');
}

function appendProgramMarketFetchedAt(lines: string[], fetchedAt: string): void {
  try {
    const kst = new Date(fetchedAt);
    lines.push(`⏱️ 응답 시각 (KST): ${kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}`);
  } catch {
    lines.push(`⏱️ 응답 시각: ${fetchedAt}`);
  }
}

function appendProgramMarketStatusLines(
  lines: string[],
  live: LiveMarketProgramTrade,
  status: string,
  statusEmoji: string,
): void {
  lines.push('programMarketImpact: NONE');
  lines.push(`rawStatus: ${status}`);
  lines.push(`source: ${live.source ?? 'KIS_API'}`);
  lines.push(`latest: ${live.latest ?? 'N/A'}`);
  lines.push(`updated: ${live.updated ?? 'N/A'}`);
  const liveQty = live.programNetBuyQty ?? live.programNetBuyAmount ?? 0;
  const macro = loadMacroState();
  const finalStatus = (macro?.programMarket as any)?.finalStatus ?? 'UNKNOWN';
  const combinedSource = finalStatus === 'SNAPSHOT_INCONSISTENT' ? 'UNKNOWN' : (macro?.programMarket?.combinedSource ?? 'UNKNOWN');
  const displayStatus = finalStatus === 'UNKNOWN'
    ? (status === 'OK_NONZERO' ? 'OFFICIAL_PARAMS_VERIFIED' : status)
    : finalStatus;
  const snapshotId = (macro?.programMarket as any)?.snapshotId;
  const mappingConfidence = macro?.programMarket?.unit?.mappingConfidence ?? 'UNIT_UNVERIFIED';
  const isCandidateOnly = mappingConfidence === 'UNIT_UNVERIFIED' || combinedSource === 'UNKNOWN';
  const qtyEmoji = isCandidateOnly ? '🟡' : liveQty > 0 ? '🟢' : liveQty < 0 ? '🔴' : '⚪';
  const qtyLabel = isCandidateOnly
    ? `시장 프로그램 방향 후보: ${liveQty > 0 ? '순매수' : liveQty < 0 ? '순매도' : '중립'}`
    : (liveQty > 0 ? '시장 프로그램 순매수' : liveQty < 0 ? '시장 프로그램 순매도' : '중립');
  if (finalStatus !== 'SNAPSHOT_INCONSISTENT') {
    lines.push(`${qtyEmoji} ${qtyLabel}: ${formatKrwInEokwon(live.programNetBuyAmount)}`);
    lines.push(`selectedNetBuy: ${formatKrwInEokwon(live.programNetBuyAmount)}`);
  }
  lines.push(`selectedReason: ${live.selectedReason ?? 'N/A'}`);
  lines.push(`${statusEmoji} displayStatus: ${displayStatus}`);
  lines.push(`finalStatus: ${displayStatus}`);
  lines.push(`scoring: ${finalStatus === 'SNAPSHOT_INCONSISTENT' ? 'excluded' : 'advisory'}`);
  if (isCandidateOnly) {
    lines.push(`confidence: LOW`);
    const sourceLabel = combinedSource === 'KOSPI_PLUS_KOSDAQ'
      ? 'SOURCE_KOSPI_PLUS_KOSDAQ'
      : combinedSource === 'SINGLE_KIS_RESPONSE'
        ? 'SINGLE_KIS_RESPONSE'
        : combinedSource === 'CACHE'
          ? 'SOURCE_CACHE'
          : 'SOURCE_UNKNOWN';
    const reasonSource = finalStatus === 'SNAPSHOT_INCONSISTENT' ? 'SNAPSHOT_INCONSISTENT' : sourceLabel;
    lines.push(`reason: ${mappingConfidence === 'UNIT_UNVERIFIED' ? 'UNIT_UNVERIFIED' : 'MAPPING_VERIFIED'} + ${reasonSource}`);
  }
  lines.push('executionImpact: NONE');
  lines.push('useForExecution: false');
  lines.push('useForShadow: true');
  const combinedRows = macro?.programMarket?.rowBreakdown?.combined;
  if (combinedRows) {
    lines.push(`nonZeroRows: ${combinedRows.nonZeroRows}/${combinedRows.outputLength}`);
  } else if (live.rowCount !== undefined || live.nonZeroRowCount !== undefined) {
    lines.push(`nonZeroRows: ${live.nonZeroRowCount ?? 0}/${live.rowCount ?? 0}`);
  }
  if (status === 'OK_NONZERO') {
    lines.push('zeroReason: NON_ZERO');
  } else if (live.zeroReason) {
    lines.push(`zeroReason: ${live.zeroReason}`);
  }
  lines.push(`providerIssue=${live.providerIssue ?? false}`);
  lines.push(`executionImpact=${live.executionImpact ?? 'NONE'}`);
  lines.push(`판정: ${finalStatus === 'SNAPSHOT_INCONSISTENT' ? 'observe only' : (status === 'OK_NONZERO' ? 'usable' : 'observe / scoring excluded')}`);
  if (finalStatus !== 'SNAPSHOT_INCONSISTENT') lines.push(`selectedPath: ${live.selectedPath ?? 'N/A'}`);
}

function appendProgramMarketArbitrageLines(lines: string[], live: LiveMarketProgramTrade): void {
  if (live.programArbitrageNetBuy !== null) {
    lines.push(`📈 차익거래 순매수: ${formatKrwInEokwon(live.programArbitrageNetBuy)}`);
  } else {
    lines.push(`📈 차익거래 순매수: <i>미수집</i> (KIS 응답 부재)`);
  }
}

async function appendLiveProgramMarketLines(lines: string[], live: LiveMarketProgramTrade): Promise<void> {
  captureMarketProgramSnapshotBestEffort(live);
  const status = live.marketProgramStatus ?? (live.programNetBuyAmount === 0 ? 'OK_RAW_ZERO' : 'OK_NONZERO');
  const statusEmoji = status === 'OK_NONZERO' ? '🟢' : status === 'PROVIDER_ERROR' ? '🟡' : '⚪';

  lines.push('📡 <b>실시간 (KIS 직접 호출)</b>');
  if (isAcceptedEmptyMarketProgram(live)) {
    await appendAcceptedEmptyProgramMarketDiagnostic(lines, live);
  }
  appendProgramMarketStatusLines(lines, live, status, statusEmoji);
  appendProgramMarketArbitrageLines(lines, live);
  appendProgramMarketFetchedAt(lines, live.fetchedAt);
}

function appendMacroProgramFetchedAt(lines: string[], fetchedAt: string): void {
  try {
    const kst = new Date(fetchedAt);
    lines.push(`  • 수집 시각 (KST): ${kst.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}`);
  } catch {
    lines.push(`  • 수집 시각: ${fetchedAt}`);
  }
}

function appendMacroProgramMarketLines(lines: string[], macro: ReturnType<typeof loadMacroState>): void {
  lines.push('');
  lines.push('💾 <b>macroState 영속 (직전 cron)</b>');
  if (macro?.programSource === 'KIS_API' && macro.programNetBuyAmount !== undefined) {
    const display = macro.programMarket?.display;
    const raw = macro.programMarket?.raw;
    const summaryWhole = display?.wholeNetBuy ?? formatEokwonSaved(macro.programNetBuyAmount);
    const summaryArb = display?.arbitrageNetBuy ?? (macro.programArbitrageNetBuy === null ? '미수집' : formatEokwonSaved(macro.programArbitrageNetBuy));
    const summaryNonArb = display?.nonArbitrageNetBuy;
    lines.push(`  • 순매수: ${summaryWhole}`);
    lines.push(`  • 차익: ${summaryArb}`);
    if (summaryNonArb) lines.push(`  • 비차익: ${summaryNonArb}`);
    const rawNonZeroWarning = (hasRawNonZeroValue(raw?.wholeNetBuyTradeAmount) && isDisplayRoundedZero(summaryWhole))
      || (hasRawNonZeroValue(raw?.arbitrageNetBuyTradeAmount) && isDisplayRoundedZero(summaryArb))
      || (hasRawNonZeroValue(raw?.nonArbitrageNetBuyTradeAmount) && Boolean(summaryNonArb) && isDisplayRoundedZero(summaryNonArb));
    if (rawNonZeroWarning) lines.push('  • rawNonZeroWarning: true');
    if (macro.programFetchedAt) {
      appendMacroProgramFetchedAt(lines, macro.programFetchedAt);
    }
    if (macro.programMarket) {
      lines.push(`  • snapshotId: ${(macro.programMarket as any).snapshotId ?? 'N/A'}`);
      lines.push(`  • combinedSource: ${macro.programMarket.combinedSource ?? 'UNKNOWN'}`);
      lines.push(`  • splitAvailable: ${macro.programMarket.splitAvailable ?? false}`);
      lines.push(`  • combinedOnly: ${macro.programMarket.combinedOnly ?? true}`);
      lines.push(`  • splitAvailable: ${macro.programMarket.splitAvailable ?? false}`);
      if (macro.programMarket.rowBreakdown) {
        lines.push(`  • combined rows: ${macro.programMarket.rowBreakdown.combined.outputLength}`);
        if (macro.programMarket.splitAvailable) {
          lines.push(`  • KOSPI rows: ${macro.programMarket.rowBreakdown.kospi.outputLength}`);
          lines.push(`  • KOSDAQ rows: ${macro.programMarket.rowBreakdown.kosdaq.outputLength}`);
        } else {
          lines.push('  • KOSPI rows: N/A (split unavailable)');
          lines.push('  • KOSDAQ rows: N/A (split unavailable)');
        }
      }
    }
    if (macro.programMarket?.raw) {
      lines.push(`  • raw whole: ${macro.programMarket.raw.wholeNetBuyTradeAmount ?? 'N/A'}`);
      lines.push(`  • raw arbitrage: ${macro.programMarket.raw.arbitrageNetBuyTradeAmount ?? 'N/A'}`);
      lines.push(`  • raw nonArbitrage: ${macro.programMarket.raw.nonArbitrageNetBuyTradeAmount ?? 'N/A'}`);
      lines.push(`  • display whole: ${macro.programMarket.display.wholeNetBuy}`);
      lines.push(`  • unitAssumption: ${macro.programMarket.unit.rawUnitAssumption}`);
      lines.push(`  • mappingConfidence: ${macro.programMarket.unit.mappingConfidence}`);
      if (macro.programMarket.unit.mappingConfidence === 'MAPPING_VERIFIED') {
        lines.push('  • 단위: 천원 기준 확정');
        lines.push('  • 표시: 억원 환산');
      }
      if (macro.programMarket.unit.rawUnitAssumption === 'UNVERIFIED' && macro.programMarket.unitCandidates) {
        lines.push('  • 단위 후보:');
        lines.push(`    - 원 기준: ${macro.programMarket.unitCandidates.KRW}`);
        lines.push(`    - 천원 기준: ${macro.programMarket.unitCandidates.KRW_1K}`);
        lines.push(`    - 백만원 기준: ${macro.programMarket.unitCandidates.KRW_1M}`);
        lines.push('    현재 적용: UNVERIFIED / shadow_only');
      }
    }
  } else if (macro?.programSource === 'NONE') {
    lines.push('  • <i>마지막 cron 사이클 KIS 호출 실패</i>');
  } else {
    lines.push('  • <i>미수집</i> (cron 1회 미실행 또는 KIS 미연동)');
  }
}

/**
 * /program_market 메시지 빌더 SSOT (단위 테스트 가능).
 *
 * 단계:
 *   1. KIS 단발성 호출 (실시간 데이터)
 *   2. macroState 영속값 로드 (직전 cron 갱신 결과)
 *   3. 두 값 비교 진단 — 불일치 시 운영자 인지
 */
export async function buildProgramMarketMessage(): Promise<string> {
  const live = await fetchKisMarketProgramTrade();
  const macro = loadMacroState();

  const lines: string[] = [];
  appendProgramMarketHeader(lines);

  if (live === null) {
    appendProgramMarketKisFailureLines(lines);
  } else {
    await appendLiveProgramMarketLines(lines, live);
  }

  appendMacroProgramMarketLines(lines, macro);

  return lines.join('\n');
}

function captureMarketProgramSnapshotBestEffort(
  live: LiveMarketProgramTrade,
): void {
  captureLatestIntradayProgramFlowSnapshotFromRuntimeContext({
    marketProgram: {
      ...live,
      marketProgramNetBuy: live.programNetBuyAmount,
      combinedProgramNetBuy: live.programNetBuyAmount,
      sourceProvider: live.source,
      dataStatus: live.marketProgramStatus === 'PROVIDER_ERROR' ? 'UNKNOWN' : 'VERIFIED',
      providerIssue: live.providerIssue === true,
      marketSignal: live.programNetBuyAmount !== null && live.providerIssue !== true,
      capturedAt: live.fetchedAt,
      reason: live.programNetBuyAmount === null ? 'PROGRAM_VALUE_NULL' : 'PROGRAM_FLOW_AVAILABLE_DIAGNOSTIC_ONLY',
    },
  });
}

const programMarket: TelegramCommand = {
  name: '/program_market',
  aliases: ['/prog_market', '/pm'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS 시장 종합 프로그램 매매 추이 진단 (ADR-0138, 코스피 시장 단위)',
  usage: '/program_market',
  async execute({ reply }) {
    try {
      const message = await buildProgramMarketMessage();
      await reply(message);
    } catch (err) {
      console.error('[programMarket.cmd] failed', err);
      await reply('❌ 시장 프로그램 매매 진단 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(programMarket);

export default programMarket;
