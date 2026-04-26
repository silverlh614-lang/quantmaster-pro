/**
 * @responsibility 일일/장중/장마감 Telegram 리포트 생성 + 당일 실현 이벤트 fill SSOT 집계
 *
 * 리포트는 signalTime 이 아닌 fill timestamp 기준으로 오늘 실현을 모아, 부분매도
 * 익절과 이월 청산이 누락되지 않도록 한다 (PR-15).
 */
// Phase 5-⑩: 이메일 채널 제거 — 모든 리포트는 Telegram 통합 채널로 발송.
import {
  loadShadowTrades,
  getWeightedPnlPct,
  isActiveFill,
  type ServerShadowTrade,
  type PositionFill,
} from '../persistence/shadowTradeRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
import { callGemini } from '../clients/geminiClient.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramAlert } from './telegramClient.js';
import { channelMarketBriefing, channelPerformance } from './channelPipeline.js';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { loadGlobalScanReport } from './globalScanAgent.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { getFomcProximity } from '../trading/fomcCalendar.js';
import { fetchYahooQuote } from '../screener/stockScreener.js';
import { evaluateServerGate } from '../quantFilter.js';
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import { analyzeAttribution } from '../learning/attributionAnalyzer.js';
import { loadTomorrowPriming } from '../persistence/reflectionRepo.js';
import { getRemainingQty, isOpenShadowStatus } from '../trading/signalScanner.js';
// scanTracer 요약은 scanReviewReport.ts(16:40) 로 이관되어 이 파일에서는 더 이상 직접 사용하지 않는다.

// ── 당일 실현 이벤트 집계 SSOT (PR-15) ────────────────────────────────────────
//
// 기존 리포트 로직 버그: (1) signalTime 기준 필터라 어제 진입→오늘 청산 건 누락,
// (2) HIT_TARGET/HIT_STOP 만 `closed` 로 카운트해 ACTIVE 상태의 부분매도(익절)
// 실현손익이 집계에서 통째로 빠짐. 이 헬퍼는 fill 단위로 오늘 KST 에 발생한
// 모든 SELL 이벤트를 SSOT 로 모아, 부분매도·전량청산·이월청산을 균등 집계한다.
export interface TodayRealization {
  trade: ServerShadowTrade;
  fill: PositionFill;
  /** 이 fill 이 해당 trade 의 마지막 CONFIRMED SELL 이고 trade 가 전량 청산됐는지 */
  isFinalClose: boolean;
}

/** 오늘(KST) 에 CONFIRMED 된 모든 SELL fill 을 trade 와 함께 나열한다. */
export function collectTodayRealizations(
  shadows: ServerShadowTrade[],
  today: string,
): TodayRealization[] {
  const out: TodayRealization[] = [];
  for (const trade of shadows) {
    const fills = trade.fills ?? [];
    // 살아 있는 SELL fill 중 오늘 타임스탬프인 것만.
    const sellsToday = fills.filter((f) => {
      if (f.type !== 'SELL' || !isActiveFill(f)) return false;
      const ts = f.confirmedAt ?? f.timestamp;
      if (!ts) return false;
      const d = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      return d === today;
    });
    if (sellsToday.length === 0) continue;

    // 이 trade 의 마지막 CONFIRMED SELL id — "전량 청산" 판정에 사용.
    const allConfirmedSells = fills.filter((f) => f.type === 'SELL' && isActiveFill(f));
    const lastSellId = allConfirmedSells[allConfirmedSells.length - 1]?.id;
    const isClosed = trade.status === 'HIT_TARGET' || trade.status === 'HIT_STOP';

    for (const f of sellsToday) {
      out.push({
        trade,
        fill: f,
        isFinalClose: isClosed && f.id === lastSellId,
      });
    }
  }
  return out;
}

export interface TodayRealizationStats {
  realizations: TodayRealization[];
  /** fill 개수 (부분매도 포함) */
  realizationCount: number;
  /** 이익 fill 개수 */
  wins: number;
  /** 손실 fill 개수 */
  losses: number;
  /** 전량 청산된 trade 수 (중복 제거) */
  fullClosedCount: number;
  /** 부분매도만 발생한 trade 수 (전량 청산 제외) */
  partialOnlyCount: number;
  /** fill 가중 평균 pnlPct (Σ pnlPct×qty / Σ qty) */
  weightedReturnPct: number;
  /** fill 기반 실현 원화 합계 */
  totalRealizedKrw: number;
  /** 0~100 — 이익 fill 비율 */
  winRate: number;
}

export function summarizeTodayRealizations(r: TodayRealization[]): TodayRealizationStats {
  const wins = r.filter((x) => (x.fill.pnl ?? 0) > 0).length;
  const losses = r.filter((x) => (x.fill.pnl ?? 0) < 0).length;
  const fullClosedIds = new Set(r.filter((x) => x.isFinalClose).map((x) => x.trade.id));
  const allTradeIds = new Set(r.map((x) => x.trade.id));
  const partialOnlyCount = [...allTradeIds].filter((id) => !fullClosedIds.has(id)).length;

  const totalQty = r.reduce((s, x) => s + x.fill.qty, 0);
  const weightedReturnPct = totalQty > 0
    ? r.reduce((s, x) => s + (x.fill.pnlPct ?? 0) * x.fill.qty, 0) / totalQty
    : 0;
  const totalRealizedKrw = r.reduce((s, x) => s + (x.fill.pnl ?? 0), 0);

  return {
    realizations: r,
    realizationCount: r.length,
    wins,
    losses,
    fullClosedCount: fullClosedIds.size,
    partialOnlyCount,
    weightedReturnPct,
    totalRealizedKrw,
    winRate: r.length > 0 ? Math.round((wins / r.length) * 100) : 0,
  };
}

