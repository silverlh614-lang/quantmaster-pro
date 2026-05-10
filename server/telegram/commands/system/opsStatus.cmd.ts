// @responsibility opsStatus.cmd — read-only operator control-tower snapshot.
// @responsibility: /ops_status — health/status/shadow/Telegram digest 요약을 한 화면에 압축.
//
// Read-only command. It does not mutate live trading, preflight, Gate, Kelly,
// STRONG_BUY, order paths, provider fetch behavior, or data promotion state.

import { collectHealthSnapshot } from '../../../health/diagnostics.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { loadShadowTrades, getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { isDigestEnabled } from '../../../alerts/telegramClient.js';
import { loadAndSummarizeShadowBlockedOutcomes } from '../../../learning/shadowBlockedOutcomeAnalytics.js';
import { loadAndBuildShadowFutureReturnCacheCoverageSummary } from '../../../learning/shadowFutureReturnCacheProvider.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

function isOpenStatus(status: string | undefined): boolean {
  return status === 'PENDING'
    || status === 'ORDER_SUBMITTED'
    || status === 'PARTIALLY_FILLED'
    || status === 'ACTIVE'
    || status === 'EUPHORIA_PARTIAL';
}

function formatKst(ts: number | undefined): string {
  if (!ts || ts <= 0) return 'none';
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function safeLine(label: string, value: unknown): string {
  return `• ${label}: <b>${String(value)}</b>`;
}

function deriveLiveExecutionAllowed(snapshot: ReturnType<typeof collectHealthSnapshot>): boolean {
  return snapshot.autoTradeMode === 'LIVE'
    && snapshot.autoTradeEnabled
    && !snapshot.emergencyStop
    && !snapshot.dailyLossLimitReached
    && snapshot.kisConfigured
    && snapshot.kisTokenValid
    && snapshot.volume.ok;
}

function formatOpsStatusMessage(): string {
  const snapshot = collectHealthSnapshot();
  const macro = loadMacroState();
  const trades = loadShadowTrades();
  const activeTrades = trades.filter((trade) => isOpenStatus(trade.status) && getRemainingQty(trade) > 0);
  const blocked = loadAndSummarizeShadowBlockedOutcomes();
  const coverage = loadAndBuildShadowFutureReturnCacheCoverageSummary();
  const liveExecutionAllowed = deriveLiveExecutionAllowed(snapshot);

  const emptyCause = snapshot.lastScanSummary?.emptyReason
    ?? snapshot.lastScanSummary?.blockReason
    ?? snapshot.lastScanSummary?.skipReason
    ?? 'UNKNOWN';

  const topOverBlocked = blocked.topOverBlockedReasons[0]
    ? `${blocked.topOverBlockedReasons[0].blockedReason} (${blocked.topOverBlockedReasons[0].overBlockedCount})`
    : 'none';

  const lines = [
    '🧭 <b>[OPS STATUS]</b>',
    '<i>read-only control tower — executionImpact=NONE</i>',
    '',
    '<b>Mode</b>',
    safeLine('verdict', snapshot.verdict),
    safeLine('tradingMode', snapshot.autoTradeMode),
    safeLine('autoTradeEnabled', snapshot.autoTradeEnabled ? 'true' : 'false'),
    safeLine('liveExecutionAllowed', liveExecutionAllowed ? 'true' : 'false'),
    safeLine('emergencyStop', snapshot.emergencyStop ? 'ON' : 'OFF'),
    safeLine('market/regime', `${macro?.regime ?? 'UNKNOWN'} / MHS ${typeof macro?.mhs === 'number' ? macro.mhs.toFixed(0) : 'N/A'}`),
    '',
    '<b>Data</b>',
    safeLine('Yahoo', `${snapshot.yahoo.status}/${snapshot.yahoo.detail}`),
    safeLine('KIS', snapshot.kisConfigured ? `configured, token ${snapshot.kisTokenHours}h` : 'not configured'),
    safeLine('KRX', `${snapshot.krxTokenConfigured ? 'configured' : 'not configured'} / ${snapshot.krxTokenValid ? 'healthy' : 'unhealthy'}`),
    safeLine('macroUpdatedAt', snapshot.macroStateUpdatedAt ?? 'none'),
    safeLine('usdKrw', snapshot.macroStateUsdKrw ?? 'n/a'),
    '',
    '<b>Scan</b>',
    safeLine('lastScan', formatKst(snapshot.lastScanTs)),
    safeLine('lastSignal', formatKst(snapshot.lastBuyTs)),
    safeLine('empty/topCause', emptyCause),
    safeLine('watchlist', `${snapshot.watchlistCount}`),
    '',
    '<b>Shadow</b>',
    safeLine('openShadowTrades', activeTrades.length),
    safeLine('blockedOutcomes', `total=${blocked.totalSignals}, resolved=${blocked.resolvedSignals}, pending=${blocked.pendingSignals}`),
    safeLine('topOverBlocked', topOverBlocked),
    safeLine('futureReturnCache', `unresolved=${coverage.unresolvedSignals}, misses=${coverage.cacheMisses}, notYetDue=${coverage.notYetDueLookups}`),
    '',
    '<b>Telegram</b>',
    safeLine('digest', isDigestEnabled() ? 'ON' : 'OFF'),
    safeLine('telegramConfigured', snapshot.telegramConfigured ? 'true' : 'false'),
    '',
    '<b>Operator next</b>',
    liveExecutionAllowed
      ? '• 조치: LIVE execution path appears allowed by health snapshot. Confirm order guard state before real trading.'
      : '• 조치: 관찰/차단 상태. /scan_blockers, /fresh_data_status, /shadow_return_flow 로 세부 확인.',
  ];

  return lines.join('\n');
}

const opsStatus: TelegramCommand = {
  name: '/ops_status',
  aliases: ['/ops', '/control_tower'],
  category: 'SYS',
  visibility: 'MENU',
  riskLevel: 0,
  description: '운영자 통합 관제 요약 — health/data/scan/shadow/telegram 상태를 한 화면에 표시',
  usage: '/ops_status',
  async execute({ reply }) {
    try {
      await reply(formatOpsStatusMessage());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ OPS STATUS 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(opsStatus);

export default opsStatus;
export { formatOpsStatusMessage, deriveLiveExecutionAllowed };
