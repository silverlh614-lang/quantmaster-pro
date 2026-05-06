// @responsibility AUTO_TRADE_MODE env 직접 참조 위치 정적 분석 표시 P0-A 관측 계측
/**
 * ADR-0391 P0-A §A-3 — `/exec_paths` 텔레그램 명령.
 *
 * 사용자 명시: "Allowed vs Needs migration의 명시적 분리가 결정적 — 모든 env 직접
 * 참조가 결함이 아니라 어떤 것은 정당한 예외임을 명시. P0-B 진행 후 Needs migration
 * 목록이 줄어드는지 즉시 측정 가능".
 *
 * 본 카탈로그는 manual SSOT — P0-A 단계. 후속 PR (P0-B) 머지 시 Needs Migration
 * 목록을 1건씩 Allowed 로 이동하며 *측정 가능한 효과* 검증.
 *
 * 동작 영향 0% — read-only 진단.
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

export interface ExecPathEntry {
  readonly file: string;
  readonly line?: number;
  readonly reason: string;
}

/**
 * Allowed — env 직접 참조가 정당한 위치 SSOT.
 * P0-B (ADR-0392) 후 7 분류:
 *   - state.ts SSOT 내부 (readEnvMode 본체)
 *   - index.ts boot validation/display (시동 검증·시작 메시지)
 *   - bootManifest 스냅샷
 *   - gateAudit.cmd.ts display only (autoTradeMode 표시 라인)
 *   - healthCheckJob.ts display only (진단 메시지 생성)
 */
export const ALLOWED_DIRECT_ACCESS: readonly ExecPathEntry[] = [
  { file: 'server/state.ts', line: 81, reason: 'readEnvMode SSOT 내부' },
  { file: 'server/index.ts', line: 25, reason: 'boot validation (LIVE+KIS_IS_REAL 검증)' },
  { file: 'server/index.ts', line: 37, reason: 'VTS 분기 boot 메시지' },
  { file: 'server/index.ts', line: 534, reason: 'startup 메시지 display only' },
  { file: 'server/persistence/bootManifest.ts', line: 89, reason: '부팅 스냅샷 기록' },
  { file: 'server/telegram/commands/system/gateAudit.cmd.ts', line: 344, reason: 'autoTradeMode display only — formatGateAuditMessage 입력' },
  { file: 'server/scheduler/healthCheckJob.ts', line: 95, reason: '진단 메시지 생성 (display only)' },
];

/**
 * Needs Migration — env 직접 참조 0곳 (ADR-0392 P0-B 완료).
 * 모든 분기 로직은 `getTradingMode()` SSOT 사용.
 * 신규 위반 발견 시 본 카탈로그에 추가 후 마이그레이션 PR 분리.
 */
export const NEEDS_MIGRATION: readonly ExecPathEntry[] = [];

/** 진단 텍스트 — Needs Migration 카운트 기반. */
export function buildExecPathsDiagnosis(needsMigrationCount: number): string {
  return needsMigrationCount > 0
    ? `🚨 SSOT 우회 ${needsMigrationCount}곳 — P0-B 마이그레이션 필요`
    : `✅ 모든 참조 SSOT 통과`;
}

/** 메시지 빌더 SSOT — 단위 테스트 가능. */
export function formatExecPathsMessage(): string {
  const allowedLines = ALLOWED_DIRECT_ACCESS.map(
    r => `  ${r.file}${r.line !== undefined ? `:${r.line}` : ''}\n    └ ${r.reason}`
  ).join('\n');

  // ADR-0392 P0-B 후: NEEDS_MIGRATION 0건 시 ✅ 마커, 1건+ 시 🚨 마커.
  const needsHeaderEmoji = NEEDS_MIGRATION.length > 0 ? '🚨' : '✅';
  const needsLines = NEEDS_MIGRATION.length > 0
    ? NEEDS_MIGRATION.map(
        r => `  ${r.file}${r.line !== undefined ? `:${r.line}` : ''}\n    └ ${r.reason}`,
      ).join('\n')
    : '  (모든 분기 로직 SSOT 통일 완료)';

  return (
    `📋 <b>AUTO_TRADE_MODE Direct References</b>\n\n` +
    `<b>✅ Allowed (${ALLOWED_DIRECT_ACCESS.length}):</b>\n${allowedLines}\n\n` +
    `<b>${needsHeaderEmoji} Needs Migration (${NEEDS_MIGRATION.length}):</b>\n${needsLines}\n\n` +
    `진단: ${buildExecPathsDiagnosis(NEEDS_MIGRATION.length)}`
  );
}

const execPaths: TelegramCommand = {
  name: '/exec_paths',
  aliases: ['/ep'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'AUTO_TRADE_MODE env 직접 참조 위치 정적 분석',
  async execute({ reply }) {
    await reply(formatExecPathsMessage());
  },
};

commandRegistry.register(execPaths);

export default execPaths;
