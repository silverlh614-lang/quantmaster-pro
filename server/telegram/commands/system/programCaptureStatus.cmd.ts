// @responsibility /program_capture_status 텔레그램 명령 — per-stock program auto/manual capture 상태 read-only 진단.

import {
  loadProgramAutoCaptureStatus,
  resolveProgramAutoCaptureManualAvailability,
} from '../../../scheduler/programAutoCaptureJob.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function fmt(value: unknown): string {
  return value === undefined || value === null || value === '' ? 'N/A' : String(value);
}

function registered(command: string): boolean {
  return commandRegistry.resolve(command) !== undefined;
}

function buildProgramCaptureStatusMessage(now = new Date()): string {
  const status = loadProgramAutoCaptureStatus(now);
  const manual = resolveProgramAutoCaptureManualAvailability(now);
  const active = status.schedulerEnabled && !status.disabled;
  return [
    '📡 <b>[Program Capture Status]</b>',
    `상태: ${active ? '🟢 활성' : '🔴 비활성'}`,
    `schedulerEnabled: ${status.schedulerEnabled}`,
    `disabled: ${status.disabled}`,
    `watchlistSize=${status.watchlistSize}`,
    `todayCoverage=${status.todayCoverage}/${status.watchlistSize}`,
    `morningCoverage=${status.morningCoverage}/${status.watchlistSize}`,
    `afternoonCoverage=${status.afternoonCoverage}/${status.watchlistSize}`,
    `latestSnapshotRowsWithValue=${status.latestSnapshotRowsWithValue}`,
    `dailyProviderCalls=${status.dailyProviderCalls}/${status.dailyProviderHardCap}`,
    `nextScheduledCapture=${fmt(status.nextScheduledCapture)}`,
    `mode=${status.mode}`,
    `executionImpact=${status.executionImpact}`,
    '',
    '최근 수집:',
    `오전: ${fmt(status.lastMorningCaptureAt)}`,
    `오후: ${fmt(status.lastAfternoonCaptureAt)}`,
    `마지막 성공: ${status.lastCapturedCount}`,
    `마지막 실패: ${status.lastFailedCount}`,
    `snapshot rows with value: ${status.latestSnapshotRowsWithValue}`,
    '',
    '다음 예정:',
    fmt(status.nextScheduledCapture),
    '',
    '수동 실행:',
    `사용 가능: ${manual.manualRunAvailable}`,
    `manualRunAvailable=${manual.manualRunAvailable}`,
    `manualRunBlockedReason=${fmt(manual.manualRunBlockedReason)}`,
    '명령어: /program_capture_watchlist 또는 /pcw',
    'commandRegistered:',
    `program_capture_watchlist=${registered('/program_capture_watchlist')}`,
    `pcw=${registered('/pcw')}`,
    `program_capture_now=${registered('/program_capture_now')}`,
    `prog_capture=${registered('/prog_capture')}`,
    `currentSession=${manual.currentSession}`,
    `currentKstTime=${manual.currentKstTime}`,
    `currentWindowAllowed=${manual.currentWindowAllowed}`,
    '',
    'Safety:',
    'liveDecision=false',
    'programFlowUsedForLiveDecision=false',
    'passiveProxyUsedForLiveDecision=false',
    'programMissingAsBearish=false',
    'programPenaltyApplied=false',
    'normal_supply_preview_providerCalls=0',
    `executionImpact=${status.executionImpact}`,
  ].join('\n');
}

const programCaptureStatus: TelegramCommand = {
  name: '/program_capture_status',
  aliases: ['/pcs'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '종목별 프로그램매매 자동/수동 수집 상태 확인 (diagnostic-only)',
  usage: '/program_capture_status',
  async execute({ reply }) {
    await reply(buildProgramCaptureStatusMessage());
  },
};

commandRegistry.register(programCaptureStatus);
