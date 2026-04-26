// @responsibility status.cmd 텔레그램 모듈
// @responsibility: /status 명령 — 모드/비상정지/MHS/포지션/오늘 결산/KIS/Yahoo/스캐너 1메시지 요약.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import { getRemainingQty } from '../../../persistence/shadowTradeRepo.js';
import { getShadowTrades } from '../../../orchestrator/tradingOrchestrator.js';
import { collectHealthSnapshot } from '../../../health/diagnostics.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const status: TelegramCommand = {
  name: '/status',
  category: 'SYS',
  visibility: 'MENU',
  riskLevel: 0,
  description: '시스템 현황 요약 (모드/비상정지/MHS/활성 포지션/오늘 결산)',
  async execute({ reply }) {
    const macro = loadMacroState();
    const shadows = getShadowTrades();
    const snapshot = collectHealthSnapshot();

    const active = shadows.filter((s) => {
      const st = (s as { status?: string }).status;
      const open =
        st === 'PENDING' ||
        st === 'ORDER_SUBMITTED' ||
        st === 'PARTIALLY_FILLED' ||
        st === 'ACTIVE' ||
        st === 'EUPHORIA_PARTIAL';
      return open && getRemainingQty(s) > 0;
    });
    const today = new Date().toISOString().split('T')[0];
    const closed = shadows.filter((s) => {
      const r = s as { status?: string; signalTime?: string };
      return (r.status === 'HIT_TARGET' || r.status === 'HIT_STOP') && r.signalTime?.startsWith(today);
    });
    const pnl = closed.reduce(
      (sum, s) => sum + ((s as { returnPct?: number }).returnPct ?? 0),
      0,
    );

    await reply(formatStatusMessage({
      verdict: snapshot.verdict,
      autoTradeMode: snapshot.autoTradeMode,
      autoTradeEnabled: snapshot.autoTradeEnabled,
      emergencyStop: snapshot.emergencyStop,
      mhs: macro?.mhs,
      regime: macro?.regime,
      activeCount: active.length,
      maxPositions: parseInt(process.env.MAX_CONVICTION_POSITIONS ?? '8', 10),
      closedCount: closed.length,
      pnlSum: pnl,
      kisTokenHours: snapshot.kisTokenHours,
      kisConfigured: snapshot.kisConfigured,
      watchlistCount: snapshot.watchlistCount,
      lastScanTs: snapshot.lastScanTs,
      lastBuyTs: snapshot.lastBuyTs,
      dailyLossPct: snapshot.dailyLossPct,
      dailyLossLimit: snapshot.dailyLossLimit,
      yahooStatus: snapshot.yahoo.status,
    }));
  },
};

commandRegistry.register(status);

export default status;

// ─── 포맷팅 (export for testability) ───────────────────────────────────────

export interface StatusInputs {
  verdict: string;
  autoTradeMode: string;
  autoTradeEnabled: boolean;
  emergencyStop: boolean;
  mhs: number | undefined;
  regime: string | undefined;
  activeCount: number;
  maxPositions: number;
  closedCount: number;
  pnlSum: number;
  kisTokenHours: number;
  kisConfigured: boolean;
  watchlistCount: number;
  lastScanTs: number;
  lastBuyTs: number;
  dailyLossPct: number;
  dailyLossLimit: number;
  yahooStatus: 'OK' | 'STALE' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
}

/**
 * /status 메시지 본문 합성. 단일 화면에 운영자가 가장 자주 보는 11개 항목을 압축.
 * 기존 5줄 (모드/비상정지/MHS/활성/결산) 에 verdict + KIS + 워치 + 스캔 + 손실 + Yahoo
 * 6줄을 보강했다. /now 와 다른 점: /now 는 1줄 의사결정, /status 는 다축 스냅샷.
 */
export function formatStatusMessage(s: StatusInputs): string {
  const modeLabel = s.autoTradeMode !== 'LIVE' ? '🟡 [SHADOW]' : '🔴 LIVE';
  const enabledMark = s.autoTradeEnabled ? '' : ' (off)';
  const mhsLabel = typeof s.mhs === 'number' ? s.mhs.toFixed(0) : 'N/A';
  const regimeLabel = s.regime ?? 'N/A';
  const pnlSign = s.pnlSum >= 0 ? '+' : '';

  const kisLabel = !s.kisConfigured
    ? '미설정'
    : s.kisTokenHours > 0
      ? `✅ ${s.kisTokenHours}h`
      : '❌ 만료';

  const yahooIcon =
    s.yahooStatus === 'OK' ? '✅' :
    s.yahooStatus === 'DEGRADED' ? '⚠️' :
    s.yahooStatus === 'DOWN' ? '❌' :
    s.yahooStatus === 'STALE' ? '🟡' :
    '?';

  const lastScanLabel = s.lastScanTs > 0 ? formatKstHm(s.lastScanTs) : '미실행';
  const lastBuyLabel = s.lastBuyTs > 0 ? formatKstHm(s.lastBuyTs) : '없음';
  const dailyLossLabel = `${s.dailyLossPct.toFixed(1)}% / ${s.dailyLossLimit}%`;

  return (
    `📊 <b>[시스템 현황]</b>\n` +
    `판정: ${s.verdict}\n` +
    `─────────────────────\n` +
    `모드: ${modeLabel}${enabledMark}\n` +
    `비상정지: ${s.emergencyStop ? '🔴 ON' : '🟢 OFF'}\n` +
    `MHS: ${mhsLabel} (${regimeLabel})\n` +
    `활성 포지션: ${s.activeCount}/${s.maxPositions}\n` +
    `워치리스트: ${s.watchlistCount}개\n` +
    `오늘 결산: ${s.closedCount}건 (P&L ${pnlSign}${s.pnlSum.toFixed(2)}%)\n` +
    `일일손실: ${dailyLossLabel}\n` +
    `KIS 토큰: ${kisLabel} | Yahoo: ${yahooIcon}\n` +
    `마지막 스캔: ${lastScanLabel} | 마지막 신호: ${lastBuyLabel}`
  );
}

function formatKstHm(ts: number): string {
  return new Date(ts).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  });
}
