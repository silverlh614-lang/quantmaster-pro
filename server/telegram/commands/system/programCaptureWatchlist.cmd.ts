// @responsibility /program_capture_watchlist Telegram command - manual run-now diagnostic program capture.

import {
  resolveProgramAutoCaptureManualAvailability,
  runProgramAutoCaptureManual,
  type ProgramAutoCaptureRunSummary,
  type ProgramAutoCaptureTargetMode,
} from '../../../scheduler/programAutoCaptureJob.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 15;

interface ParsedProgramCaptureArgs {
  limit: number;
  targetMode: ProgramAutoCaptureTargetMode;
  unsupportedForce: boolean;
}

export function parseProgramCaptureWatchlistArgs(args: string[]): ParsedProgramCaptureArgs {
  let limit = DEFAULT_LIMIT;
  let targetMode: ProgramAutoCaptureTargetMode = 'DEFAULT';
  let unsupportedForce = false;

  for (const raw of args) {
    const token = String(raw ?? '').trim().toLowerCase();
    if (!token) continue;
    if (token === '--force' || token === 'force') {
      unsupportedForce = true;
      continue;
    }
    if (/^\d+$/.test(token)) {
      limit = Math.max(1, Math.min(MAX_LIMIT, Number.parseInt(token, 10)));
      continue;
    }
    if (token === 'bearish' || token === 'bear') {
      targetMode = 'BEARISH';
      continue;
    }
    if (token === 'accumulating' || token === 'accum' || token === 'accumulate') {
      targetMode = 'ACCUMULATING';
    }
  }

  return { limit, targetMode, unsupportedForce };
}

export async function buildProgramCaptureWatchlistMessage(args: string[], now = new Date()): Promise<string> {
  const parsed = parseProgramCaptureWatchlistArgs(args);
  const availability = resolveProgramAutoCaptureManualAvailability(now);

  if (parsed.unsupportedForce) {
    return [
      '📡 <b>[Program Capture Watchlist]</b>',
      'mode=MANUAL_RUN_NOW',
      '실행 차단: --force 옵션은 이번 패치에서 지원하지 않습니다.',
      `session=${availability.currentSession}`,
      `time=${availability.currentKstTime} KST`,
      'executionImpact=NONE',
    ].join('\n');
  }

  if (!availability.manualRunAvailable) {
    return [
      '📡 <b>[Program Capture Watchlist]</b>',
      'mode=MANUAL_RUN_NOW',
      `session=${availability.currentSession}`,
      `time=${availability.currentKstTime} KST`,
      `currentWindowAllowed=${availability.currentWindowAllowed}`,
      `blockedReason=${availability.manualRunBlockedReason ?? 'UNKNOWN'}`,
      'executionImpact=NONE',
      '',
      'nextAction=09:10~15:20 KST 정규장에 다시 실행',
    ].join('\n');
  }

  const summary = await runProgramAutoCaptureManual({
    limit: parsed.limit,
    targetMode: parsed.targetMode,
  }, now);
  return formatProgramCaptureWatchlistSummary(summary);
}

function formatProgramCaptureWatchlistSummary(summary: ProgramAutoCaptureRunSummary): string {
  return [
    '📡 <b>[Program Capture Watchlist]</b>',
    `mode=${summary.mode}`,
    `session=${summary.session}`,
    `time=${summary.kstTime} KST`,
    `limit=${summary.limit}`,
    `targetMode=${summary.targetMode}`,
    `target=${summary.target}`,
    `captured=${summary.captured}`,
    `emptyValid=${summary.emptyValid}`,
    `failed=${summary.failed}`,
    `cooldownSkipped=${summary.cooldownSkipped}`,
    `providerCallsAdded=${summary.providerCallsAdded}`,
    `latestSnapshotRowsWithValue=${summary.snapshotRowsWithValue}`,
    `executionImpact=${summary.executionImpact}`,
    '',
    'Top Program Buy:',
    formatProgramRows(summary.topProgramBuy),
    '',
    'Top Program Sell:',
    formatProgramRows(summary.topProgramSell),
    '',
    'Safety:',
    'programFlowUsedForLiveDecision=false',
    'passiveProxyUsedForLiveDecision=false',
    'programMissingAsBearish=false',
    'programPenaltyApplied=false',
    'normal_supply_preview_providerCalls=0',
    '',
    'nextAction=/normal_supply_preview full',
  ].join('\n');
}

function formatProgramRows(rows: Array<{ symbol: string; name?: string; programNetBuyAmount: number }>): string {
  if (rows.length === 0) return '없음';
  return rows.map((row, index) => (
    `${index + 1}. ${row.symbol} ${row.name ?? ''} ${formatAmount(row.programNetBuyAmount)}`.trim()
  )).join('\n');
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return 'N/A';
  const eok = amount / 100_000_000;
  const sign = eok > 0 ? '+' : '';
  const rounded = Math.abs(eok) >= 10 ? Math.round(eok).toLocaleString('ko-KR') : eok.toFixed(1);
  return `${sign}${rounded}억`;
}

const programCaptureWatchlist: TelegramCommand = {
  name: '/program_capture_watchlist',
  aliases: ['/prog_capture', '/pcw', '/program_capture_now'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '종목별 프로그램매매 watchlist 수동 즉시 수집 (diagnostic-only)',
  usage: '/program_capture_watchlist [limit|bearish|accumulating]',
  async execute({ args, reply }) {
    try {
      await reply(await buildProgramCaptureWatchlistMessage(args));
    } catch (error) {
      console.error('[programCaptureWatchlist.cmd] failed', error);
      await reply([
        '📡 <b>[Program Capture Watchlist]</b>',
        '❌ 수동 프로그램 수집 실패',
        `reason=${error instanceof Error ? error.message : String(error)}`,
        'executionImpact=NONE',
      ].join('\n'));
    }
  },
};

commandRegistry.register(programCaptureWatchlist);

export default programCaptureWatchlist;
