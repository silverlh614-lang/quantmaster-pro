/**
 * channelPipeline.ts — 텔레그램 채널 발송 파이프라인
 *
 * 채널에 보낼 콘텐츠 카테고리를 중앙에서 관리한다.
 * 각 함수는 내용을 채널 포맷으로 가공 후 sendChannelAlert 호출.
 *
 * 환경변수:
 *   TELEGRAM_CHAT_ID     — 채팅/채널 chat_id (@채널명, -100xxxxxxxxxx, 또는 개인 chat_id)
 *   CHANNEL_ENABLED      — 'true'일 때만 발송 (기본 false, 안전장치)
 *
 * 채널 vs 개인 발송 기준:
 *   📢 채널 : 매수/매도 신호, 레짐 변화, 장 전 브리핑, 워치리스트 요약, 글로벌 스캔, 성과
 *   🔒 개인 : 잔고/자산, 비상정지, 손절 접근 경보, 오류, 내부 디버그
 */

import { escapeHtml } from './telegramClient.js';
import { dispatchAlert } from './alertRouter.js';
import { AlertCategory } from './alertCategories.js';
import { formatAlert } from './formatAlert.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

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

export async function channelBuySignalEmitted(p: ChannelBuySignalParams): Promise<void> {
  if (!isChannelEnabled()) return;

  const modeLabel  = p.mode === 'LIVE' ? 'LIVE 매수 신호' : '[SHADOW] 매수 신호';
  const signalEmoji = p.signalType === 'STRONG_BUY' ? '🔥' : '✅';
  const bodyLines = [
    `💰 진입가: <b>${p.price.toLocaleString()}원</b> × ${p.quantity}주`,
    p.sector ? `🏭 섹터: ${escapeHtml(p.sector)}` : '',
    `📊 Gate: ${p.gateScore.toFixed(1)} | MTAS: ${p.mtas.toFixed(0)}/10 | CS: ${p.cs.toFixed(2)}`,
    `🛡️ 손절: ${p.stopLoss.toLocaleString()}원`,
    `🎯 목표: ${p.targetPrice.toLocaleString()}원`,
    `⚖️ RRR: 1:${p.rrr.toFixed(1)}`,
  ];
  if (p.mode === 'SHADOW') bodyLines.push('⚠️ SHADOW 모드 — 실계좌 잔고 아님');
  const message = formatAlert({
    category: AlertCategory.ANALYSIS,
    eventType: `${modeLabel} ${signalEmoji} ${p.stockName} (${p.stockCode})`,
    headerEmoji: '🧪',
    bodyLines,
  });
  await dispatchAlert(AlertCategory.ANALYSIS, message).catch(console.error);
}

export async function channelBuyFilled(params: {
  stockName: string;
  stockCode: string;
  fillPrice: number;
  quantity: number;
  orderNo: string;
}): Promise<void> {
  if (!isChannelEnabled()) return;
  const message = formatAlert({
    category: AlertCategory.TRADE,
    eventType: `체결 ${params.stockName} (${params.stockCode})`,
    headerEmoji: '📈',
    bodyLines: [
      `💵 체결가: <b>${params.fillPrice.toLocaleString()}원</b> × ${params.quantity}주`,
      `🧾 주문번호: ${escapeHtml(params.orderNo)}`,
    ],
  });
  await dispatchAlert(AlertCategory.TRADE, message).catch(console.error);
}

export async function channelBuySignal(p: ChannelBuySignalParams): Promise<void> {
  await channelBuySignalEmitted(p);
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
  /** 이번에 청산한 수량 (부분청산 감지에 사용) */
  soldQty?: number;
  /** 포지션 원래 전체 수량 */
  originalQty?: number;
}

