import nodemailer from 'nodemailer';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
import { callGemini } from '../clients/geminiClient.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramAlert } from './telegramClient.js';

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
  const today   = new Date().toISOString().split('T')[0];
  const todayTrades = shadows.filter((s) => s.signalTime.startsWith(today));
  const closed = todayTrades.filter((s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP');
  const wins   = closed.filter((s) => s.status === 'HIT_TARGET');
  const totalReturn = closed.reduce((sum, s) => sum + (s.returnPct ?? 0), 0);
  const winRate = closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0;
  const watchlist = loadWatchlist();

  // ── 기본 수치 리포트 (이메일 / 폴백용) ────────────────────────────────────────
  const tradeLines = closed.map((s) =>
    `  ${s.status === 'HIT_TARGET' ? '✅' : '❌'} ${s.stockName}(${s.stockCode}) ${(s.returnPct ?? 0).toFixed(2)}%`
  ).join('\n') || '  (결산 없음)';

  const baseReport = [
    `[QuantMaster Pro] ${today} 자동매매 일일 리포트`,
    '',
    `▶ 당일 신호: ${todayTrades.length}건`,
    `▶ 결산 완료: ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})`,
    `▶ 적중률: ${winRate}%  |  일일 P&L: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`,
    `▶ MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})`,
    `▶ 워치리스트: ${watchlist.length}개`,
    '',
    tradeLines,
    '',
    `[월간 ${stats.month}] WIN률 ${stats.winRate.toFixed(1)}% | PF ${
      stats.wins > 0 && stats.losses > 0
        ? (stats.wins / (stats.losses || 1)).toFixed(2)
        : 'N/A'
    } | 평균수익 ${stats.avgReturn.toFixed(2)}%`,
    `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'SHADOW (가상매매)' : 'LIVE (실매매)'}`,
  ].join('\n');

  // ── Gemini AI 내러티브 생성 (googleSearch 없음 — 비용 절감) ─────────────────
  const dataBlock = [
    `날짜: ${today} (KST)`,
    `거래 모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? 'Shadow (가상매매)' : 'LIVE (실매매)'}`,
    `당일 신호: ${todayTrades.length}건 | 결산 ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})`,
    `일일 P&L: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`,
    `MHS: ${macro?.mhs ?? 'N/A'} | 레짐: ${macro?.regime ?? 'N/A'}`,
    `워치리스트: ${watchlist.length}개 (${watchlist.slice(0, 5).map(w => w.name).join(', ')}${watchlist.length > 5 ? ' 외' : ''})`,
    `월간 통계 (${stats.month}): 전체 ${stats.total}건 / WIN률 ${stats.winRate.toFixed(1)}% / 평균수익 ${stats.avgReturn.toFixed(2)}%`,
    `STRONG_BUY 적중률: ${stats.strongBuyWinRate.toFixed(1)}%`,
    closed.length > 0 ? `오늘 결산 종목: ${closed.map(s => `${s.stockName} ${(s.returnPct ?? 0).toFixed(2)}%`).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const geminiPrompt = [
    '당신은 한국 주식 자동매매 시스템의 일일 리포트 작성 AI입니다.',
    '아래 오늘의 거래 데이터를 바탕으로 트레이더가 내일 아침 읽을 간결한 한국어 내러티브 리포트를 작성하세요.',
    '형식: 오늘 요약 2~3문장 + 주목할 점 1~2개 bullet + 내일 주의사항 1~2개 bullet.',
    '반드시 한국어로, 300자 이내로 작성하세요. 외부 검색은 필요 없습니다.',
    '',
    '=== 오늘 데이터 ===',
    dataBlock,
  ].join('\n');

  const narrative = await callGemini(geminiPrompt);

  // ── Telegram 발송 (메인 채널) ──────────────────────────────────────────────
  const telegramMsg = narrative
    ? `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${narrative}\n\n` +
      `<i>P&L ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}% | ` +
      `WIN ${winRate}% (${wins.length}/${closed.length}) | MHS ${macro?.mhs ?? 'N/A'}</i>`
    : `📊 <b>[QuantMaster] ${today} 일일 리포트</b>\n\n${baseReport}`;

  await sendTelegramAlert(telegramMsg).catch(console.error);

  // ── 이메일 발송 (보조 채널, 미설정 시 스킵) ────────────────────────────────
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const emailBody = narrative ? `${narrative}\n\n---\n${baseReport}` : baseReport;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.REPORT_EMAIL ?? process.env.EMAIL_USER,
      subject: `[QuantMaster] ${today} 일일 리포트 — WIN률 ${winRate}%`,
      text: emailBody,
    }).catch((e: unknown) => console.error('[AutoTrade] 이메일 발송 실패:', e instanceof Error ? e.message : e));
    console.log('[AutoTrade] 일일 리포트 이메일 발송 →', process.env.REPORT_EMAIL ?? process.env.EMAIL_USER);
  }

  console.log('[AutoTrade] 일일 리포트 완료 (Telegram + 이메일)');
}

/**
 * 주간 성과 리포트 — 매주 금요일 16:30 KST (UTC 07:30) 자동 발송
 * 직전 7일간의 Shadow 거래 결과를 집계하여 Telegram으로 발송
 */
export async function generateWeeklyReport(): Promise<void> {
  const shadows = loadShadowTrades();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const week = shadows.filter(s => new Date(s.signalTime).getTime() > weekAgo);
  const closed = week.filter(s => s.status !== 'ACTIVE' && s.status !== 'PENDING');
  const wins = closed.filter(s => s.status === 'HIT_TARGET');
  const winRate = closed.length > 0 ? Math.round(wins.length / closed.length * 100) : 0;

  const msg =
    `📅 <b>주간 성과 리포트</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `이번 주 신호: ${week.length}건\n` +
    `결산: ${closed.length}건 (승 ${wins.length} / 패 ${closed.length - wins.length})\n` +
    `주간 WIN률: ${winRate}%`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[AutoTrade] 주간 리포트 완료');
}

/**
 * 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
 * 워치리스트 상위 5개 종목의 목표가/손절가를 요약하여 Telegram 발송
 */
export async function sendWatchlistBriefing(): Promise<void> {
  const list = loadWatchlist();
  if (list.length === 0) return;

  const lines = list.slice(0, 5).map(w =>
    `• ${w.name} | 목표 ${w.targetPrice.toLocaleString()} | 손절 ${w.stopLoss.toLocaleString()}`
  ).join('\n');

  const msg =
    `🌅 <b>장 시작 브리핑 (09:00)</b>\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `👀 워치리스트 ${list.length}개\n\n${lines}\n\n` +
    `<i>오늘도 원칙대로 ✊</i>`;

  await sendTelegramAlert(msg).catch(console.error);
  console.log('[AutoTrade] 워치리스트 브리핑 완료');
}

/**
 * 장중 중간 점검 알림 — 포지션 보유 시에만 발송 (포지션 없는 날 생략)
 * @param type 'midday' | 'preclose'
 *   - 'midday'   : 오전 11:30 KST (UTC 02:30)
 *   - 'preclose' : 오후 14:00 KST (UTC 05:00)
 */
export async function sendIntradayCheckIn(type: 'midday' | 'preclose'): Promise<void> {
  const shadows = loadShadowTrades();
  const active = shadows.filter(s => s.status === 'ACTIVE' || s.status === 'EUPHORIA_PARTIAL');

  // 포지션 없는 날은 생략
  if (active.length === 0) return;

  const macro = loadMacroState();
  const today = new Date().toISOString().split('T')[0];
  const todaySignals = shadows.filter(s => s.signalTime.startsWith(today));

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

  const header = type === 'midday'
    ? `📡 <b>[장 중간 현황] 11:30</b>`
    : `⏰ <b>[마감 2시간 전] 14:00</b>`;

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
