// @responsibility 모드별 기대 vs 실제 행동 결과 행렬 자동 진단 P0-A 관측 계측
/**
 * ADR-0391 P0-A §A-2 — `/exec_matrix` 텔레그램 명령.
 *
 * 사용자 명시: "기대와 실제의 괴리 자체가 가장 강력한 진단 신호".
 *
 * 모드별 *Expected vs Actual 7d* 결과 행렬 + 자동 진단 텍스트 생성.
 * executionStatsSsot 의 5분류 통계 + buildExecutionDiagnosis 의 4 패턴 활용.
 *
 * 동작 영향 0% — read-only 진단.
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getTradingMode } from '../../../state.js';
import {
  compute7dExecutionStats,
  buildExecutionDiagnosis,
  type ExecutionStats7d,
} from '../../../persistence/executionStatsSsot.js';

export interface ExecMatrixExpected {
  readonly shadowRecorded: boolean;
  readonly paperBuy: boolean;
  readonly liveOrder: boolean;
}

/** 모드별 기대 행동 SSOT — 분기 우선순위. */
export function buildExpectedBehavior(mode: 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL'): ExecMatrixExpected {
  return {
    shadowRecorded: true,             // 모든 모드 always-on (P1 wiring 후 강제, P0-A 단계 명세)
    paperBuy: mode === 'PAPER',
    liveOrder: mode === 'LIVE',
  };
}

/** 메시지 빌더 SSOT — 단위 테스트 가능. */
export function formatExecMatrixMessage(input: {
  readonly mode: 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL';
  readonly expected: ExecMatrixExpected;
  readonly actual: ExecutionStats7d;
  readonly diagnosis: readonly string[];
}): string {
  const { mode, expected, actual, diagnosis } = input;
  return (
    `📊 <b>Execution Matrix (7d)</b>\n\n` +
    `Mode: ${mode}\n\n` +
    `<b>Expected:</b>\n` +
    `  shadowRecorded: ${expected.shadowRecorded ? 'YES' : 'NO'}\n` +
    `  paperBuy: ${expected.paperBuy ? 'YES' : 'NO'}\n` +
    `  liveOrder: ${expected.liveOrder ? 'YES' : 'NO'}\n\n` +
    `<b>Actual:</b>\n` +
    `  evaluated: ${actual.evaluated}\n` +
    `  shadowRecorded: ${actual.shadowRecorded}\n` +
    `  paperBuy: ${actual.paperBuyRecorded}\n` +
    `  liveOrderSent: ${actual.liveOrderSent}\n` +
    `  liveBlocked: ${actual.liveBlocked}\n` +
    `  ghost: ${actual.ghost}\n\n` +
    `<b>Diagnosis:</b>\n${diagnosis.map(d => `  ${d}`).join('\n')}\n\n` +
    `※ paperBuy/liveBlocked 카운트는 P0-A placeholder. P1 ExecutionMode 도입 후 활성화.`
  );
}

const execMatrix: TelegramCommand = {
  name: '/exec_matrix',
  aliases: ['/em'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '7일 모드별 Expected vs Actual 결과 행렬 + 자동 진단',
  async execute({ reply }) {
    const mode = getTradingMode();
    const expected = buildExpectedBehavior(mode);
    const actual = compute7dExecutionStats();
    const diagnosis = buildExecutionDiagnosis({ stats: actual, mode });

    const message = formatExecMatrixMessage({ mode, expected, actual, diagnosis });
    await reply(message);
  },
};

commandRegistry.register(execMatrix);