// ── 당일 매수 이벤트 집계 SSOT (PR-17) ────────────────────────────────────────
//
// "오늘 매수 N개" 는 기존 `shadows.filter(s => s.signalTime.startsWith(today))`
// 로 계산되어 어제 signaled → 오늘 tranche 체결·오늘 signaled → 오늘 체결 등
// fill 타임라인이 signalTime 과 괴리되는 케이스를 놓쳤다. 여기서는 실제 CONFIRMED
// BUY fill 의 timestamp 를 기준으로 집계해 체결 현실을 반영한다.
export interface TodayBuyEvent {
  trade: ServerShadowTrade;
  fill: PositionFill;
  /** 이 trade 의 첫 BUY fill 인지 — true 면 "신규 진입", false 면 tranche */
  isInitial: boolean;
}

export function collectTodayBuyEvents(
  shadows: ServerShadowTrade[],
  today: string,
): TodayBuyEvent[] {
  const out: TodayBuyEvent[] = [];
  for (const trade of shadows) {
    const fills = trade.fills ?? [];
    const buys = fills.filter((f) => f.type === 'BUY' && isActiveFill(f));
    if (buys.length === 0) continue;
    // 시간순 정렬 — 첫 BUY 가 INITIAL, 나머지는 TRANCHE.
    const sorted = [...buys].sort((a, b) => (a.confirmedAt ?? a.timestamp).localeCompare(b.confirmedAt ?? b.timestamp));
    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      // PROVISIONAL 도 집계 포함 (실제 주문 접수 완료 상태 — 체결 확인 대기).
      if (f.status === 'REVERTED') continue;
      const ts = f.confirmedAt ?? f.timestamp;
      if (!ts) continue;
      const d = new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      if (d !== today) continue;
      out.push({ trade, fill: f, isInitial: i === 0 });
    }
  }
  return out;
}

export interface TodayBuyEventStats {
  events: TodayBuyEvent[];
  totalBuys: number;
  /** 오늘 신규 진입한 trade 수 (isInitial 이면서 오늘) */
  newEntries: number;
  /** 기존 trade 에 대한 오늘 tranche 체결 수 */
  tranches: number;
  /** 오늘 BUY 체결로 유입된 총 주식 수량 */
  totalQty: number;
  /** 오늘 BUY 체결로 소요된 원화 총액 (qty × price) */
  totalCostKrw: number;
}

export function summarizeTodayBuyEvents(events: TodayBuyEvent[]): TodayBuyEventStats {
  const newEntries = events.filter((e) => e.isInitial).length;
  const tranches = events.filter((e) => !e.isInitial).length;
  const totalQty = events.reduce((s, e) => s + e.fill.qty, 0);
  const totalCostKrw = events.reduce((s, e) => s + e.fill.qty * e.fill.price, 0);
  return {
    events,
    totalBuys: events.length,
    newEntries,
    tranches,
    totalQty,
    totalCostKrw,
  };
}

/**
 * 아이디어 9: 일일 리포트 2.0 — Gemini AI 내러티브 리포트
 * 1. 거래 데이터 + MHS + 월간 통계를 Gemini에 주입 (googleSearch 없음)
 * 2. 자연어 요약 리포트 생성
 * 3. Telegram으로 즉시 발송 (이메일은 보조)
 */