export async function channelSellSignal(p: ChannelSellSignalParams): Promise<void> {
  if (!isChannelEnabled()) return;

  const isProfit = p.pnlPct >= 0;
  const profitEmoji = isProfit
    ? (p.pnlPct >= 10 ? '💎' : '✅')
    : (p.pnlPct <= -7 ? '🔴' : '🟡');
  const pnlStr = `${isProfit ? '+' : ''}${p.pnlPct.toFixed(1)}%`;

  const reasonLabel: Record<string, string> = {
    TARGET:       '🎯 목표가 도달',
    STOP:         '🛡️ 손절 실행',
    TRAILING:     '📉 트레일링 손절',
    EUPHORIA:     '🌡️ 과열 부분 청산',
    TRANCHE:      '📈 분할 익절',
    CASCADE:      '⚠️ 캐스케이드 청산',
    RRR_COLLAPSE: '📊 RRR 붕괴 익절',
    DIVERGENCE:   '📉 하락 다이버전스',
    MANUAL:       '👤 수동 청산',
  };

  const isPartial =
    p.soldQty !== undefined &&
    p.originalQty !== undefined &&
    p.soldQty < p.originalQty;
  const pct       = isPartial ? Math.round((p.soldQty! / p.originalQty!) * 100) : 100;
  const remaining = isPartial ? p.originalQty! - p.soldQty! : 0;

  const header = isPartial
    ? `🟡 <b>[부분청산 ${pct}%] ${escapeHtml(p.stockName)} (${escapeHtml(p.stockCode)})</b>`
    : `${profitEmoji} <b>[청산] ${escapeHtml(p.stockName)} (${escapeHtml(p.stockCode)})</b>`;

  const lines: string[] = [
    header,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📌 ${reasonLabel[p.reason] ?? p.reason}`,
    `💰 청산가: ${p.exitPrice.toLocaleString()}원`,
  ];

  if (isPartial) {
    lines.push(`📦 청산 수량: ${p.soldQty}주 / 원래 ${p.originalQty}주`);
  }

  lines.push(`📈 손익: <b>${pnlStr}</b> (${p.holdingDays}일 보유)`);
  lines.push(`진입: ${p.entryPrice.toLocaleString()}원`);

  if (isPartial) {
    lines.push(``);
    lines.push(`🔸 잔여 보유: ${remaining}주`);
  }

  await dispatchAlert(AlertCategory.TRADE, lines.join('\n')).catch(console.error);
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
      ? `🏭 주목 섹터: ${p.topSectors.slice(0, 3).map(escapeHtml).join(' · ')}`
      : '',
    p.aiSummary ? `\n💬 ${escapeHtml(p.aiSummary)}` : '',
  ].filter(Boolean).join('\n');

  await dispatchAlert(AlertCategory.INFO, lines).catch(console.error);
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
    `${arrows[prevRegime] ?? '?'} ${escapeHtml(prevRegime)} → ${arrows[newRegime] ?? '?'} <b>${escapeHtml(newRegime)}</b>\n` +
    `MHS: ${mhs.toFixed(0)} | ${escapeHtml(reason)}`;

  await dispatchAlert(AlertCategory.INFO, msg).catch(console.error);
}

// ── 5. 워치리스트 추가 요약 ──────────────────────────────────────────────────

export interface ChannelWatchlistStock {
  name: string;
  code: string;
  price: number;
  changePercent: number;
  gateScore: number;
  sector?: string;
  entryPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  rrr?: number;
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
      const rrrStr = s.rrr ? ` | RRR 1:${s.rrr.toFixed(1)}` : '';
      const sectorStr = s.sector ? ` | ${escapeHtml(s.sector)}` : '';
      const priceInfo = s.entryPrice
        ? `\n     💰 진입: ${s.entryPrice.toLocaleString()}원` +
          (s.stopLoss ? ` | 🛡️ 손절: ${s.stopLoss.toLocaleString()}원` : '') +
          (s.targetPrice ? ` | 🎯 목표: ${s.targetPrice.toLocaleString()}원` : '')
        : '';
      return (
        `  • <b>${escapeHtml(s.name)}</b>(${escapeHtml(s.code)}) ${changeStr} | Gate ${s.gateScore.toFixed(1)}${rrrStr}${sectorStr}` +
        priceInfo
      );
    })
    .join('\n');

  const msg =
    `📋 <b>[워치리스트 갱신] ${stocks.length}개 추가</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${lines}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🗺️ 레짐: ${regime}`;

  await dispatchAlert(AlertCategory.ANALYSIS, msg, { disableNotification: true }).catch(console.error);
}

// ── 5-1. 워치리스트 제거 알림 ───────────────────────────────────────────────

export async function channelWatchlistRemoved(
  stock: { name: string; code: string },
  remainingCount: number,
): Promise<void> {
  if (!isChannelEnabled()) return;

  const msg =
    `🗑️ <b>[워치리스트 제거] ${escapeHtml(stock.name)} (${escapeHtml(stock.code)})</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 잔여 워치리스트: ${remainingCount}개`;

  await dispatchAlert(AlertCategory.ANALYSIS, msg, { disableNotification: true }).catch(console.error);
}

// ── 5-2. 워치리스트 전체 현황 채널 발송 ─────────────────────────────────────

export async function channelWatchlistSummary(
  watchlist: WatchlistEntry[],
): Promise<void> {
  if (!isChannelEnabled()) return;
  if (watchlist.length === 0) return;

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hh = kstNow.getUTCHours().toString().padStart(2, '0');
  const mm = kstNow.getUTCMinutes().toString().padStart(2, '0');

  const swingList    = watchlist.filter(w => w.section === 'SWING' || (!w.section && (w.track === 'B' || w.addedBy === 'MANUAL')));
  const catalystList = watchlist.filter(w => w.section === 'CATALYST');
  const momentumList = watchlist.filter(w => w.section === 'MOMENTUM' || (!w.section && w.track === 'A' && w.addedBy !== 'MANUAL'));

  const parts: string[] = [
    `📋 <b>[워치리스트 현황] ${hh}:${mm} KST</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `총 ${watchlist.length}개 (SWING: ${swingList.length} | CATALYST: ${catalystList.length} | MOMENTUM: ${momentumList.length})`,
  ];

  if (swingList.length > 0) {
    parts.push('');
    parts.push('🎯 <b>SWING — 스윙 매수 대상</b>');
    for (const w of swingList) {
      const focusMark = w.isFocus ? '⭐' : '';
      const manualMark = w.addedBy === 'MANUAL' ? '👤' : w.addedBy === 'DART' ? '📢' : '🤖';
      const gate = w.gateScore !== undefined ? `G${w.gateScore.toFixed(0)}` : '';
      const rrr = w.rrr !== undefined ? `R1:${w.rrr.toFixed(1)}` : '';
      const sector = w.sector ? escapeHtml(w.sector) : '';
      const meta = [gate, rrr, sector].filter(Boolean).join(' · ');
      parts.push(
        `${focusMark}${manualMark} <b>${escapeHtml(w.name)}</b>(${escapeHtml(w.code)})` +
        ` ${w.entryPrice.toLocaleString()}원` +
        (meta ? ` [${meta}]` : '') +
        `\n   🛡️${w.stopLoss.toLocaleString()} → 🎯${w.targetPrice.toLocaleString()}`
      );
    }
  }

  if (catalystList.length > 0) {
    parts.push('');
    parts.push(`📢 <b>CATALYST — 촉매 단기 (${catalystList.length}개)</b>`);
    for (const w of catalystList) {
      const gate = w.gateScore !== undefined ? `G${w.gateScore.toFixed(0)}` : '';
      parts.push(
        `  📢 <b>${escapeHtml(w.name)}</b>(${escapeHtml(w.code)}) ${w.entryPrice.toLocaleString()}원 ${gate}` +
        `\n   🛡️${w.stopLoss.toLocaleString()} → 🎯${w.targetPrice.toLocaleString()} (포지션 60%)`
      );
    }
  }

  if (momentumList.length > 0) {
    parts.push('');
    parts.push(`📂 <b>MOMENTUM — 관찰 전용 (${momentumList.length}개)</b>`);
    const shown = momentumList
      .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
      .slice(0, 8);
    for (const w of shown) {
      const gate = w.gateScore !== undefined ? `G${w.gateScore.toFixed(0)}` : '';
      parts.push(`  🤖 ${escapeHtml(w.name)}(${escapeHtml(w.code)}) ${w.entryPrice.toLocaleString()}원 ${gate}`);
    }
    if (momentumList.length > 8) {
      parts.push(`  ... 외 ${momentumList.length - 8}개`);
    }
  }

  parts.push('');
  parts.push('━━━━━━━━━━━━━━━━━━━━');
  parts.push('⭐=SWING매수대상 👤=수동 📢=CATALYST 🤖=MOMENTUM');

  await dispatchAlert(AlertCategory.ANALYSIS, parts.join('\n'), { disableNotification: true }).catch(console.error);
}

// ── 6. 글로벌 스캔 핵심 요약 ─────────────────────────────────────────────────

export async function channelGlobalScan(summary: string): Promise<void> {
  if (!isChannelEnabled()) return;

  const msg = `🌐 <b>[글로벌 스캔]</b>\n━━━━━━━━━━━━━━━━━━━━\n${escapeHtml(summary)}`;
  await dispatchAlert(AlertCategory.INFO, msg, {
    disableNotification: true,
    delivery: 'daily_digest',
  }).catch(console.error);
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
    p.bestTrade  ? `✅ 최고: ${escapeHtml(p.bestTrade.name)} +${p.bestTrade.pnlPct.toFixed(1)}%`   : '',
    p.worstTrade ? `🔴 최저: ${escapeHtml(p.worstTrade.name)} ${p.worstTrade.pnlPct.toFixed(1)}%` : '',
  ].filter(Boolean).join('\n');

  await dispatchAlert(AlertCategory.INFO, lines).catch(console.error);
}

