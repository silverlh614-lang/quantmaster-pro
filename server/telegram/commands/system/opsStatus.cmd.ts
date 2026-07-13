// @responsibility opsStatus.cmd — read-only operator control-tower snapshot.
// @responsibility: /ops_status — health/status/shadow/Telegram digest 요약을 모바일 한 화면에 압축.
//
// Read-only command. It does not mutate live trading, preflight, Gate, Kelly,
// STRONG_BUY, order paths, provider fetch behavior, or data promotion state.

import { collectHealthSnapshot } from '../../../health/diagnostics.js';
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { loadShadowTrades, getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { isDigestEnabled } from '../../../alerts/telegramClient.js';
import { loadAndSummarizeShadowBlockedOutcomes } from '../../../learning/shadowBlockedOutcomeAnalytics.js';
import { loadAndBuildShadowFutureReturnCacheCoverageSummary } from '../../../learning/shadowFutureReturnCacheProvider.js';
import {
  evaluateLivePreflightRegression,
  type LivePreflightRegressionResult,
} from '../../../trading/preflightRegressionMatrix.js';
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

function formatKstShortIso(iso: string | undefined): string {
  if (!iso) return 'none';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'invalid';
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtNumber(value: number | undefined, digits = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
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

function normalizeYahooStatus(snapshot: ReturnType<typeof collectHealthSnapshot>): string {
  if (snapshot.yahoo.detail === 'NO_SCAN_HISTORY') return 'IDLE(no scan)';
  if (snapshot.yahoo.detail === 'NO_CANDIDATES') return `${snapshot.yahoo.status}(no candidates)`;
  return `${snapshot.yahoo.status}/${snapshot.yahoo.detail}`;
}

function deriveEmptyCause(snapshot: ReturnType<typeof collectHealthSnapshot>): string {
  if (!snapshot.lastScanTs || snapshot.lastScanTs <= 0) return 'n/a(no scan)';
  return snapshot.lastScanSummary?.emptyScanReason ?? 'UNKNOWN';
}

function deriveProviderHealthForMatrix(snapshot: ReturnType<typeof collectHealthSnapshot>) {
  if (snapshot.yahoo.status === 'DOWN') return 'DOWN' as const;
  if (snapshot.yahoo.status === 'STALE') return 'STALE' as const;
  if (snapshot.yahoo.status === 'DEGRADED') return 'DEGRADED' as const;
  if (snapshot.yahoo.status === 'OK') return 'OK' as const;
  return 'UNKNOWN' as const;
}

function deriveDataFreshnessForMatrix(snapshot: ReturnType<typeof collectHealthSnapshot>) {
  if (snapshot.yahoo.status === 'STALE') return 'STALE' as const;
  if (snapshot.yahoo.detail === 'NO_SCAN_HISTORY') return 'UNKNOWN' as const;
  if (snapshot.yahoo.status === 'DOWN') return 'UNKNOWN' as const;
  return 'FRESH' as const;
}

function deriveMarketSessionAllowsEntry(snapshot: ReturnType<typeof collectHealthSnapshot>): boolean {
  const reason = snapshot.lastScanSummary?.emptyScanReason as string | undefined;
  return reason !== 'MARKET_SESSION_BLOCK' && reason !== 'SELL_ONLY_BLOCK';
}

function buildOpsPreflightMatrix(snapshot: ReturnType<typeof collectHealthSnapshot>, liveExecutionAllowed: boolean): LivePreflightRegressionResult {
  return evaluateLivePreflightRegression({
    autoTradeMode: snapshot.autoTradeMode,
    autoTradeEnabled: snapshot.autoTradeEnabled,
    liveExecutionAllowed,
    emergencyStop: snapshot.emergencyStop,
    dailyLossLimitReached: snapshot.dailyLossLimitReached,
    kisConfigured: snapshot.kisConfigured,
    kisTokenValid: snapshot.kisTokenValid,
    sellOnlyMode: false,
    positionFull: false,
    duplicateOrderRisk: false,
    providerHealth: deriveProviderHealthForMatrix(snapshot),
    dataFreshness: deriveDataFreshnessForMatrix(snapshot),
    volumeClockAllowsEntry: snapshot.volume.ok,
    marketSessionAllowsEntry: deriveMarketSessionAllowsEntry(snapshot),
  });
}

function collectOpsStatusData() {
  const snapshot = collectHealthSnapshot();
  const macro = loadMacroState();
  const trades = loadShadowTrades();
  const activeTrades = trades.filter((trade) => isOpenStatus(trade.status) && getRemainingQty(trade) > 0);
  const blocked = loadAndSummarizeShadowBlockedOutcomes();
  const coverage = loadAndBuildShadowFutureReturnCacheCoverageSummary();
  const liveExecutionAllowed = deriveLiveExecutionAllowed(snapshot);
  const preflightMatrix = buildOpsPreflightMatrix(snapshot, liveExecutionAllowed);
  const topOverBlocked = blocked.topOverBlockedReasons[0]
    ? `${blocked.topOverBlockedReasons[0].blockedReason}(${blocked.topOverBlockedReasons[0].overBlockedCount})`
    : 'none';

  return { snapshot, macro, activeTrades, blocked, coverage, liveExecutionAllowed, preflightMatrix, topOverBlocked };
}

function formatOpsStatusCompact(): string {
  const { snapshot, macro, activeTrades, blocked, coverage, liveExecutionAllowed } = collectOpsStatusData();
  const tradingMode = String(snapshot.autoTradeMode).toUpperCase();
  const auto = snapshot.autoTradeEnabled ? 'auto ON' : 'auto OFF';
  const live = liveExecutionAllowed ? 'live ON' : 'live OFF';
  const market = `${macro?.regime ?? 'UNKNOWN'} / MHS ${fmtNumber(macro?.mhs, 0)}`;
  const kis = snapshot.kisConfigured ? `KIS OK ${snapshot.kisTokenHours}h` : 'KIS n/a';
  const krx = snapshot.krxTokenValid ? 'KRX OK' : 'KRX warn';
  const yahoo = `Yahoo ${normalizeYahooStatus(snapshot)}`;
  const scan = `${formatKst(snapshot.lastScanTs)} / WL ${snapshot.watchlistCount}`;
  const shadow = `open ${activeTrades.length} · blocked ${blocked.totalSignals} · pending ${blocked.pendingSignals}`;
  const returns = `miss ${coverage.cacheMisses} · due ${coverage.notYetDueLookups}`;
  const digest = isDigestEnabled() ? 'digest ON' : 'digest OFF';
  const action = liveExecutionAllowed
    ? '조치: LIVE 가능 상태. 실주문 전 order guard 확인.'
    : '조치: 관찰/차단 상태. 필요시 /scan_blockers 확인.';

  return [
    '🧭 <b>OPS STATUS</b>',
    `상태: <b>${snapshot.verdict}</b>`,
    `모드: <b>${tradingMode}</b> / ${auto} / ${live}`,
    `시장: <b>${market}</b>`,
    `데이터: ${kis} · ${krx} · ${yahoo}`,
    `스캔: ${scan}`,
    `Shadow: ${shadow}`,
    `Return: ${returns}`,
    `Telegram: ${digest}`,
    '',
    action,
    '<i>상세: /ops_status full</i>',
  ].join('\n');
}

function formatPreflightMatrixSection(result: LivePreflightRegressionResult): string[] {
  const reasons = result.blockReasons.length > 0 ? result.blockReasons.join(', ') : 'none';
  return [
    '<b>Live Preflight Matrix</b>',
    safeLine('allowNewBuy', result.allowNewBuy ? 'true' : 'false'),
    safeLine('liveOrderAllowed', result.liveOrderAllowed ? 'true' : 'false'),
    safeLine('action', result.confidenceAction),
    safeLine('reasons', reasons),
    '<i>diagnostic only — no order dispatch.</i>',
  ];
}

function formatOpsStatusFull(): string {
  const { snapshot, macro, activeTrades, blocked, coverage, liveExecutionAllowed, preflightMatrix, topOverBlocked } = collectOpsStatusData();
  const emptyCause = deriveEmptyCause(snapshot);

  const lines = [
    '🧭 <b>[OPS STATUS FULL]</b>',
    '<i>read-only control tower — executionImpact=NONE</i>',
    '',
    '<b>Mode</b>',
    safeLine('verdict', snapshot.verdict),
    safeLine('tradingMode', snapshot.autoTradeMode),
    safeLine('autoTradeEnabled', snapshot.autoTradeEnabled ? 'true' : 'false'),
    safeLine('liveExecutionAllowed', liveExecutionAllowed ? 'true' : 'false'),
    safeLine('emergencyStop', snapshot.emergencyStop ? 'ON' : 'OFF'),
    safeLine('market/regime', `${macro?.regime ?? 'UNKNOWN'} / MHS ${fmtNumber(macro?.mhs, 0)}`),
    '',
    '<b>Data</b>',
    safeLine('Yahoo', normalizeYahooStatus(snapshot)),
    safeLine('KIS', snapshot.kisConfigured ? `configured, token ${snapshot.kisTokenHours}h` : 'not configured'),
    safeLine('KRX', `${snapshot.krxTokenConfigured ? 'configured' : 'not configured'} / ${snapshot.krxTokenValid ? 'healthy' : 'unhealthy'}`),
    safeLine('macroUpdatedAt', formatKstShortIso(snapshot.macroStateUpdatedAt)),
    safeLine('usdKrw', fmtNumber(snapshot.macroStateUsdKrw, 2)),
    '',
    '<b>Scan</b>',
    safeLine('lastScan', formatKst(snapshot.lastScanTs)),
    safeLine('lastSignal', formatKst(snapshot.lastBuyTs)),
    safeLine('empty/topCause', emptyCause),
    safeLine('watchlist', `${snapshot.watchlistCount}`),
    '',
    ...formatPreflightMatrixSection(preflightMatrix),
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

function formatOpsStatusMessage(args: string[] = []): string {
  const full = args.some((arg) => arg.toLowerCase() === 'full' || arg.toLowerCase() === '--full');
  return full ? formatOpsStatusFull() : formatOpsStatusCompact();
}

const opsStatus: TelegramCommand = {
  name: '/ops_status',
  aliases: ['/ops', '/control_tower'],
  category: 'SYS',
  visibility: 'MENU',
  riskLevel: 0,
  description: '운영자 통합 관제 요약 — 기본 compact, full 상세 지원',
  usage: '/ops_status [full]',
  async execute({ args, reply }) {
    try {
      await reply(formatOpsStatusMessage(args));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ OPS STATUS 생성 실패: ${msg}`);
    }
  },
};

commandRegistry.register(opsStatus);
