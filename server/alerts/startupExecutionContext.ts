// @responsibility startupExecutionContext — clarify startup mode labels after server boot.
//
// Read-only startup alert. It separates:
// - execution mode: LIVE / SHADOW / VTS
// - order execution: ON / OFF
// - KIS environment: REAL / VTS
//
// This module does not import KIS/order/Gate/Kelly/Shadow policy paths.

import { sendTelegramAlert } from './telegramClient.js';

export interface StartupExecutionContextSnapshot {
  tradingMode: string;
  autoTradeEnabled: boolean;
  kisIsReal: boolean;
  liveExecutionAllowed: boolean;
  orderExecutionLabel: 'ON' | 'OFF';
  kisEnvironmentLabel: string;
}

export function buildStartupExecutionContextSnapshot(env: NodeJS.ProcessEnv = process.env): StartupExecutionContextSnapshot {
  const tradingMode = env.AUTO_TRADE_MODE ?? 'SHADOW';
  const autoTradeEnabled = env.AUTO_TRADE_ENABLED === 'true';
  const kisIsReal = env.KIS_IS_REAL === 'true';
  const liveExecutionAllowed = tradingMode === 'LIVE' && autoTradeEnabled && kisIsReal;
  const orderExecutionLabel: 'ON' | 'OFF' = liveExecutionAllowed ? 'ON' : 'OFF';
  const kisEnvironmentLabel = kisIsReal
    ? 'REAL account/token available'
    : tradingMode === 'VTS'
      ? 'VTS mock/sandbox'
      : 'VTS/non-real';

  return {
    tradingMode,
    autoTradeEnabled,
    kisIsReal,
    liveExecutionAllowed,
    orderExecutionLabel,
    kisEnvironmentLabel,
  };
}

export function formatStartupExecutionContextMessage(snapshot: StartupExecutionContextSnapshot): string {
  const modeIcon = snapshot.tradingMode === 'LIVE' ? '🔴' : snapshot.tradingMode === 'VTS' ? '🧪' : '🟡';
  const orderIcon = snapshot.liveExecutionAllowed ? '🔴' : '🟢';
  return [
    '🧭 <b>[Startup Execution Context]</b>',
    `${modeIcon} 모드: <b>${snapshot.tradingMode}</b>`,
    `${orderIcon} 주문 실행: <b>${snapshot.orderExecutionLabel}</b>`,
    `KIS 환경: <b>${snapshot.kisEnvironmentLabel}</b>`,
    `AUTO_TRADE_ENABLED: <b>${snapshot.autoTradeEnabled ? 'true' : 'false'}</b>`,
    '',
    snapshot.liveExecutionAllowed
      ? '⚠️ LIVE 주문 가능 상태입니다. 실주문 전 /ops_status 와 guard 상태를 확인하십시오.'
      : '✅ 실주문은 차단 상태입니다. KIS 실계좌 토큰이 있어도 SHADOW/VTS 모드에서는 주문 실행 OFF 입니다.',
  ].join('\n');
}

export async function sendStartupExecutionContextAlert(): Promise<void> {
  const snapshot = buildStartupExecutionContextSnapshot();
  await sendTelegramAlert(
    formatStartupExecutionContextMessage(snapshot),
    {
      priority: 'NORMAL',
      dedupeKey: `startup_execution_context:${snapshot.tradingMode}:${snapshot.orderExecutionLabel}:${snapshot.kisIsReal ? 'real' : 'nonreal'}`,
      category: 'boot_context',
    },
  );
}
