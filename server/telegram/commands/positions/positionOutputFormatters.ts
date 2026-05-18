// @responsibility Telegram position output formatting.
import { escapeHtml } from '../../../alerts/telegramClient.js';
import type { PnlSourceSnapshot, TelegramPositionEntry } from './shadowPositionSources.js';
import {
  formatAccountKind,
  formatPnlKindLabel,
  formatPositionTagHeader,
  formatPriceSourceTag,
  stalePriceWarning,
} from '../../positionDisplayTags.js';

function formatMoney(value: number | undefined | null): string {
  if (!Number.isFinite(value)) return 'N/A';
  return `${Math.round(value as number).toLocaleString('ko-KR')}원`;
}

function formatSignedMoney(value: number | undefined | null): string {
  if (!Number.isFinite(value)) return 'N/A';
  const amount = Math.round(value as number);
  const sign = amount > 0 ? '+' : '';
  return `${sign}${amount.toLocaleString('ko-KR')}원`;
}

function formatPercent(value: number | undefined | null): string {
  if (!Number.isFinite(value)) return 'N/A';
  const pct = value as number;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatMultiple(value: number | undefined | null): string {
  if (!Number.isFinite(value)) return 'N/A';
  return `${(value as number).toFixed(2)}R`;
}

function formatCurrentPrice(position: TelegramPositionEntry): string {
  if (position.priceSource === 'MISSING') {
    return `N/A (${formatPriceSourceTag(position.priceSource)})`;
  }
  return `${formatMoney(position.currentPrice)} (${formatPriceSourceTag(position.priceSource, position.priceAgeSeconds)})`;
}

export function renderPositionLine(position: TelegramPositionEntry, index: number): string {
  const name = escapeHtml(position.stockName || position.stockCode);
  const code = escapeHtml(position.stockCode);
  const status = escapeHtml(position.status);
  const account = escapeHtml(formatAccountKind(position.accountKind));
  const tagHeader = escapeHtml(formatPositionTagHeader(position.displayTags));
  const pnlLabel = formatPnlKindLabel(position.pnlKind);
  const warning = stalePriceWarning(position.priceSource);
  const lines = [
    `${index + 1}. <b>${tagHeader} ${name} / ${code}</b>`,
    `   수량: ${position.qty.toLocaleString('ko-KR')}`,
    `   진입가: ${formatMoney(position.entryPrice)}`,
    `   현재가: ${formatCurrentPrice(position)}`,
    `   평가손익: ${formatSignedMoney(position.unrealizedPnl)} (${formatPercent(position.unrealizedPct)}) [${pnlLabel}]`,
    `   R multiple: ${formatMultiple(position.rMultiple)}`,
    `   상태: ${status}`,
    `   계좌: ${account}`,
    `   source: ${position.source}`,
    `   account: ${account}`,
    `   origin: ${position.origin}`,
    `   modeTag: [${position.positionKind}]`,
    `   liveOrderSent: ${position.liveOrderSent}`,
    `   executionImpact: ${position.executionImpact}`,
  ];

  if (position.dualPosition) {
    lines.push(`   Live 수량: ${position.dualPosition.liveQty.toLocaleString('ko-KR')}`);
    lines.push(`   Shadow 수량: ${position.dualPosition.shadowQty.toLocaleString('ko-KR')}`);
    lines.push(`   주의: ${position.dualPosition.warning}`);
  }
  if (warning) {
    lines.push(`   ${warning}`);
  }

  return lines.join('\n');
}

function formatCurrentMode(snapshot: PnlSourceSnapshot): string {
  const effectiveRegime = snapshot.mode.marketState?.effectiveRegime ?? snapshot.mode.modeLabel;
  return `${snapshot.mode.modeLabel} / ${effectiveRegime}`;
}

export type PnlView = 'ALL' | 'SHADOW' | 'LIVE';

export function renderPnlSummary(snapshot: PnlSourceSnapshot, view: PnlView = 'ALL'): string {
  const { mode, counts, openTrades, pnl } = snapshot;
  const lines: string[] = [
    '📊 <b>손익 요약</b>',
    `현재 모드: ${escapeHtml(formatCurrentMode(snapshot))}`,
    `실거래: ${mode.liveTradingEnabled ? 'ON' : 'OFF'}`,
    '',
  ];

  if (view !== 'SHADOW') {
    lines.push(`[LIVE] 실계좌 손익: ${formatSignedMoney(pnl.liveRealizedPnl + pnl.liveUnrealizedPnl)}`);
    lines.push(`[LIVE] 실현손익: ${formatSignedMoney(pnl.liveRealizedPnl)}`);
    lines.push(`[LIVE] 미실현손익: ${formatSignedMoney(pnl.liveUnrealizedPnl)}`);
    lines.push(`[LIVE] KIS 실제 예수금/보유평가금액: ${counts.livePnlSkipped ? '미조회 또는 비활성' : '조회 후순위'}`);
  }

  if (view !== 'LIVE') {
    if (view === 'ALL') lines.push('');
    lines.push(`[SHADOW] 가상 미실현손익: ${formatSignedMoney(pnl.shadowUnrealizedPnl)}`);
    lines.push(`[SHADOW] 가상 실현손익: ${formatSignedMoney(pnl.shadowRealizedPnl)}`);
    lines.push(`[SHADOW] 금일 가상손익: ${formatSignedMoney(pnl.shadowTodayPnl)}`);
    lines.push(`[VIRTUAL] 현금: ${formatMoney(pnl.virtualCash)}`);
    lines.push(`[VIRTUAL] 총자산: ${formatMoney(pnl.virtualTotalAssets)}`);
    lines.push(`열린 Shadow 포지션 수: ${counts.shadowOpenCount.toLocaleString('ko-KR')}`);
    lines.push(`종료 Shadow 트레이드 수: ${pnl.closedTradeCount.toLocaleString('ko-KR')}`);
  }

  lines.push('');
  lines.push('주의문:');
  if (mode.liveTradingEnabled && view === 'LIVE') {
    lines.push('Live 손익은 Shadow 가상손익과 합산하지 않습니다.');
  } else {
    lines.push('실거래 주문 없음. 아래 손익은 Shadow 가상손익입니다.');
  }
  lines.push('Live 손익과 Shadow 손익은 하나의 총손익으로 합산하지 않습니다.');

  if (view !== 'LIVE' && openTrades.length > 0) {
    lines.push('');
    lines.push('<b>[열린 Shadow 포지션]</b>');
    lines.push(
      ...openTrades.slice(0, 10).map((trade, index) => {
        const name = escapeHtml(trade.stockName || trade.stockCode);
        const code = escapeHtml(trade.stockCode);
        const r6Tag = trade.entryType === 'R6_COUNTERFACTUAL_BUY' ? ' [R6_COUNTERFACTUAL · 실주문없음]' : ' [SHADOW · 실주문없음]';
        return `${index + 1}. ${r6Tag} ${name} / ${code} - ${escapeHtml(String(trade.status))}`;
      }),
    );
  }

  return lines.join('\n');
}
