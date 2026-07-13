// @responsibility startupExecutionContext — clarify startup mode labels after server boot.
//
// Read-only startup alert. It separates:
// - execution mode: LIVE / SHADOW / VTS
// - order execution: ON / OFF
// - KIS environment: REAL / VTS
//
// This module does not import KIS/order/Gate/Kelly/Shadow policy paths.

import { sendTelegramAlert } from './telegramClient.js';

// ─── ADR-0553 — 자동매매 시동 안전 가드 (2축: 실행 ON/OFF × 계좌 real/모의) ──────────
//
// 순수 env 기반 결정 (KIS/order/Gate/Shadow 경로 import 없음 — 책임 경계 유지).
//   - mode !== LIVE                         → ALLOW_NO_EXECUTION (실주문 경로 비활성).
//   - LIVE + 실계좌(kisIsReal):
//       · KIS_REAL_MONEY_ACK 미설정          → REFUSE (실수로 실거래 켜짐 방지 — 하드가드).
//       · ACK 설정                           → ALLOW_REAL_MONEY (🔴 실제 돈 경고 배너).
//   - LIVE + 모의(!kisIsReal):
//       · VTS_PAPER_TRADING_ENABLED 미설정    → REFUSE (매수만 나가고 매도 차단되는 비대칭 방지;
//                                              기존 index.ts:25 거부와 byte-equivalent 트리거).
//       · 설정                                → ALLOW_PAPER_VTS (🧪 모의 — 실제 돈 위험 0).
type AutoTradeStartupDecision =
  | 'ALLOW_NO_EXECUTION'
  | 'ALLOW_REAL_MONEY'
  | 'ALLOW_PAPER_VTS'
  | 'REFUSE_REAL_MONEY_UNACKED'
  | 'REFUSE_PAPER_FLAG_DISABLED';

export interface AutoTradeStartupGuardResult {
  decision: AutoTradeStartupDecision;
  allowed: boolean;
  message: string;
}

export function resolveAutoTradeStartupGuard(
  env: NodeJS.ProcessEnv = process.env,
): AutoTradeStartupGuardResult {
  const mode = (env.AUTO_TRADE_MODE ?? 'SHADOW').toUpperCase();
  const kisIsReal = env.KIS_IS_REAL === 'true';
  const vtsPaperTradingEnabled = env.VTS_PAPER_TRADING_ENABLED === 'true';
  const realMoneyAck = env.KIS_REAL_MONEY_ACK === 'true';

  if (mode !== 'LIVE') {
    return {
      decision: 'ALLOW_NO_EXECUTION',
      allowed: true,
      message: `AUTO_TRADE_MODE=${mode} — 실주문 경로 비활성 (SHADOW/VTS/OFF).`,
    };
  }

  if (kisIsReal) {
    if (!realMoneyAck) {
      return {
        decision: 'REFUSE_REAL_MONEY_UNACKED',
        allowed: false,
        message:
          'AUTO_TRADE_MODE=LIVE + KIS_IS_REAL=true (실계좌/실제 돈) 인데 KIS_REAL_MONEY_ACK=true 가 없습니다. ' +
          '실수로 실거래가 켜지는 것을 막기 위해 기동을 거부합니다. 실거래 의도라면 KIS_REAL_MONEY_ACK=true 를 명시하십시오.',
      };
    }
    return {
      decision: 'ALLOW_REAL_MONEY',
      allowed: true,
      message: '🔴 LIVE + 실계좌 — 실제 돈 주문이 집행됩니다 (KIS_REAL_MONEY_ACK 확인됨).',
    };
  }

  // LIVE + 모의계좌 (KIS_IS_REAL=false)
  if (!vtsPaperTradingEnabled) {
    return {
      decision: 'REFUSE_PAPER_FLAG_DISABLED',
      allowed: false,
      message:
        'AUTO_TRADE_MODE=LIVE 인데 KIS_IS_REAL 이 true 가 아닙니다. 모의계좌 매매(VTS paper)를 의도했다면 ' +
        'VTS_PAPER_TRADING_ENABLED=true 를 설정하십시오. (미설정 시 매수만 나가고 매도가 차단되는 비대칭을 막기 위해 기동을 거부합니다.)',
    };
  }
  return {
    decision: 'ALLOW_PAPER_VTS',
    allowed: true,
    message: '🧪 LIVE + 모의계좌(VTS paper) — 실제 돈 위험 없이 모의 주문이 집행됩니다.',
  };
}

