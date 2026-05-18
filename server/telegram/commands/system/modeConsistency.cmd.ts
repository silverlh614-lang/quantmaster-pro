// @responsibility mode 일관성 진단 env runtime killSwitch 비교 P0-A 관측 계측
/**
 * ADR-0391 P0-A §A-1 — `/mode_consistency` 텔레그램 명령.
 *
 * env vs runtime vs killSwitch 3-way 일관성 진단. 동작 영향 0% — read-only.
 *
 * 일관성 분류 3분기:
 *   - CONSISTENT          : env === runtime (정상)
 *   - INTENDED_OVERRIDE   : killSwitch.to === runtime (의도된 강등)
 *   - UNINTENDED_DIVERGENCE : 그 외 (즉시 동기화 필요)
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { getTradingMode, getKillSwitchLast } from '../../../state.js';
import { resolveMarketState } from '../../../trading/marketStateResolver.js';

export type ModeConsistencyState = 'CONSISTENT' | 'INTENDED_OVERRIDE' | 'UNINTENDED_DIVERGENCE';

export interface ModeConsistencyInputs {
  readonly envMode: string;
  readonly runtimeMode: 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL';
  readonly isReal: boolean;
  readonly killSwitch: ReturnType<typeof getKillSwitchLast>;
  readonly macroReleaseBlock?: {
    message: string;
    ageSec?: number;
    lastRefreshAttemptAt?: string;
    refreshJobLastRunAt?: string;
  };
}

/** 분류 SSOT — ENV/runtime/killSwitch 비교 우선순위. */
export function classifyModeConsistency(input: ModeConsistencyInputs): ModeConsistencyState {
  if (input.envMode.toUpperCase() === input.runtimeMode) return 'CONSISTENT';
  if (input.killSwitch && input.killSwitch.to === input.runtimeMode) return 'INTENDED_OVERRIDE';
  return 'UNINTENDED_DIVERGENCE';
}

/** 메시지 빌더 SSOT — 단위 테스트 가능. */
export function formatModeConsistencyMessage(input: ModeConsistencyInputs): string {
  const liveOrderPossible = input.runtimeMode === 'LIVE' && input.isReal;
  const state = classifyModeConsistency(input);

  const verdict =
    state === 'UNINTENDED_DIVERGENCE'
      ? '🚨 즉시 동기화 필요'
      : state === 'INTENDED_OVERRIDE'
        ? '⚠️ 의도된 강등 — 운영자 확인 권고'
        : '✅ 정상';

  const killSwitchSection = input.killSwitch
    ? `Kill switch:\n  ${input.killSwitch.from} → ${input.killSwitch.to}\n  reason: ${input.killSwitch.reason}\n  at: ${input.killSwitch.at}\n\n`
    : 'Kill switch: 없음\n\n';

  const macroBlockSection = input.macroReleaseBlock
    ? `Macro release block:\n  ${input.macroReleaseBlock.message}\n  ageSec: ${input.macroReleaseBlock.ageSec ?? 'N/A'}\n  lastRefreshAttemptAt: ${input.macroReleaseBlock.lastRefreshAttemptAt ?? 'N/A'}\n  refreshJobLastRunAt: ${input.macroReleaseBlock.refreshJobLastRunAt ?? 'N/A'}\n\n`
    : '';

  return (
    `🔍 <b>Mode Consistency</b>\n\n` +
    `env AUTO_TRADE_MODE: ${input.envMode}\n` +
    `runtime tradingMode: ${input.runtimeMode}\n` +
    `KIS_IS_REAL: ${input.isReal}\n` +
    `Live order possible: ${liveOrderPossible}\n\n` +
    killSwitchSection +
    macroBlockSection +
    `상태: ${state}\n${verdict}`
  );
}

const modeConsistency: TelegramCommand = {
  name: '/mode_consistency',
  aliases: ['/mc'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Mode 일관성 진단 — env/runtime/killSwitch 비교',
  async execute({ reply }) {
    const envMode = process.env.AUTO_TRADE_MODE ?? 'SHADOW';
    const runtimeMode = getTradingMode();
    const killSwitch = getKillSwitchLast();
    const isReal = process.env.KIS_IS_REAL === 'true';

    const marketState = resolveMarketState();
    const macroReleaseBlock = marketState.macroState.freshness === 'HARD_STALE'
      ? {
        message: 'MHS는 회복권이나 Macro snapshot이 HARD_STALE이라 R6 해제를 보류합니다.',
        ageSec: marketState.macroState.ageSec,
        lastRefreshAttemptAt: marketState.macroState.lastRefreshAttemptAt,
        refreshJobLastRunAt: marketState.macroState.refreshJobLastRunAt,
      }
      : undefined;

    const message = formatModeConsistencyMessage({
      envMode,
      runtimeMode,
      isReal,
      killSwitch,
      macroReleaseBlock,
    });

    await reply(message);
  },
};

commandRegistry.register(modeConsistency);

export default modeConsistency;