export async function generateDailyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const macro   = loadMacroState();
  const stats   = getMonthlyStats();
  const today   = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  // PR-15: 오늘의 "신호 건수" 는 signalTime 기준, "실현 손익" 은 fill SSOT 기준으로 분리.
  // 부분매도(ACTIVE 상태 유지) 익절도 realizations 에 포함되어 이익 실종 방지.
  const todaySignals = shadows.filter(
    (s) => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );
  const realizations = collectTodayRealizations(shadows, today);
  const r = summarizeTodayRealizations(realizations);
  const totalReturn = r.weightedReturnPct;
  const watchlist = loadWatchlist();

  // ── 기본 수치 리포트 (이메일 / 폴백용) ────────────────────────────────────────
  const tradeLines = realizations.length > 0
    ? realizations.map((x) => {
        const icon = (x.fill.pnl ?? 0) >= 0 ? '✅' : '❌';
        const kind = x.isFinalClose
          ? (x.trade.status === 'HIT_TARGET' ? '전량 익절' : '전량 손절')
          : '부분매도';
        const pct = (x.fill.pnlPct ?? 0).toFixed(2);
        return `  ${icon} ${x.trade.stockName}(${x.trade.stockCode}) ${kind} ${pct}% · ${x.fill.qty}주`;
      }).join('\n')
    : '  (오늘 실현 이벤트 없음)';

  const dailyStatsLine = r.realizationCount >= 5
    ? `▶ 적중률: ${r.winRate}%  |  일일 P&L(가중): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  |  실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원`
    : `▶ 표본 ${r.realizationCount}건 (통계 ${Math.max(0, 5 - r.realizationCount)}건 더 필요)  |  일일 P&L(가중): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  |  실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원`;

  const monthlyLine = stats.sampleSufficient
    ? `[월간 ${stats.month}] WIN률 ${stats.winRate.toFixed(1)}% | PF ${
        stats.profitFactor !== null ? stats.profitFactor.toFixed(2) : 'N/A'
      } | 평균 ${stats.avgReturn.toFixed(2)}% | 복리 ${stats.compoundReturn.toFixed(2)}%`
    : `[월간 ${stats.month}] 표본 ${stats.total}건 — 통계 신뢰 위해 5건 이상 필요`;

  const baseReport = [
    `[QuantMaster Pro] ${today} 자동매매 일일 리포트`,
    '',
    `▶ 당일 신호: ${todaySignals.length}건`,
    `▶ 실현 이벤트: ${r.realizationCount}건 (익 ${r.wins} / 손 ${r.losses})` +
      (r.partialOnlyCount > 0 ? ` · 부분매도 진행 ${r.partialOnlyCount}건` : '') +
      (r.fullClosedCount > 0 ? ` · 전량 청산 ${r.fullClosedCount}건` : ''),
    dailyStatsLine,
    `▶ MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`,
    `▶ 워치리스트: ${watchlist.length}개`,
    '',
    tradeLines,
    '',
    monthlyLine,
    `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'SHADOW (가상매매)' : 'LIVE (실매매)'}`,
  ].join('\n');

  // ── Gemini AI 내러티브 생성 (googleSearch 없음 — 비용 절감) ─────────────────
  const realizedDetail = realizations.length > 0
    ? realizations.map((x) => {
        const kind = x.isFinalClose
          ? (x.trade.status === 'HIT_TARGET' ? '전량익절' : '전량손절')
          : '부분익절';
        return `${x.trade.stockName} ${kind} ${(x.fill.pnlPct ?? 0).toFixed(2)}%`;
      }).join(', ')
    : '';

  const dataBlock = [
    `날짜: ${today} (KST)`,
    `거래 모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '[SHADOW] (가상매매 — 실계좌 잔고 아님)' : 'LIVE (실매매)'}`,
    `당일 신호: ${todaySignals.length}건 | 실현 이벤트 ${r.realizationCount}건 (익 ${r.wins} / 손 ${r.losses})`,
    `부분매도 ${r.partialOnlyCount}건 · 전량청산 ${r.fullClosedCount}건`,
    `일일 P&L(가중 평균): ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%  |  실현 원화: ${Math.round(r.totalRealizedKrw).toLocaleString()}원`,
    `MHS: ${macro?.mhs ?? 'N/A'} | 레짐: ${macro?.regime ?? 'N/A'}`,
    `워치리스트: ${watchlist.length}개 (${watchlist.slice(0, 5).map(w => w.name).join(', ')}${watchlist.length > 5 ? ' 외' : ''})`,
    `월간 통계 (${stats.month}): 전체 ${stats.total}건 / WIN률 ${stats.winRate.toFixed(1)}% / 평균수익 ${stats.avgReturn.toFixed(2)}%`,
    `STRONG_BUY 적중률: ${stats.strongBuyWinRate.toFixed(1)}%`,
    realizedDetail ? `오늘 실현 상세: ${realizedDetail}` : '',
  ].filter(Boolean).join('\n');

  const geminiPrompt = [
    '당신은 한국 주식 자동매매 시스템의 일일 리포트 작성 AI입니다.',
    '아래 오늘의 거래 데이터를 바탕으로 트레이더가 내일 아침 읽을 간결한 한국어 내러티브 리포트를 작성하세요.',
    '주의: "실현 이벤트" 는 전량 청산뿐 아니라 ACTIVE 포지션의 부분매도(익절)도 포함한다. 손익 방향은 반드시 "일일 P&L(가중 평균)" 의 부호와 "오늘 실현 상세" 의 각 항목 부호를 그대로 따라 서술하라. 부분매도 익절이 있으면 "손실만 있었다" 고 단정 짓지 마라.',
    '형식: 오늘 요약 2~3문장 + 주목할 점 1~2개 bullet + 내일 주의사항 1~2개 bullet.',
    '반드시 한국어로, 300자 이내로 작성하세요. 외부 검색은 필요 없습니다.',
    '',
    '=== 오늘 데이터 ===',
    dataBlock,
  ].join('\n');

  // daily 리포트 narrative — 시장 분석 + 매매 회고 + 익일 전략 multi-section. 2048 절삭 방지 (ADR-0058).
  const narrative = await callGemini(geminiPrompt, 'report-generator', { maxOutputTokens: 4096 });

  // ── Telegram 발송 (메인 채널) ──────────────────────────────────────────────
  const telegramMsg = narrative
    ? `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${narrative}\n\n` +
      `<i>P&L ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% | ` +
      `WIN ${r.winRate}% (${r.wins}/${r.realizationCount}) | MHS ${macro?.mhs ?? 'N/A'}</i>`
    : `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${baseReport}`;

  await sendTelegramAlert(telegramMsg).catch(console.error);

  // Phase 5-⑩: 이메일 보조 채널 제거 — 모든 리포트는 Telegram 단일 채널로 발송.
  // 기존 이메일 코드는 유지비용만 남기고 사용되지 않아 삭제함.
  console.log('[AutoTrade] 일일 리포트 완료 (Telegram ✅)');
}

/**
 * 주간 캘리브레이션 리포트 — 매주 월요일 08:00 KST (UTC 일요일 23:00) 자동 발송.
 *
 * Phase 4 (참뮌 스펙 #7): 기존 금요일 16:30 발송은 주말 동안 잊혀지는 문제가 있어
 * 월요일 아침으로 이동. "지난 주 이렇게 움직였고 이번 주 주의사항은 이것" 맥락.
 *
 * 구조화된 주간 리포트:
 *  ① 거래 건수, WIN/LOSS, WIN률
 *  ② 평균 수익/손실, RRR 달성
 *  ③ 최고 기여 조건 TOP3 (attributionAnalyzer 연동)
 *  ④ 이번주 액션 아이템 (FOMC·레짐 기반 narrative)
 */
