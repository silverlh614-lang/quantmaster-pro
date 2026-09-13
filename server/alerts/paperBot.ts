// @responsibility Deliver current Shadow bot notifications.
import { createHash } from 'node:crypto';
import { getAutoTradePaused, getTradingMode } from '../state.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { getPaperExperimentView } from '../trading/paper/paperExperimentRunner.js';
import { loadNewsSupplyRecords } from '../learning/newsSupplyLogger.js';
import { loadDartAlerts } from '../persistence/dartRepo.js';
import { loadPaperBotState, savePaperBotState, type PaperBotHealth, type PaperBotMessage, type PaperBotState } from '../persistence/paperBotRepo.js';
import { sendTelegramAlert } from './telegramClient.js';
import { PAPER_BOT_SCHEDULES, formatPaperReport, formatPaperResearch, formatPaperTrades, paperTradeEvents } from './paperBotMessages.js';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const processStartedAt = Date.now();
let running: Promise<void> | undefined;

export function recentPaperNews(now = new Date()): string[] {
  const cutoff = now.getTime() - DAY;
  const items = [
    ...loadNewsSupplyRecords().filter(item => (item.koreanStockCodes?.length ?? 0) > 0).map(item => ({ id: item.id, title: item.newsHeadline, at: item.detectedAt })),
    ...loadDartAlerts().map(item => ({ id: `dart:${item.rcept_no}`, title: `${item.corp_name}: ${item.report_nm}`, at: item.alertedAt })),
  ].filter(item => Date.parse(item.at) >= cutoff && Date.parse(item.at) <= now.getTime()).sort((a, b) => b.at.localeCompare(a.at));
  return [...new Map(items.map(item => [item.id, item.title])).values()];
}

function enqueue(state: PaperBotState, message: Omit<PaperBotMessage, 'state' | 'attempts' | 'nextAttemptAt'>): void {
  if (!state.messages.some(item => item.id === message.id)) state.messages.push({ ...message, state: 'PENDING', attempts: 0, nextAttemptAt: message.createdAt });
}

export function enqueuePaperReports(state: PaperBotState, view: PaperExperimentView, now: Date, news: () => string[] = () => []): void {
  const date = toKstDateKey(now);
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  for (const slot of PAPER_BOT_SCHEDULES) {
    const eligibleDay = slot.kind === 'weekly' ? kst.getUTCDay() === 0 : isKrxTradingDay(date);
    if (!eligibleDay || minute < slot.minute || minute >= slot.minute + slot.graceMinutes) continue;
    // A loading report is retried next minute instead of consuming the weekly slot.
    if (slot.kind === 'weekly' && !view.research) continue;
    const id = `paper:${slot.kind}:${date}`;
    if (state.messages.some(item => item.id === id)) continue;
    const expiresAt = new Date(Date.parse(`${date}T00:00:00+09:00`) + (slot.minute + slot.graceMinutes) * MINUTE).toISOString();
    const message = slot.kind === 'weekly' ? formatPaperResearch(view) : formatPaperReport(view, slot.kind, date, news());
    enqueue(state, { id, kind: slot.kind, message, createdAt: now.toISOString(), expiresAt });
  }
}

export function enqueuePaperTradeChanges(state: PaperBotState, view: PaperExperimentView, now: Date): void {
  if (!view.strategy || view.strategy.error || view.strategy.lastRun?.error) return;
  const events = paperTradeEvents(view.strategy.trades).filter(item => Date.parse(item.at) >= now.getTime() - 7 * DAY && Date.parse(item.at) <= now.getTime());
  const added = events.filter(item => !state.seenEvents[item.id]).sort((a, b) => a.at.localeCompare(b.at));
  if (state.initializedAt && added.length) {
    const hash = createHash('sha256').update(added.map(item => item.id).sort().join('|')).digest('hex').slice(0, 20);
    enqueue(state, { id: `paper:trades:${hash}`, kind: 'trades', message: formatPaperTrades(added), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString() });
  }
  for (const event of events) state.seenEvents[event.id] = event.at;
}

export function classifyPaperBotHealth(view: PaperExperimentView | undefined, paused: boolean, now: Date, startedAt = processStartedAt, previous: PaperBotHealth = 'OK'): PaperBotHealth {
  if (paused) return 'PAUSED';
  if (now.getTime() - startedAt < 10 * MINUTE && (!view?.lastRun || now.getTime() - Date.parse(view.lastRun.asOf) > 10 * MINUTE)) return previous;
  if (!view) return 'UNAVAILABLE';
  if (view.strategy?.error || view.strategy?.lastRun?.error) return 'STRATEGY_ERROR';
  const last = view.lastRun;
  if (!last || !Number.isFinite(Date.parse(last.asOf)) || now.getTime() - Date.parse(last.asOf) > 10 * MINUTE) return 'STALE';
  if (last.marketOpen && last.candidateCount > 0 && last.observedCount === 0) return 'PRICE_MISSING';
  return 'OK';
}

