// @responsibility /program_capture_status 텔레그램 명령 — per-stock program auto capture scheduler 상태 read-only 진단.

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { loadProgramAutoCaptureStatus } from '../../../scheduler/programAutoCaptureJob.js';

function fmt(value: unknown): string {
  return value === undefined || value === null || value === '' ? 'N/A' : String(value);
}

export function buildProgramCaptureStatusMessage(now = new Date()): string {
  const status = loadProgramAutoCaptureStatus(now);
  return [
    '📡 <b>[Program Capture Status]</b>',
    `schedulerEnabled=${status.schedulerEnabled}`,
    `disabled=${status.disabled}`,
    `lastMorningCaptureAt=${fmt(status.lastMorningCaptureAt)}`,
    `lastAfternoonCaptureAt=${fmt(status.lastAfternoonCaptureAt)}`,
    `lastCapturedCount=${status.lastCapturedCount}`,
    `lastFailedCount=${status.lastFailedCount}`,
    `latestSnapshotRowsWithValue=${status.latestSnapshotRowsWithValue}`,
    `nextScheduledCapture=${fmt(status.nextScheduledCapture)}`,
    `executionImpact=${status.executionImpact}`,
    '',
    'Safety:',
    'programFlowUsedForLiveDecision=false',
    'passiveProxyUsedForLiveDecision=false',
    'programMissingAsBearish=false',
    'programPenaltyApplied=false',
    'normal_supply_preview_providerCalls=0',
  ].join('\n');
}

const programCaptureStatus: TelegramCommand = {
  name: '/program_capture_status',
  aliases: ['/pcs'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '종목별 프로그램매매 자동 수집 상태 확인 (diagnostic-only)',
  usage: '/program_capture_status',
  async execute({ reply }) {
    await reply(buildProgramCaptureStatusMessage());
  },
};

commandRegistry.register(programCaptureStatus);

export default programCaptureStatus;