export async function generateWeeklyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const week = shadows.filter(s => new Date(s.signalTime).getTime() > weekAgo);
  const closed = week.filter(s => s.status !== 'ACTIVE' && s.status !== 'PENDING');
  const wins = closed.filter(s => s.status === 'HIT_TARGET');
  const losses = closed.filter(s => s.status === 'HIT_STOP');
  const winRate = closed.length > 0 ? Math.round(wins.length / closed.length * 100) : 0;

  // 평균 수익/손실
  const winReturns = wins.map(s => s.returnPct ?? 0);
  const lossReturns = losses.map(s => s.returnPct ?? 0);
  const avgWin = winReturns.length > 0
    ? winReturns.reduce((a, b) => a + b, 0) / winReturns.length : 0;
  const avgLoss = lossReturns.length > 0
    ? Math.abs(lossReturns.reduce((a, b) => a + b, 0) / lossReturns.length) : 0;
  const rrr = avgLoss > 0 ? avgWin / avgLoss : 0;

  // 주간 날짜 범위
  const weekStart = new Date(weekAgo + 9 * 60 * 60 * 1000);
  const weekEnd = new Date(now + 9 * 60 * 60 * 1000);
  const fmtDate = (d: Date) =>
    `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

  // ── 귀인 분석: 최고 기여 조건 TOP3 ──────────────────────────────────────────
  const attrRecords = loadAttributionRecords();
  const weeklyAttrRecords = attrRecords.filter(
    r => new Date(r.closedAt).getTime() > weekAgo
  );
  let top3Lines = '';
  if (weeklyAttrRecords.length >= 3) {
    const analysis = analyzeAttribution(weeklyAttrRecords);
    const ranked = analysis
      .filter(a => a.totalTrades >= 2 && a.avgReturn > 0)
      .sort((a, b) => (b.avgReturn * b.totalTrades) - (a.avgReturn * a.totalTrades))
      .slice(0, 3);

    if (ranked.length > 0) {
      top3Lines = `\n<b>최고 기여 조건 TOP${ranked.length}:</b>\n`;
      ranked.forEach((a, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}위`;
        top3Lines += `${medal} ${a.conditionName} — 기여 +${a.avgReturn.toFixed(1)}%\n`;
      });
    }
  }

  // ── 이번주 액션 아이템 (FOMC + 현재 레짐 기반 narrative) ───────────────────
  // v3.1 (2026-04-26): macro snapshot 전달해 우호 환경 완화 일관성 확보.
  const macroNow = loadMacroState();
  const regimeNow = getLiveRegime(macroNow);
  const fomc = getFomcProximity(
    macroNow
      ? {
          mhs: macroNow.mhs,
          regime: regimeNow ?? macroNow.regime,
          vkospi: macroNow.vkospi,
        }
      : undefined,
  );
  const actionLines: string[] = [];
  if (fomc.nextFomcDate) {
    const daysUntil = fomc.daysUntil ?? 999;
    if (daysUntil <= 7) {
      actionLines.push(`⚠️ 이번주 FOMC: ${fomc.nextFomcDate} (D-${daysUntil}) — 진입 규모 축소 권고`);
    } else if (daysUntil <= 14) {
      actionLines.push(`📅 2주 내 FOMC: ${fomc.nextFomcDate} (D-${daysUntil}) — 포지션 롤오버 시 유의`);
    }
  }
  if (regimeNow === 'R5_CAUTION' || regimeNow === 'R6_DEFENSE') {
    actionLines.push(`🔴 현재 레짐 ${regimeNow} — 신규 진입 자제, 기존 포지션 점검 우선`);
  } else if (regimeNow === 'R1_TURBO' || regimeNow === 'R2_BULL') {
    actionLines.push(`🟢 현재 레짐 ${regimeNow} — 주도주 집중도 강화, Kelly 배율 정상화`);
  }
  if (winRate < 40 && closed.length >= 5) {
    actionLines.push(`⚠️ 지난주 WIN률 ${winRate}% — 손절 기준·필터 재점검 권고`);
  }
  if (rrr < 1.5 && closed.length >= 5) {
    actionLines.push(`⚠️ RRR ${rrr.toFixed(2)} — 목표가 상향 또는 손절폭 축소 검토`);
  }
  const actionBlock = actionLines.length > 0
    ? `\n<b>이번주 액션 아이템:</b>\n${actionLines.map(l => `• ${l}`).join('\n')}\n`
    : `\n<i>이번주 특이사항 없음 — 기존 운용 원칙 유지.</i>\n`;

  // ── 메시지 조립 ──────────────────────────────────────────────────────────────
  const msg =
    `<b>[주간 캘리브레이션] ${fmtDate(weekStart)}~${fmtDate(weekEnd)}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `거래 ${closed.length}건: WIN ${wins.length} / LOSS ${losses.length}  (WIN률 ${winRate}%)\n` +
    `평균 수익: +${avgWin.toFixed(1)}%  평균 손실: -${avgLoss.toFixed(1)}%\n` +
    `RRR 달성: ${rrr.toFixed(2)} (목표 2.0 ${rrr >= 2.0 ? '✅' : '⚠️'})\n` +
    `━━━━━━━━━━━━━━━━` +
    top3Lines +
    (top3Lines ? `━━━━━━━━━━━━━━━━` : '') +
    actionBlock;

  await sendTelegramAlert(msg, { tier: 'T2_REPORT', category: 'weekly_calibration' }).catch(console.error);

  const bestShadow  = wins.length  > 0 ? wins.reduce((a, b)  => (a.returnPct ?? 0) > (b.returnPct ?? 0) ? a : b)  : undefined;
  const worstShadow = losses.length > 0 ? losses.reduce((a, b) => (a.returnPct ?? 0) < (b.returnPct ?? 0) ? a : b) : undefined;
  const totalPnlPct = closed.length > 0
    ? closed.reduce((sum, s) => sum + (s.returnPct ?? 0), 0) / closed.length
    : 0;
  await channelPerformance({
    period:      'WEEKLY',
    totalTrades: closed.length,
    winCount:    wins.length,
    lossCount:   losses.length,
    totalPnlPct,
    bestTrade:   bestShadow  ? { name: bestShadow.stockName,  pnlPct: bestShadow.returnPct  ?? 0 } : undefined,
    worstTrade:  worstShadow ? { name: worstShadow.stockName, pnlPct: worstShadow.returnPct ?? 0 } : undefined,
  }).catch(console.error);

  console.log('[AutoTrade] 주간 리포트 완료 (구조화)');
}

/**
 * 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
 *
 * 구조화된 브리핑:
 *  ① 레짐 + MHS + VKOSPI 요약
 *  ② 워치리스트 종목별 CompressionScore, Gap 판정, 진입 상태
 *  ③ FOMC 근접도 경고 (해당 시)
 */
export async function sendWatchlistBriefing(): Promise<void> {
  const list = loadWatchlist();
  const openCodes = new Set(
    loadShadowTrades()
      .filter((s) => isOpenShadowStatus(s.status) && getRemainingQty(s) > 0)
      .map((s) => s.stockCode),
  );
  const macro = loadMacroState();
  const regime = getLiveRegime(macro);
  // v3.1 (2026-04-26): macro snapshot 전달해 우호 환경 완화 일관성 확보.
  const fomc = getFomcProximity(
    macro
      ? {
          mhs: macro.mhs,
          regime: regime ?? macro.regime,
          vkospi: macro.vkospi,
        }
      : undefined,
  );

  // 레짐 이모지 맵
  const regimeEmoji: Record<string, string> = {
    R1_TURBO: '🟢', R2_BULL: '🟢', R3_EARLY: '🟡',
    R4_NEUTRAL: '⚪', R5_CAUTION: '🟠', R6_DEFENSE: '🔴',
  };

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mm = now.getUTCMinutes().toString().padStart(2, '0');

  // ── ① 레짐 헤더 ──────────────────────────────────────────────────────────
  let msg =
    `🌅 <b>[${hh}:${mm} 장전 브리핑]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `레짐: <b>${regime}</b> ${regimeEmoji[regime] ?? '⚪'}  ` +
    `MHS: ${macro?.mhs ?? 'N/A'}  ` +
    `VKOSPI: ${macro?.vkospi?.toFixed(1) ?? 'N/A'}\n` +
    `━━━━━━━━━━━━━━━━\n`;

  // ── ② 워치리스트 종목별 상세 ──────────────────────────────────────────────
  if (list.length === 0) {
    msg += `워치리스트 비어있음\n`;
  } else {
    msg += `<b>워치리스트 ${list.length}종목</b>\n`;
    const topItems = list.slice(0, 8);
    for (const w of topItems) {
      if (openCodes.has(w.code)) {
        const focusMark = w.isFocus ? '★ ' : '• ';
        msg += `${focusMark}${w.name}  보유중 · 대기목록 제외\n`;
        continue;
      }
      // Yahoo 시세 조회하여 CS, Gap 판단
      const quote =
        (await fetchYahooQuote(`${w.code}.KS`).catch(() => null)) ??
        (await fetchYahooQuote(`${w.code}.KQ`).catch(() => null));

      if (quote && quote.price > 0) {
        const gate = evaluateServerGate(quote);
        const cs = gate.compressionScore;

        // 갭 판단: 시가 vs 전일종가
        let gapLabel = '';
        if (quote.prevClose && quote.prevClose > 0 && quote.dayOpen && quote.dayOpen > 0) {
          const gapPct = ((quote.dayOpen - quote.prevClose) / quote.prevClose) * 100;
          if (gapPct >= 4) gapLabel = `Gap+${gapPct.toFixed(1)}% 과열`;
          else if (gapPct >= 1) gapLabel = `Gap+${gapPct.toFixed(1)}%`;
          else if (gapPct <= -1) gapLabel = `Gap${gapPct.toFixed(1)}%`;
        }

        // 진입 상태 판단
        let status: string;
        if (gate.signalType === 'STRONG') {
          status = `진입대기 @${w.entryPrice.toLocaleString()}`;
        } else if (gate.signalType === 'NORMAL') {
          status = `조건 부분충족 (Score ${gate.gateScore.toFixed(1)})`;
        } else if (cs >= 0.4) {
          status = `VCP 압축 중 (CS: ${cs.toFixed(2)})`;
        } else {
          status = `조건 미달`;
          if (gapLabel) status += ` (${gapLabel})`;
        }

        const focusMark = w.isFocus ? '★ ' : '• ';
        msg += `${focusMark}${w.name}  ${status}\n`;
      } else {
        msg += `• ${w.name}  (시세 조회 실패)\n`;
      }
    }
    if (list.length > 8) {
      msg += `  <i>... 외 ${list.length - 8}종목</i>\n`;
    }
  }

  // ── ③ FOMC / 특이사항 ─────────────────────────────────────────────────────
  msg += `━━━━━━━━━━━━━━━━\n`;
  if (fomc.phase !== 'NORMAL') {
    msg += `⚠️ 오늘 주의: ${fomc.description}\n`;
  }

  // Kelly 배율 표시
  const kellyNote = fomc.kellyMultiplier !== 1.0
    ? `Kelly ×${fomc.kellyMultiplier.toFixed(2)} 자동 적용`
    : null;
  if (kellyNote) {
    msg += `📌 ${kellyNote}\n`;
  }

  if (fomc.phase === 'NORMAL' && !kellyNote) {
    msg += `<i>오늘도 원칙대로 ✊</i>\n`;
  }

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[AutoTrade] 워치리스트 브리핑 완료 (구조화)');
}