export function enqueuePaperHealth(state: PaperBotState, health: PaperBotHealth, now: Date): void {
  if (state.health === health) return;
  state.health = health;
  for (const message of state.messages) if (message.kind === 'health' && message.state === 'PENDING') message.state = 'SUPERSEDED';
  if (health === 'OK' && state.notifiedHealth === 'OK') return;
  const text: Record<PaperBotHealth, string> = {
    OK: '관측이 다시 갱신되고 있습니다.', PAUSED: '자동 관측이 일시정지 상태로 전환됐습니다.',
    STALE: '10분 넘게 완료된 관측이 없습니다. 서버의 수집 상태를 확인하세요.',
    UNAVAILABLE: 'Shadow 원장을 읽지 못했습니다. 서버 저장 자료 확인이 필요합니다.',
    PRICE_MISSING: '장중 최근 관측에서 현재가를 확인한 종목이 없습니다. 가격 공급 상태를 확인하세요.',
    STRATEGY_ERROR: '뉴스·추세 전략 기록 갱신에 오류가 있습니다. 최근 스캔 오류를 확인하세요.',
  };
  enqueue(state, { id: `paper:health:${health}:${now.toISOString()}`, kind: 'health', health,
    message: `<b>Shadow 운영 ${health === 'OK' ? '복구' : health === 'PAUSED' ? '상태' : '확인 필요'}</b>\n${text[health]}\n수집 상태 알림이며 시장 위험 신호가 아닙니다.\n/paper · /paper_bot`,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  });
}

async function deliverPending(state: PaperBotState, now: Date): Promise<void> {
  const pending = state.messages.filter(item => item.state === 'PENDING' && Date.parse(item.nextAttemptAt) <= now.getTime()).slice(0, 3);
  for (const message of pending) {
    if (Date.parse(message.expiresAt) <= now.getTime()) { message.state = 'EXPIRED'; savePaperBotState(state); continue; }
    message.attempts++;
    message.lastAttemptAt = now.toISOString();
    message.nextAttemptAt = new Date(now.getTime() + Math.min(15, 2 ** (message.attempts - 1)) * MINUTE).toISOString();
    savePaperBotState(state);
    let messageId: number | undefined;
    try {
      messageId = await sendTelegramAlert(message.message, { priority: 'NORMAL', tier: 'T2_REPORT', requireAck: false,
        category: 'paper_bot', notificationEventType: `PAPER_BOT_${message.kind.toUpperCase()}`,
        notificationSeverity: message.kind === 'trades' ? 'TRADE_EVENT' : 'SUMMARY',
        dedupeKey: message.id, eventId: message.id, cooldownMs: 0,
      });
    } catch (error) { console.error('[PaperBot] 전송 실패:', error instanceof Error ? error.name : 'unknown error'); }
    if (typeof messageId === 'number' && Number.isFinite(messageId) && messageId > 0) {
      message.state = 'SENT'; message.messageId = messageId; message.sentAt = now.toISOString(); delete message.error;
      if (message.health) state.notifiedHealth = message.health;
    } else {
      message.error = 'Telegram 메시지 ID 미확인';
      if (message.attempts >= 6) message.state = 'FAILED';
    }
    savePaperBotState(state);
  }
}

async function tick(now: Date): Promise<void> {
  if (getTradingMode() !== 'SHADOW') return;
  const state = loadPaperBotState();
  let view: PaperExperimentView | undefined;
  try { view = getPaperExperimentView(); }
  catch (error) { console.error('[PaperBot] 관측 원장 조회 실패:', error instanceof Error ? error.name : 'unknown error'); }
  enqueuePaperHealth(state, classifyPaperBotHealth(view, getAutoTradePaused(), now, processStartedAt, state.health), now);
  if (view) {
    enqueuePaperReports(state, view, now, () => recentPaperNews(now));
    enqueuePaperTradeChanges(state, view, now);
    if (view.strategy && !view.strategy.error && !view.strategy.lastRun?.error) state.initializedAt ??= now.toISOString();
  }
  state.lastCheckedAt = now.toISOString();
  state.messages = state.messages.filter(item => Date.parse(item.createdAt) >= now.getTime() - 14 * DAY);
  state.seenEvents = Object.fromEntries(Object.entries(state.seenEvents).filter(([, at]) => Date.parse(at) >= now.getTime() - 14 * DAY));
  savePaperBotState(state);
  await deliverPending(state, now);
}

export function runPaperBotTick(now = new Date()): Promise<void> {
  if (!running) running = tick(now).finally(() => { running = undefined; });
  return running;
}