export interface StartupExecutionContextSnapshot {
  tradingMode: string;
  autoTradeEnabled: boolean;
  kisIsReal: boolean;
  liveExecutionAllowed: boolean;
  // ADR-0553 — 모의(VTS) 주문 집행 활성 여부. liveExecutionAllowed(실제 돈) 와 분리.
  paperExecutionActive: boolean;
  accountType: 'REAL_MONEY' | 'PAPER_VTS' | 'NONE';
  orderExecutionLabel: 'ON' | 'OFF';
  kisEnvironmentLabel: string;
}

export function buildStartupExecutionContextSnapshot(env: NodeJS.ProcessEnv = process.env): StartupExecutionContextSnapshot {
  const tradingMode = env.AUTO_TRADE_MODE ?? 'SHADOW';
  const autoTradeEnabled = env.AUTO_TRADE_ENABLED === 'true';
  const kisIsReal = env.KIS_IS_REAL === 'true';
  const vtsPaperTradingEnabled = env.VTS_PAPER_TRADING_ENABLED === 'true';
  // ADR-0553: 실주문은 mode==='LIVE' + autoTradeEnabled 일 때, 계좌(real/모의)는 kisIsReal 가 라우팅.
  //   실제 돈(REAL_MONEY) = LIVE + kisIsReal / 모의(PAPER_VTS) = LIVE + !kisIsReal + VTS flag.
  const liveExecutionAllowed = tradingMode === 'LIVE' && autoTradeEnabled && kisIsReal;
  const paperExecutionActive =
    tradingMode === 'LIVE' && autoTradeEnabled && !kisIsReal && vtsPaperTradingEnabled;
  const orderExecutionLabel: 'ON' | 'OFF' = (liveExecutionAllowed || paperExecutionActive) ? 'ON' : 'OFF';
  const accountType: 'REAL_MONEY' | 'PAPER_VTS' | 'NONE' =
    !(liveExecutionAllowed || paperExecutionActive) ? 'NONE' : kisIsReal ? 'REAL_MONEY' : 'PAPER_VTS';
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
    paperExecutionActive,
    accountType,
    orderExecutionLabel,
    kisEnvironmentLabel,
  };
}

export function formatStartupExecutionContextMessage(snapshot: StartupExecutionContextSnapshot): string {
  // ADR-0553: 실계좌(🔴 실제 돈) vs 모의(🧪 VTS) 를 시동 배너에서 분명히 구분.
  const modeIcon = snapshot.tradingMode === 'LIVE'
    ? (snapshot.accountType === 'REAL_MONEY' ? '🔴' : '🧪')
    : snapshot.tradingMode === 'VTS' ? '🧪' : '🟡';
  const orderIcon = snapshot.liveExecutionAllowed ? '🔴' : snapshot.paperExecutionActive ? '🧪' : '🟢';
  const accountLabel = snapshot.accountType === 'REAL_MONEY'
    ? '실계좌 (실제 돈)'
    : snapshot.accountType === 'PAPER_VTS' ? '모의계좌 (VTS paper)' : '없음 (실행 OFF)';
  const tail = snapshot.liveExecutionAllowed
    ? '🔴 실제 돈 LIVE 주문이 가능합니다. 실주문 전 /ops_status 와 guard 상태를 확인하십시오.'
    : snapshot.paperExecutionActive
      ? '🧪 모의계좌(VTS) 주문이 집행됩니다 — 실제 돈이 아닙니다. 전략·체결을 안전하게 검증하십시오.'
      : '✅ 실주문은 차단 상태입니다 (SHADOW/VTS/OFF — 주문 실행 OFF).';
  return [
    '🧭 <b>[Startup Execution Context]</b>',
    `${modeIcon} 모드: <b>${snapshot.tradingMode}</b>`,
    `${orderIcon} 주문 실행: <b>${snapshot.orderExecutionLabel}</b>`,
    `계좌: <b>${accountLabel}</b>`,
    `KIS 환경: <b>${snapshot.kisEnvironmentLabel}</b>`,
    `AUTO_TRADE_ENABLED: <b>${snapshot.autoTradeEnabled ? 'true' : 'false'}</b>`,
    '',
    tail,
  ].join('\n');
}

export async function sendStartupExecutionContextAlert(): Promise<void> {
  const snapshot = buildStartupExecutionContextSnapshot();
  await sendTelegramAlert(
    formatStartupExecutionContextMessage(snapshot),
    {
      priority: 'NORMAL',
      dedupeKey: `startup_execution_context:${snapshot.tradingMode}:${snapshot.orderExecutionLabel}:${snapshot.accountType}`,
      category: 'boot_context',
    },
  );
}