/**
 * 장중 중간 점검 알림 — 포지션 보유 시에만 발송 (포지션 없는 날 생략)
 * @param type 'midday' | 'preclose'
 *   - 'midday'   : 오전 11:30 KST (UTC 02:30)
 *   - 'preclose' : 오후 14:00 KST (UTC 05:00)
 */
export async function sendIntradayCheckIn(type: 'midday' | 'preclose'): Promise<void> {
  const shadows = loadShadowTrades();
  const active = shadows.filter(
    s => s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' || s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL'
  );

  // 포지션 없는 날은 생략
  if (active.length === 0) return;

  const macro = loadMacroState();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const todaySignals = shadows.filter(
    s => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );

  // 각 활성 포지션에 대해 현재가 조회 (병렬)
  const positionLines: string[] = [];
  let nearStopLoss = false;
  let nearTarget = false;

  for (const shadow of active) {
    const currentPrice = await fetchCurrentPrice(shadow.stockCode).catch(() => null);
    if (!currentPrice) {
      positionLines.push(`• ${shadow.stockName} (시세 없음)`);
      continue;
    }
    const returnPct = ((currentPrice - shadow.shadowEntryPrice) / shadow.shadowEntryPrice) * 100;
    const distToTarget = ((shadow.targetPrice - currentPrice) / currentPrice) * 100;
    const distToStop   = ((currentPrice - shadow.stopLoss) / shadow.stopLoss) * 100;

    if (distToStop < 5) nearStopLoss = true;
    if (distToTarget < 3) nearTarget = true;

    const statusEmoji =
      distToTarget < 3  ? '🟢 목표 근접' :
      distToStop   < 5  ? '⚠️ 손절 모니터링' :
      returnPct    >= 0 ? '📈' : '📉';

    positionLines.push(
      `• ${shadow.stockName} ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}% ${statusEmoji}`
    );
  }

  // 주목할 상황이 없는 날(preclose)은 생략
  if (type === 'preclose' && !nearStopLoss && !nearTarget) return;

  // 헤더 시간은 unifiedBriefing footer 의 단일 타임스탬프로 통합한다 — 하드코딩 제거.
  const header = type === 'midday'
    ? `📡 <b>[장 중간 현황]</b>`
    : `⏰ <b>[마감 2시간 전]</b>`;

  const msg =
    `${header}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `활성 포지션: ${active.length}개\n` +
    positionLines.join('\n') + '\n\n' +
    `오늘 신호: ${todaySignals.length}건\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log(`[AutoTrade] 장중 점검 알림 완료 (${type})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 시장상황 요약 레포트 — 장전 / 장중 / 장마감 자동 송출
// ═══════════════════════════════════════════════════════════════════════════

/** 변화율 포맷 헬퍼 */
function fmtPct(v: number | null | undefined): string {
  if (v == null) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** KOSPI 현재가 + 전일대비 변화율 조회 */
async function fetchKospiSnapshot(): Promise<{ price: number; changePct: number } | null> {
  const closes = await fetchCloses('^KS11', '5d').catch(() => null);
  if (!closes || closes.length < 2) return null;
  const current = closes[closes.length - 1];
  const prev    = closes[closes.length - 2];
  return { price: current, changePct: ((current - prev) / prev) * 100 };
}

/** USD/KRW 현재 + 전일대비 */
async function fetchUsdKrwSnapshot(): Promise<{ rate: number; changePct: number } | null> {
  const closes = await fetchCloses('KRW=X', '5d').catch(() => null);
  if (!closes || closes.length < 2) return null;
  const current = closes[closes.length - 1];
  const prev    = closes[closes.length - 2];
  return { rate: current, changePct: ((current - prev) / prev) * 100 };
}

/**
 * 장전 시장 브리핑 — 평일 08:30 KST
 * 간밤 글로벌 시장 + 거시 지표 + 오늘 주목할 점을 요약하여 Telegram 발송
 */
export async function sendPreMarketReport(): Promise<void> {
  const macro      = loadMacroState();
  const watchlist  = loadWatchlist();
  const globalScan = loadGlobalScanReport();

  // 글로벌 지수 (간밤 globalScanAgent 결과 활용)
  const sp500   = globalScan?.symbols.find(s => s.symbol === '^GSPC');
  const ndx     = globalScan?.symbols.find(s => s.symbol === '^IXIC');
  const vixData = globalScan?.symbols.find(s => s.symbol === '^VIX');
  const ewy     = globalScan?.symbols.find(s => s.symbol === 'EWY');

  // USD/KRW
  const usdKrw = await fetchUsdKrwSnapshot();

  // 섹터 경보
  const alerts = globalScan?.sectorAlerts ?? [];
  const alertLines = alerts.length > 0
    ? alerts.map(a => `  ${a.direction === 'BULLISH' ? '🟢' : '🔴'} ${a.label} ${fmtPct(a.changePct)} → ${a.koreaSectors}`).join('\n')
    : '  없음';

  // Gemini AI 한줄 브리핑
  const aiPrompt =
    `오늘 한국 주식시장 장전 브리핑 (1~2문장).\n` +
    `데이터: S&P500 ${fmtPct(sp500?.changePct)}, 나스닥 ${fmtPct(ndx?.changePct)}, ` +
    `VIX ${vixData?.price ?? 'N/A'}, EWY ${fmtPct(ewy?.changePct)}, ` +
    `USD/KRW ${usdKrw?.rate?.toFixed(0) ?? 'N/A'}원(${fmtPct(usdKrw?.changePct)}), ` +
    `MHS ${macro?.mhs ?? 'N/A'}(${macro?.regime ?? 'N/A'}).\n` +
    `KOSPI 예상 방향 + 핵심 근거를 한국어 2문장으로 답하라.`;
  const aiOneLiner = await callGemini(aiPrompt, 'pre-market-brief').catch(() => null);

  // Nightly Reflection Engine #5 — 어제 반성에서 도출한 1줄 학습 포인트 주입.
  // forDate 가 오늘 KST 와 일치할 때만 표시 (과거 priming 이 누적되어도 stale 노출 방지).
  const todayKst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
  const priming = loadTomorrowPriming();
  const primingLine = priming && priming.forDate === todayKst && priming.oneLineLearning
    ? `\n🌅 <b>오늘의 학습 포인트:</b> ${priming.oneLineLearning}\n`
    : '';

  const msg =
    `🌅 <b>[장전 브리핑] ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    primingLine +
    `<b>🌏 간밤 글로벌</b>\n` +
    `  S&P500: ${sp500?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(sp500?.changePct)})\n` +
    `  나스닥: ${ndx?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(ndx?.changePct)})\n` +
    `  VIX: ${vixData?.price?.toFixed(1) ?? 'N/A'}\n` +
    `  EWY: ${fmtPct(ewy?.changePct)}\n\n` +
    `<b>📊 거시 지표</b>\n` +
    `  MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n` +
    `  USD/KRW: ${usdKrw?.rate?.toFixed(0) ?? 'N/A'}원 (${fmtPct(usdKrw?.changePct)})\n` +
    (macro?.yieldCurve10y2y !== undefined ? `  10Y-2Y: ${macro.yieldCurve10y2y.toFixed(2)}%\n` : '') +
    (macro?.wtiCrude !== undefined ? `  WTI: $${macro.wtiCrude.toFixed(1)}\n` : '') +
    `\n<b>🔔 섹터 경보</b>\n${alertLines}\n\n` +
    `<b>📋 워치리스트</b>: ${watchlist.length}개` +
    (watchlist.length > 0
      ? ` (${watchlist.slice(0, 5).map(w => w.name).join(', ')}${watchlist.length > 5 ? ' 외' : ''})`
      : '') + '\n' +
    (aiOneLiner ? `\n🤖 <b>AI 전망:</b> ${aiOneLiner}` : '');

  await sendTelegramAlert(msg).catch(console.error);

  // 채널: 구독자 대상 간결 브리핑 (자산/잔고 제외)
  const regime = macro?.regime ?? 'R4_NEUTRAL';
  const focusCodes = watchlist.filter(w => w.isFocus);
  await channelMarketBriefing({
    regime,
    mhs:            macro?.mhs ?? 0,
    vkospi:         vixData?.price ?? undefined,
    kospiChange:    macro?.kospiDayReturn,
    usdKrw:         usdKrw?.rate,
    watchlistCount: watchlist.length,
    focusCount:     focusCodes.length,
    aiSummary:      aiOneLiner ?? undefined,
  }).catch(console.error);

  console.log('[MarketReport] 장전 브리핑 발송 완료');
}

/**
 * 장중 시장 현황 레포트 — 평일 12:00 KST
 * KOSPI 실시간 + 활성 포지션 + 오전 거래 요약 + 주목 이벤트
 */
export async function sendIntradayMarketReport(): Promise<void> {
  const macro    = loadMacroState();
  const shadows  = loadShadowTrades();
  const today    = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  // PR-15: signalTime 이 아니라 fill timestamp 기준. 부분매도 익절도 P&L 에 반영.
  const todaySignals = shadows.filter(
    s => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );
  const active   = shadows.filter(s =>
    s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' ||
    s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL'
  );

  // KOSPI 실시간
  const kospi  = await fetchKospiSnapshot();
  const usdKrw = await fetchUsdKrwSnapshot();

  // 활성 포지션 현재가 조회
  const posLines: string[] = [];
  for (const s of active.slice(0, 8)) {
    const cur = await fetchCurrentPrice(s.stockCode).catch(() => null);
    if (cur) {
      const ret = ((cur - s.shadowEntryPrice) / s.shadowEntryPrice) * 100;
      posLines.push(`  ${ret >= 0 ? '📈' : '📉'} ${s.stockName} ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`);
    } else {
      posLines.push(`  • ${s.stockName} (시세 없음)`);
    }
  }

  const r = summarizeTodayRealizations(collectTodayRealizations(shadows, today));

  const msg =
    `📡 <b>[장중 시장 현황]</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `<b>📊 KOSPI</b>: ${kospi ? `${kospi.price.toFixed(2)} (${fmtPct(kospi.changePct)})` : 'N/A'}\n` +
    `<b>💱 USD/KRW</b>: ${usdKrw ? `${usdKrw.rate.toFixed(0)}원 (${fmtPct(usdKrw.changePct)})` : 'N/A'}\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n\n` +
    `<b>📈 오전 거래 요약</b>\n` +
    `  오늘 신호: ${todaySignals.length}건\n` +
    `  실현 이벤트: ${r.realizationCount}건 (익 ${r.wins} / 손 ${r.losses})` +
      (r.partialOnlyCount > 0 ? ` · 부분매도 ${r.partialOnlyCount}건` : '') + `\n` +
    `  P&L(가중): ${fmtPct(r.weightedReturnPct !== 0 ? r.weightedReturnPct : null)}` +
      ` | 실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원\n\n` +
    (active.length > 0
      ? `<b>💼 활성 포지션 (${active.length}개)</b>\n${posLines.join('\n')}\n`
      : `<b>💼 활성 포지션</b>: 없음\n`);

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[MarketReport] 장중 시장 현황 발송 완료');
}

/**
 * 장마감 시장 요약 레포트 — 평일 15:35 KST
 * 당일 종합: KOSPI 종가 + 거래 결과 + 포지션 현황 + Gemini AI 내일 전망
 */
export async function sendPostMarketReport(): Promise<void> {
  const macro     = loadMacroState();
  const shadows   = loadShadowTrades();
  const watchlist = loadWatchlist();
  const stats     = getMonthlyStats();
  const today     = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  // PR-15: signalTime 이 아니라 fill timestamp 기준. 부분매도 익절 포함.
  const todaySignals = shadows.filter(
    s => new Date(s.signalTime).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) === today,
  );
  const active    = shadows.filter(s =>
    s.status === 'ORDER_SUBMITTED' || s.status === 'PARTIALLY_FILLED' ||
    s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL'
  );
  const realizations = collectTodayRealizations(shadows, today);
  const r = summarizeTodayRealizations(realizations);

  // KOSPI 종가
  const kospi  = await fetchKospiSnapshot();
  const usdKrw = await fetchUsdKrwSnapshot();

  // 실현 이벤트 상세 (부분매도 포함)
  const closedLines = realizations.length > 0
    ? realizations.map(x => {
        const ret = x.fill.pnlPct ?? 0;
        const icon = ret >= 0 ? '✅' : '❌';
        const kind = x.isFinalClose
          ? (x.trade.status === 'HIT_TARGET' ? '전량익절' : '전량손절')
          : '부분익절';
        return `  ${icon} ${x.trade.stockName} ${kind} ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% · ${x.fill.qty}주`;
      }).join('\n')
    : '  (오늘 실현 이벤트 없음)';

  // Gemini AI 내일 전망
  const aiPrompt =
    `오늘 한국 주식시장 마감 후 요약 + 내일 전망 (2~3문장).\n` +
    `데이터: KOSPI ${kospi ? `${kospi.price.toFixed(2)} (${fmtPct(kospi.changePct)})` : 'N/A'}, ` +
    `USD/KRW ${usdKrw?.rate?.toFixed(0) ?? 'N/A'}원, MHS ${macro?.mhs ?? 'N/A'}(${macro?.regime ?? 'N/A'}), ` +
    `오늘 실현 ${r.realizationCount}건 (익 ${r.wins}/손 ${r.losses}) WIN률 ${r.winRate}% P&L(가중) ${r.weightedReturnPct >= 0 ? '+' : ''}${r.weightedReturnPct.toFixed(2)}%.\n` +
    `주의: "실현" 에는 부분매도 익절도 포함되어 있으니 "손실만 있었다" 고 단정 짓지 말고 P&L 가중치 부호와 각 실현 항목 부호를 그대로 따라 서술하라.\n` +
    `오늘 시장을 1문장으로 요약 + 내일 주의사항 1~2개 bullet으로 한국어 답변하라.`;
  const aiOutlook = await callGemini(aiPrompt, 'post-market-brief').catch(() => null);

  const msg =
    `🌇 <b>[장마감 요약] ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `<b>📊 KOSPI 종가</b>: ${kospi ? `${kospi.price.toFixed(2)} (${fmtPct(kospi.changePct)})` : 'N/A'}\n` +
    `<b>💱 USD/KRW</b>: ${usdKrw ? `${usdKrw.rate.toFixed(0)}원 (${fmtPct(usdKrw.changePct)})` : 'N/A'}\n` +
    `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n\n` +
    `<b>📈 당일 거래 결과</b>\n` +
    `  신호: ${todaySignals.length}건 | 실현: ${r.realizationCount}건` +
      (r.partialOnlyCount > 0 ? ` (부분 ${r.partialOnlyCount} · 전량 ${r.fullClosedCount})` : '') + `\n` +
    `  WIN률: ${r.winRate}% | P&L(가중): ${r.weightedReturnPct >= 0 ? '+' : ''}${r.weightedReturnPct.toFixed(2)}% | 실현 ${Math.round(r.totalRealizedKrw).toLocaleString()}원\n` +
    `${closedLines}\n\n` +
    `<b>💼 보유 포지션</b>: ${active.length}개\n` +
    `<b>📋 워치리스트</b>: ${watchlist.length}개\n\n` +
    `<b>📅 월간 (${stats.month})</b>\n` +
    `  전체 ${stats.total}건 | WIN률 ${stats.winRate.toFixed(1)}%\n` +
    `  평균수익 ${stats.avgReturn.toFixed(2)}% | STRONG_BUY ${stats.strongBuyWinRate.toFixed(1)}%\n` +
    (aiOutlook ? `\n🤖 <b>AI 전망:</b>\n${aiOutlook}` : '');

  await sendTelegramAlert(msg).catch(console.error);

  // NOTE: 파이프라인 트레이서 요약은 16:40 KST scanReviewReport 로 이관되었다 (IDEA 1).
  // 상위 탈락 이유 Top3 + 내일 후보를 포함한 확장 포맷으로 DM+채널 동시 발송한다.

  console.log('[MarketReport] 장마감 요약 발송 완료');
}

/**
 * 온디맨드 시장 요약 — /market 명령어로 즉시 호출
 * 현재 시간대에 따라 적절한 레포트 유형을 자동 선택
 */
export async function sendMarketSummaryOnDemand(): Promise<void> {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const t   = kst.getUTCHours() * 100 + kst.getUTCMinutes();

  if (t < 900) {
    // 장전
    await sendPreMarketReport();
  } else if (t < 1530) {
    // 장중
    await sendIntradayMarketReport();
  } else {
    // 장마감 이후
    await sendPostMarketReport();
  }
}
