/**
 * channelPipeline.ts — 텔레그램 채널 발송 파이프라인
 *
 * 채널에 보낼 콘텐츠 카테고리를 중앙에서 관리한다.
 * 각 함수는 내용을 채널 포맷으로 가공 후 sendChannelAlert 호출.
 *
 * 환경변수:
 *   TELEGRAM_CHANNEL_ID  — 채널 chat_id (@채널명 또는 -100xxxxxxxxxx)
 *   CHANNEL_ENABLED      — 'true'일 때만 발송 (기본 false, 안전장치)
 *
 * 채널 vs 개인 발송 기준:
 *   📢 채널 : 매수/매도 신호, 레짐 변화, 장 전 브리핑, 워치리스트 요약, 글로벌 스캔, 성과
 *   🔒 개인 : 잔고/자산, 비상정지, 손절 접근 경보, 오류, 내부 디버그
 */

import { sendChannelAlert } from './telegramClient.js';

function isChannelEnabled(): boolean {
  return process.env.CHANNEL_ENABLED === 'true';
}

// ── 1. 매수 신호 ─────────────────────────────────────────────────────────────

export interface ChannelBuySignalParams {
  mode: 'SHADOW' | 'LIVE';
  stockName: string;
  stockCode: string;
  price: number;
  quantity: number;
  gateScore: number;
  mtas: number;
  cs: number;
  stopLoss: number;
  targetPrice: number;
  rrr: number;
  signalType: 'STRONG_BUY' | 'BUY';
  sector?: string;
}

export async function channelBuySignal(p: ChannelBuySignalParams): Promise<void> {
  if (!isChannelEnabled()) return;

  const modeEmoji  = p.mode === 'LIVE' ? '🚀' : '⚡';
  const modeLabel  = p.mode === 'LIVE' ? 'LIVE 매수' : 'Shadow 매수';
  const signalEmoji = p.signalType === 'STRONG_BUY' ? '🔥' : '✅';
  const rrrStr = p.rrr.toFixed(1);

  const msg =
    `${modeEmoji} <b>[${modeLabel}] ${signalEmoji} ${p.stockName} (${p.stockCode})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 진입가: <b>${p.price.toLocaleString()}원</b> × ${p.quantity}주\n` +
    (p.sector ? `🏭 섹터: ${p.sector}\n` : '') +
    `📊 Gate: ${p.gateScore.toFixed(1)} | MTAS: ${p.mtas.toFixed(0)}/10 | CS: ${p.cs.toFixed(2)}\n` +
    `🛡️ 손절: ${p.stopLoss.toLocaleString()}원\n` +
    `🎯 목표: ${p.targetPrice.toLocaleString()}원\n` +
    `⚖️ RRR: 1:${rrrStr}`;

  await sendChannelAlert(msg).catch(console.error);
}

// ── 2. 매도/청산 신호 ────────────────────────────────────────────────────────

export interface ChannelSellSignalParams {
  stockName: string;
  stockCode: string;
  exitPrice: number;
  entryPrice: number;
  pnlPct: number;
  /** 'TARGET' | 'STOP' | 'TRAILING' | 'CASCADE' | 'EUPHORIA' | 'MANUAL' */
  reason: string;
  holdingDays: number;
}

export async function channelSellSignal(p: ChannelSellSignalParams): Promise<void> {
  if (!isChannelEnabled()) return;

  const isProfit = p.pnlPct >= 0;
  const emoji = isProfit
    ? (p.pnlPct >= 10 ? '💎' : '✅')
    : (p.pnlPct <= -7 ? '🔴' : '🟡');
  const pnlStr = `${isProfit ? '+' : ''}${p.pnlPct.toFixed(1)}%`;

  const reasonLabel: Record<string, string> = {
    TARGET:   '🎯 목표가 도달',
    STOP:     '🛡️ 손절 실행',
    TRAILING: '📉 트레일링 손절',
    EUPHORIA: '🌡️ 과열 부분 청산',
    TRANCHE:  '📈 분할 익절',
    CASCADE:  '⚠️ 캐스케이드 청산',
    MANUAL:   '👤 수동 청산',
  };

  const msg =
    `${emoji} <b>[청산] ${p.stockName} (${p.stockCode})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 ${reasonLabel[p.reason] ?? p.reason}\n` +
    `💰 청산가: ${p.exitPrice.toLocaleString()}원\n` +
    `📈 손익: <b>${pnlStr}</b> (${p.holdingDays}일 보유)\n` +
    `진입: ${p.entryPrice.toLocaleString()}원`;

  await sendChannelAlert(msg).catch(console.error);
}

// ── 3. 장 전 시장 브리핑 ─────────────────────────────────────────────────────

export interface ChannelMarketBriefingParams {
  regime: string;
  mhs: number;
  vkospi?: number;
  kospiChange?: number;
  usdKrw?: number;
  watchlistCount: number;
  focusCount: number;
  topSectors?: string[];
  aiSummary?: string;
}

