/**
 * positionMorningCard.ts — 보유 포지션 Morning Card (IDEA 4)
 *
 * positionAggregator.aggregateAllPositions() 의 생애주기 집계를 구독자에게
 * 09:05 KST 1건의 카드로 공급한다. UI/API 에만 존재하던 데이터를 Telegram 채널로 배선.
 *
 * 카드 1건 포맷:
 *   🟢 종목명 D+N | +X.X%
 *      목표까지 ±Y% | 손절까지 ±Z%
 *      상태: (분할/정상/손절 접근)
 */
import { aggregateAllPositions, type PositionSummary } from '../trading/positionAggregator.js';
import { loadShadowTrades, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { channelHeader, CHANNEL_SEPARATOR } from './channelFormatter.js';
import { safePctChange } from '../utils/safePctChange.js';

// ── 카드 1건 ─────────────────────────────────────────────────────────────────

interface PositionCard {
  name: string;
  code: string;
  stage: string;
  holdingDays: number;
  currentReturnPct: number | null;
  toTargetPct: number | null;
  toStopPct: number | null;
  status: string;
}

/**
 * 활성 포지션(= stage !== 'CLOSED') 만 대상.
 * 현재가 조회 실패 시 snapshot.returnPct 로 폴백.
 */
async function buildCard(p: PositionSummary, shadow: ServerShadowTrade | null): Promise<PositionCard> {
  const currentPriceRaw = await fetchCurrentPrice(p.stockCode).catch(() => null);
  const currentPrice = typeof currentPriceRaw === 'number' && currentPriceRaw > 0 ? currentPriceRaw : null;

  let currentReturnPct: number | null = null;
  let toTargetPct: number | null = null;
  let toStopPct: number | null = null;

  if (currentPrice && p.entryPrice > 0) {
    // ADR-0028: stale currentPrice 시 null 유지 (UI 가 'N/A' 표기).
    currentReturnPct = safePctChange(currentPrice, p.entryPrice, {
      label: `positionMorningCard:${p.stockCode}`,
    });
    const targetPrice = shadow?.targetPrice;
    const stopLoss = shadow?.stopLoss;
    if (typeof targetPrice === 'number' && targetPrice > 0) {
      toTargetPct = ((targetPrice - currentPrice) / currentPrice) * 100;
    }
    if (typeof stopLoss === 'number' && stopLoss > 0) {
      toStopPct = ((stopLoss - currentPrice) / currentPrice) * 100;
    }
  } else if (typeof shadow?.returnPct === 'number') {
    currentReturnPct = shadow.returnPct;
  }

  const status = describeStatus(p, toStopPct);

  return {
    name: p.stockName,
    code: p.stockCode,
    stage: p.stage,
    holdingDays: p.holdingDays,
    currentReturnPct,
    toTargetPct,
    toStopPct,
    status,
  };
}

function describeStatus(p: PositionSummary, toStopPct: number | null): string {
  if (toStopPct !== null && toStopPct > -3 && toStopPct <= 0) {
    return '⚠️ 손절선 접근';
  }
  if (p.stage === 'PARTIAL') {
    const tranches = p.exitBreakdown.takeProfit.qty > 0 ? '분할 익절 진행' : '부분 청산';
    return tranches;
  }
  if (p.stage === 'ENTRY') {
    return '정상 추세 유지 중';
  }
  return '관찰 중';
}

function renderCard(card: PositionCard): string {
  const pnl = card.currentReturnPct;
  const dot = pnl === null ? '⚪' : pnl >= 3 ? '🟢' : pnl >= -1 ? '🟡' : pnl >= -5 ? '🟠' : '🔴';
  const pnlStr = pnl === null ? 'N/A' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`;

  const lines = [
    `${dot} <b>${card.name}</b>(${card.code}) D+${card.holdingDays} | ${pnlStr}`,
  ];

  if (card.toTargetPct !== null || card.toStopPct !== null) {
    const tgt = card.toTargetPct !== null
      ? `목표까지 ${card.toTargetPct >= 0 ? '+' : ''}${card.toTargetPct.toFixed(1)}%`
      : '목표 N/A';
    const stp = card.toStopPct !== null
      ? `손절까지 ${card.toStopPct >= 0 ? '+' : ''}${card.toStopPct.toFixed(1)}%`
      : '손절 N/A';
    lines.push(`   ${tgt} | ${stp}`);
  }

  lines.push(`   상태: ${card.status}`);
  return lines.join('\n');
}

// ── 메인 엔트리 ──────────────────────────────────────────────────────────────

/**
 * 09:05 KST — 활성 포지션 Morning Card 발송.
 * 활성 포지션 0개면 발송 스킵 (침묵이 정보).
 */
export async function sendPositionMorningCard(): Promise<void> {
  try {
    const all = aggregateAllPositions();
    const active = all.filter(p => p.stage !== 'CLOSED');
    if (active.length === 0) {
      console.log('[MorningCard] 활성 포지션 0개 — 발송 스킵');
      return;
    }

    const shadowsById = new Map<string, ServerShadowTrade>();
    for (const s of loadShadowTrades()) shadowsById.set(s.id, s);

    const cards: PositionCard[] = [];
    for (const p of active) {
      const card = await buildCard(p, shadowsById.get(p.positionId) ?? null);
      cards.push(card);
    }

    const header = channelHeader({
      icon: '📊',
      title: '보유 포지션 Morning Card',
      suffix: '09:05 KST',
    });

    const body = cards.map(renderCard).join('\n\n');

    const message =
      `${header}\n` +
      `현재 ${active.length}개 포지션 보유 중\n\n` +
      `${body}\n${CHANNEL_SEPARATOR}\n` +
      `<i>🟢≥+3% 🟡±1% 🟠-5% 🔴-5%↓ · 손절선 3% 내 접근 시 ⚠️</i>`;

    const today = new Date().toISOString().slice(0, 10);
    await sendTelegramBroadcast(message, {
      priority: 'NORMAL',
      tier: 'T2_REPORT',
      category: 'position_morning_card',
      dedupeKey: `morning_card:${today}`,
      disableChannelNotification: true,
    });

    console.log(`[MorningCard] ${active.length}개 포지션 카드 발송 완료`);
  } catch (e) {
    console.error('[MorningCard] 발송 실패:', e instanceof Error ? e.message : e);
  }
}