export async function channelMarketBriefing(p: ChannelMarketBriefingParams): Promise<void> {
  if (!isChannelEnabled()) return;

  const regimeEmoji: Record<string, string> = {
    R1_TURBO: '🚀', R2_BULL: '📈', R3_EARLY: '🌱',
    R4_NEUTRAL: '⚖️', R5_CAUTION: '⚠️', R6_DEFENSE: '🔴',
  };
  const emoji = regimeEmoji[p.regime] ?? '📊';

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const days   = ['일', '월', '화', '수', '목', '금', '토'];
  const dateStr = `${kstNow.getUTCMonth() + 1}/${kstNow.getUTCDate()} (${days[kstNow.getUTCDay()]})`;

  const lines = [
    `${emoji} <b>[${dateStr} 장 전 브리핑]</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🗺️ 레짐: <b>${p.regime}</b> | MHS: ${p.mhs.toFixed(0)}`,
    p.vkospi    !== undefined ? `😨 VKOSPI: ${p.vkospi.toFixed(1)}` : '',
    p.kospiChange !== undefined
      ? `🇰🇷 KOSPI: ${p.kospiChange >= 0 ? '+' : ''}${p.kospiChange.toFixed(2)}%`
      : '',
    p.usdKrw !== undefined ? `💵 USD/KRW: ${p.usdKrw.toFixed(0)}원` : '',
    `📋 워치리스트: ${p.watchlistCount}개 | Focus: ${p.focusCount}개`,
    p.topSectors?.length
      ? `🏭 주목 섹터: ${p.topSectors.slice(0, 3).join(' · ')}`
      : '',
    p.aiSummary ? `\n💬 ${p.aiSummary}` : '',
  ].filter(Boolean).join('\n');

  await sendChannelAlert(lines).catch(console.error);
}

// ── 4. 레짐 변화 경보 ────────────────────────────────────────────────────────

export async function channelRegimeChange(
  prevRegime: string,
  newRegime: string,
  mhs: number,
  reason: string,
): Promise<void> {
  if (!isChannelEnabled()) return;

  const arrows: Record<string, string> = {
    R1_TURBO: '🚀', R2_BULL: '📈', R3_EARLY: '🌱',
    R4_NEUTRAL: '⚖️', R5_CAUTION: '⚠️', R6_DEFENSE: '🔴',
  };

  const msg =
    `🔄 <b>[레짐 변화]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${arrows[prevRegime] ?? '?'} ${prevRegime} → ${arrows[newRegime] ?? '?'} <b>${newRegime}</b>\n` +
    `MHS: ${mhs.toFixed(0)} | ${reason}`;

  await sendChannelAlert(msg).catch(console.error);
}

// ── 5. 워치리스트 추가 요약 ──────────────────────────────────────────────────

export interface ChannelWatchlistStock {
  name: string;
  code: string;
  price: number;
  changePercent: number;
  gateScore: number;
  sector?: string;
}

export async function channelWatchlistAdded(
  stocks: ChannelWatchlistStock[],
  regime: string,
): Promise<void> {
  if (!isChannelEnabled()) return;
  if (stocks.length === 0) return;

  // Track B(고신뢰)만 채널 공유 — Track A(후보군)는 노이즈
  const lines = stocks
    .map(s => {
      const changeStr = `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(1)}%`;
      return `  • ${s.name}(${s.code}) ${changeStr} | Gate ${s.gateScore.toFixed(1)}${s.sector ? ` | ${s.sector}` : ''}`;
    })
    .join('\n');

  const msg =
    `📋 <b>[워치리스트 갱신] ${stocks.length}개 추가</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${lines}\n` +
    `레짐: ${regime}`;

  await sendChannelAlert(msg, { disableNotification: true }).catch(console.error);
}

// ── 6. 글로벌 스캔 핵심 요약 ─────────────────────────────────────────────────

export async function channelGlobalScan(summary: string): Promise<void> {
  if (!isChannelEnabled()) return;

  const msg = `🌐 <b>[글로벌 스캔]</b>\n━━━━━━━━━━━━━━━━━━━━\n${summary}`;
  await sendChannelAlert(msg, { disableNotification: true }).catch(console.error);
}

// ── 7. 일일/주간 성과 리포트 ─────────────────────────────────────────────────

export interface ChannelPerformanceParams {
  period: 'DAILY' | 'WEEKLY';
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalPnlPct: number;
  bestTrade?: { name: string; pnlPct: number };
  worstTrade?: { name: string; pnlPct: number };
}

export async function channelPerformance(p: ChannelPerformanceParams): Promise<void> {
  if (!isChannelEnabled()) return;

  const winRate = p.totalTrades > 0
    ? ((p.winCount / p.totalTrades) * 100).toFixed(0)
    : '0';
  const pnlStr = `${p.totalPnlPct >= 0 ? '+' : ''}${p.totalPnlPct.toFixed(2)}%`;
  const emoji  = p.totalPnlPct >= 0 ? '📈' : '📉';
  const label  = p.period === 'DAILY' ? '일일' : '주간';

  const lines = [
    `${emoji} <b>[${label} 성과]</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📊 총 거래: ${p.totalTrades}건 (승 ${p.winCount} / 패 ${p.lossCount})`,
    `🏆 승률: ${winRate}%`,
    `💰 손익: <b>${pnlStr}</b>`,
    p.bestTrade  ? `✅ 최고: ${p.bestTrade.name} +${p.bestTrade.pnlPct.toFixed(1)}%`   : '',
    p.worstTrade ? `🔴 최저: ${p.worstTrade.name} ${p.worstTrade.pnlPct.toFixed(1)}%` : '',
  ].filter(Boolean).join('\n');

  await sendChannelAlert(lines).catch(console.error);
}
