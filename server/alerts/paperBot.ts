// @responsibility Deliver current Shadow bot notifications.
import { createHash } from 'node:crypto';
import { getAutoTradePaused, getTradingMode } from '../state.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { getPaperExperimentView } from '../trading/paper/paperExperimentRunner.js';
import { loadNewsSupplyRecords } from '../learning/newsSupplyLogger.js';
import { loadDartAlerts } from '../persistence/dartRepo.js';
import { loadPaperBotState, savePaperBotState, type PaperBotHealth, type PaperBotMessage, type PaperBotState } from '../persistence/paperBotRepo.js';
import { sendTelegramAlert } from './telegramClient.js';
import { dispatchAlert, ChannelSemantic } from './alertRouter.js';
import { PAPER_BOT_SCHEDULES, formatPaperReport, formatPaperResearch, formatPaperTrades, formatPaperTradeAnalysis, paperTradeEvents } from './paperBotMessages.js';
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import { isPaperMarketOpen } from '../trading/paper/paperExperimentCollector.js';
import { maintainGlobalMorningNews, getGlobalMorningMessage } from './globalNewsRuntime.js';
import { formatPaperIntraday, formatPaperResearchChanges } from './paperResearchMessages.js';
import type { PaperAdaptiveRule, PaperAdaptiveState } from '../../src/types/paperAdaptive.js';
import type { PaperMorningReport } from '../../src/types/paperMorning.js';
import { getOrCreatePaperMorningReport, reconcilePaperMorningDelivery } from '../trading/paper/paperMorningRuntime.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const processStartedAt = Date.now();
let running: Promise<void> | undefined;
const confirmedMorningDeliveries = new Set<string>();
const MORNING_ARCHIVE_ACK_ERROR = '추천 발송 확인의 영구 보관 갱신 실패';

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

function duePaperReportSlots(state: PaperBotState, now: Date) {
  const date = toKstDateKey(now);
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const queued = new Set(state.messages.map(message => message.id));
  return PAPER_BOT_SCHEDULES.flatMap(slot => {
    const eligibleDay = slot.kind === 'recommendation' || (slot.kind === 'weekly' ? kst.getUTCDay() === 0 : isKrxTradingDay(date));
    const id = `paper:${slot.kind}:${date}${slot.kind === 'intraday' ? `:${slot.minute}` : ''}`;
    return eligibleDay && minute >= slot.minute && minute < slot.minute + slot.graceMinutes && !queued.has(id)
      ? [{ ...slot, id, date }] : [];
  });
}

interface PaperReportOptions {
  morning?: () => string | null;
  paused?: boolean;
  recommendation?: () => PaperMorningReport | null;
}

export function enqueuePaperReports(state: PaperBotState, view: PaperExperimentView | undefined, now: Date, options: PaperReportOptions = {}): void {
  const { morning, paused = false, recommendation } = options;
  for (const slot of duePaperReportSlots(state, now)) {
    const { id, date } = slot;
    // A loading report is retried next minute instead of consuming the weekly slot.
    if (slot.kind === 'morning' ? !morning : !view && slot.kind !== 'recommendation') continue;
    if (slot.kind === 'weekly' && !view?.research && !view?.strategy?.adaptive) continue;
    if (slot.kind === 'intraday' && (paused || !hasFreshPaperDecisions(view, now))) continue;
    const expiresAt = new Date(Date.parse(`${date}T00:00:00+09:00`) + (slot.minute + slot.graceMinutes) * MINUTE).toISOString();
    if (slot.kind === 'recommendation') {
      if (!recommendation) continue;
      try {
        const report = recommendation();
        if (!report) continue;
        enqueue(state, { id, kind: slot.kind, channel: ChannelSemantic.SIGNAL, message: report.message, createdAt: report.createdAt, expiresAt });
        // An archived acknowledgment also prevents replay if the shorter-lived outbox was restored separately.
        if (report.delivery) Object.assign(state.messages.find(item => item.id === id)!, {
          state: 'SENT', sentAt: report.delivery.sentAt, messageId: report.delivery.messageId,
        });
      } catch (error) { console.error('[PaperBot] 아침 추천 보관 실패:', error instanceof Error ? error.message : String(error)); }
      continue;
    }
    const message = slot.kind === 'morning' ? morning!()
      : slot.kind === 'weekly' ? formatPaperResearch(view!, now)
        : slot.kind === 'intraday' ? formatPaperIntraday(view!, date, now)
          : formatPaperReport(view!, slot.kind, date, [], now);
    if (!message) continue;
    const channel = slot.kind === 'morning' ? ChannelSemantic.REGIME
      : slot.kind === 'intraday' ? ChannelSemantic.SIGNAL : ChannelSemantic.JOURNAL;
    enqueue(state, { id, kind: slot.kind, channel, message, createdAt: now.toISOString(), expiresAt });
  }
}

function hasFreshPaperDecisions(view: PaperExperimentView | undefined, now: Date): boolean {
  const monitored = view?.priceMonitor;
  const monitorUpdate = monitored && !monitored.error && monitored.completedAt && view?.strategy?.lastRun
    && view.strategy.lastRun.snapshotId.startsWith('paper_prices_')
    && Date.parse(view.strategy.lastRun.asOf) <= Date.parse(monitored.completedAt)
    && Date.parse(view.strategy.lastRun.asOf) >= Date.parse(view.lastRun?.asOf ?? '');
  if (!view?.lastRun?.marketOpen || !view.strategy?.lastRun || view.strategy.error || view.strategy.lastRun.error
    || (view.strategy.lastRun.snapshotId !== view.lastRun.snapshotId && !monitorUpdate)) return false;
  return [view.lastRun.asOf, view.strategy.lastRun.asOf].every(at => {
    const age = now.getTime() - Date.parse(at);
    return age >= 0 && age <= 10 * MINUTE && toKstDateKey(at) === toKstDateKey(now);
  });
}

function researchEventId(change: PaperAdaptiveState['changes'][number]): string {
  const rule = (value: PaperAdaptiveRule | null) => value && [value.feature, value.bucket, value.horizon, value.invention?.createdAt];
  return `research:${createHash('sha256').update(JSON.stringify([change.at, change.feature, rule(change.from), rule(change.to), change.reason])).digest('hex').slice(0, 24)}`;
}

export function enqueuePaperResearchChanges(state: PaperBotState, view: PaperExperimentView, now: Date): void {
  const strategy = view.strategy, adaptive = strategy?.adaptive;
  if (!strategy || strategy.error || strategy.lastRun?.error) return;
  if (adaptive && !(Date.parse(adaptive.evaluatedAt) <= now.getTime())) return;
  const events = (adaptive?.changes ?? []).filter(change => {
    const at = Date.parse(change.at);
    return at >= now.getTime() - DAY && at <= now.getTime() && at <= Date.parse(adaptive!.evaluatedAt);
  }).map(change => ({ change, id: researchEventId(change) })).sort((a, b) => a.change.at.localeCompare(b.change.at));
  if (!state.researchInitializedAt) {
    for (const event of events) state.seenEvents[event.id] = event.change.at;
    state.researchInitializedAt = now.toISOString();
    return;
  }
  const added = events.filter(event => !state.seenEvents[event.id] && Date.parse(event.change.at) >= Date.parse(state.researchInitializedAt!));
  for (let offset = 0; offset < added.length;) {
    const batch = added.slice(offset, offset + 3);
    let message = formatPaperResearchChanges(adaptive!, batch.map(item => item.change), now);
    while (batch.length > 1 && message.length > 3500) {
      batch.pop(); message = formatPaperResearchChanges(adaptive!, batch.map(item => item.change), now);
    }
    offset += batch.length;
    const hash = createHash('sha256').update(batch.map(item => item.id).sort().join('|')).digest('hex').slice(0, 20);
    enqueue(state, { id: `paper:research:${hash}`, kind: 'research', channel: ChannelSemantic.JOURNAL,
      message,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString() });
  }
  for (const event of events) state.seenEvents[event.id] = event.change.at;
}

export function enqueuePaperTradeChanges(state: PaperBotState, view: PaperExperimentView, now: Date): void {
  if (!view.strategy || view.strategy.error || view.strategy.lastRun?.error) return;
  const events = paperTradeEvents(view.strategy.trades).filter(item => Date.parse(item.at) >= now.getTime() - 7 * DAY && Date.parse(item.at) <= now.getTime());
  const added = events.filter(item => !state.seenEvents[item.id]).sort((a, b) => a.at.localeCompare(b.at));
  if (state.initializedAt && added.length) {
    // Bound both channel payloads; every event is included, even in a large scan.
    for (let offset = 0; offset < added.length;) {
      const batch = added.slice(offset, offset + 5);
      let tradeMessage = formatPaperTrades(batch), analysisMessage = formatPaperTradeAnalysis(batch);
      while (batch.length > 1 && Math.max(tradeMessage.length, analysisMessage.length) > 3500) {
        batch.pop(); tradeMessage = formatPaperTrades(batch); analysisMessage = formatPaperTradeAnalysis(batch);
      }
      offset += batch.length;
      const hash = createHash('sha256').update(batch.map(item => item.id).sort().join('|')).digest('hex').slice(0, 20);
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + 6 * 3_600_000).toISOString();
      for (const [channel, message] of [
        [ChannelSemantic.EXECUTION, tradeMessage],
        [ChannelSemantic.SIGNAL, analysisMessage],
      ] as const) {
        enqueue(state, { id: `paper:trades:${hash}:${channel}`, kind: 'trades', channel, message, createdAt, expiresAt });
      }
    }
  }
  for (const event of events) state.seenEvents[event.id] = event.at;
}

export function classifyPaperBotHealth(view: PaperExperimentView | undefined, paused: boolean, now: Date, startedAt = processStartedAt, previous: PaperBotHealth = 'OK'): PaperBotHealth {
  if (paused) return 'PAUSED';
  if (now.getTime() - startedAt < 10 * MINUTE && (!view?.lastRun || now.getTime() - Date.parse(view.lastRun.asOf) > 10 * MINUTE)) return previous;
  if (!view) return 'UNAVAILABLE';
  if (view.strategy?.error || view.strategy?.lastRun?.error) return 'STRATEGY_ERROR';
  const last = view.lastRun;
  const marketOpen = isPaperMarketOpen(now);
  const staleMs = marketOpen ? 10 * MINUTE : Math.max(60 * MINUTE, (view.scanIntervalSeconds ?? 0) * 1000 + 10 * MINUTE);
  const lastAt = Date.parse(last?.asOf ?? '');
  if (!Number.isFinite(lastAt) || lastAt > now.getTime() || now.getTime() - lastAt > staleMs) {
    const progress = view.collection;
    const start = Date.parse(progress?.startedAt ?? '');
    const advanced = Date.parse(progress?.lastProgressAt ?? '');
    // Progress proves activity, not recovery. Only a completed scan clears a reported delay.
    if (progress && Number.isInteger(progress.completed) && Number.isInteger(progress.total)
      && progress.completed > 0 && progress.completed <= progress.total
      && start <= advanced && advanced <= now.getTime() && (!Number.isFinite(lastAt) || start >= lastAt)
      && now.getTime() - advanced <= 2 * MINUTE && now.getTime() - start <= (marketOpen ? 30 : 120) * MINUTE) {
      return previous === 'STALE' ? 'STALE' : 'OK';
    }
    return 'STALE';
  }
  if (marketOpen && last!.marketOpen && last!.candidateCount > 0 && last!.observedCount === 0) return 'PRICE_MISSING';
  return 'OK';
}

export function enqueuePaperHealth(state: PaperBotState, health: PaperBotHealth, now: Date, view?: PaperExperimentView): void {
  if (health === 'OK' && state.notifiedHealth === 'STALE' && view) {
    const reportedAt = Math.max(0, ...state.messages.filter(item => item.health === 'STALE' && item.state === 'SENT')
      .map(item => Date.parse(item.createdAt)).filter(Number.isFinite));
    // A quieter session threshold alone is not evidence that observations recovered.
    if (!(Date.parse(view.lastRun?.asOf ?? '') > reportedAt)) return;
  }
  if (state.health === health) {
    for (const message of state.messages) if (message.kind === 'health' && message.state === 'PENDING' && message.health === health) {
      message.message = formatPaperHealth(health, now, view);
    }
    return;
  }
  state.health = health;
  for (const message of state.messages) if (message.kind === 'health' && message.state === 'PENDING') message.state = 'SUPERSEDED';
  if (health === 'OK' && state.notifiedHealth === 'OK') return;
  const priorDelay = Math.max(0, ...state.messages.filter(item => item.kind === 'health' && item.health === 'STALE' && item.state === 'SENT')
    .map(item => Date.parse(item.sentAt ?? item.createdAt)).filter(Number.isFinite));
  const due = health === 'STALE' ? Math.max(now.getTime() + 5 * MINUTE, priorDelay + 60 * MINUTE) : now.getTime();
  const id = `paper:health:${health}:${now.toISOString()}`;
  enqueue(state, { id, kind: 'health', health, message: formatPaperHealth(health, now, view),
    createdAt: now.toISOString(), expiresAt: new Date(due + 3_600_000).toISOString(),
  });
  state.messages.find(item => item.id === id)!.nextAttemptAt = new Date(due).toISOString();
}

function formatPaperHealth(health: PaperBotHealth, now: Date, view?: PaperExperimentView): string {
  const text: Record<PaperBotHealth, string> = {
    OK: '관측이 다시 갱신되고 있습니다.', PAUSED: '자동 관측이 일시정지 상태로 전환됐습니다.',
    STALE: `${isPaperMarketOpen(now) ? '장중 10분' : '휴장·장외 60분'} 넘게 완료된 관측이 없고 수집 진행을 정상으로 확인하지 못했습니다.`,
    UNAVAILABLE: 'Shadow 원장을 읽지 못했습니다. 서버 저장 자료 확인이 필요합니다.',
    PRICE_MISSING: '장중 최근 관측에서 현재가를 확인한 종목이 없습니다. 가격 공급 상태를 확인하세요.',
    STRATEGY_ERROR: '자율 지표 전략 기록 갱신에 오류가 있습니다. 최근 스캔 오류를 확인하세요.',
  };
  const progress = view?.collection;
  const stamp = (at?: string) => at && Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '미기록';
  const details = health === 'STALE' ? `\n마지막 완료 ${stamp(view?.lastRun?.asOf)}${progress ? `\n수집 ${progress.completed}/${progress.total}종목 · 마지막 진행 ${stamp(progress.lastProgressAt)}` : '\n현재 진행 중인 수집 없음'}` : '';
  return `<b>Shadow 운영 ${health === 'OK' ? '복구' : health === 'PAUSED' ? '상태' : '확인 필요'}</b>\n${text[health]}${details}\n수집 상태 알림이며 시장 위험 신호가 아닙니다.\n/paper · /paper_bot`;
}

async function deliverPending(state: PaperBotState, now: Date, view: PaperExperimentView | undefined, paused: boolean, wallStartedAt: number): Promise<void> {
  const currentTime = () => new Date(now.getTime() + Math.max(0, Date.now() - wallStartedAt));
  const urgent = (item: PaperBotMessage) => Number(item.kind === 'recommendation' && Date.parse(item.expiresAt) > now.getTime());
  const pending = state.messages.filter(item => item.state === 'PENDING'
    && (Date.parse(item.nextAttemptAt) <= now.getTime() || Date.parse(item.expiresAt) <= now.getTime()))
    .sort((a, b) => urgent(b) - urgent(a)).slice(0, 3);
  for (const message of pending) {
    const attemptAt = message.kind === 'recommendation' ? currentTime() : now;
    if (Date.parse(message.expiresAt) <= attemptAt.getTime()) { message.state = 'EXPIRED'; savePaperBotState(state); continue; }
    if (message.kind === 'intraday') {
      if (paused || !hasFreshPaperDecisions(view, now)) continue;
      message.message = formatPaperIntraday(view!, toKstDateKey(now), now);
    }
    message.attempts++;
    message.lastAttemptAt = attemptAt.toISOString();
    message.nextAttemptAt = new Date(attemptAt.getTime() + Math.min(15, 2 ** (message.attempts - 1)) * MINUTE).toISOString();
    savePaperBotState(state);
    let messageId: number | undefined;
    try {
      messageId = message.channel ? await dispatchAlert(message.channel, message.message, {
        priority: 'NORMAL', delivery: 'immediate', eventType: `PAPER_BOT_${message.kind.toUpperCase()}`,
        // The durable bot ledger owns dedup. A failed transport must remain retryable.
        dedupeKey: message.id, cooldownMs: 0,
      }) : await sendTelegramAlert(message.message, { priority: 'NORMAL', tier: 'T2_REPORT', requireAck: false,
        category: 'paper_bot', notificationEventType: `PAPER_BOT_${message.kind.toUpperCase()}`,
        notificationSeverity: message.kind === 'trades' ? 'TRADE_EVENT' : 'SUMMARY',
        dedupeKey: message.id, eventId: message.id, cooldownMs: 0,
      });
    } catch (error) { console.error('[PaperBot] 전송 실패:', error instanceof Error ? error.name : 'unknown error'); }
    if (typeof messageId === 'number' && Number.isFinite(messageId) && messageId > 0) {
      // Include collection/queue/transport elapsed time; a late acknowledgment cannot precede a trade entry.
      message.state = 'SENT'; message.messageId = messageId;
      message.sentAt = (message.kind === 'recommendation' ? currentTime() : now).toISOString(); delete message.error;
      if (message.health) state.notifiedHealth = message.health;
    } else {
      message.error = 'Telegram 메시지 ID 미확인';
      if (message.attempts >= 6) message.state = 'FAILED';
    }
    savePaperBotState(state);
    if (message.kind === 'recommendation' && message.state === 'SENT') reconcileSentRecommendations(state, new Date(message.sentAt!));
  }
}

function reconcileSentRecommendations(state: PaperBotState, now: Date): void {
  const messages = state.messages.filter(item => item.kind === 'recommendation' && /^paper:recommendation:\d{4}-\d{2}-\d{2}$/.test(item.id)
    && item.state === 'SENT' && item.sentAt && Date.parse(item.sentAt) <= now.getTime() && (item.messageId ?? 0) > 0);
  const identity = (item: PaperBotMessage) => `${item.id}:${item.sentAt}:${item.messageId}`;
  const retained = new Set(messages.map(identity));
  for (const key of confirmedMorningDeliveries) if (!retained.has(key)) confirmedMorningDeliveries.delete(key);
  let changed = false;
  for (const message of messages) {
    const key = identity(message), date = message.id.slice('paper:recommendation:'.length);
    if (confirmedMorningDeliveries.has(key)) continue;
    try {
      reconcilePaperMorningDelivery(date, message.sentAt!, message.messageId!);
      confirmedMorningDeliveries.add(key);
      if (message.error) { delete message.error; changed = true; }
    } catch (error) {
      console.error('[PaperBot] 추천 발송 확인 보관 재시도:', error instanceof Error ? error.message : String(error));
      message.error = MORNING_ARCHIVE_ACK_ERROR; changed = true;
    }
  }
  if (changed) savePaperBotState(state);
}

async function tick(now: Date): Promise<void> {
  const wallStartedAt = Date.now();
  if (getTradingMode() !== 'SHADOW') return;
  const state = loadPaperBotState();
  reconcileSentRecommendations(state, now);
  const paused = getAutoTradePaused();
  maintainGlobalMorningNews(now);
  let view: PaperExperimentView | undefined;
  try { view = getPaperExperimentView(true, { includeComparisons: duePaperReportSlots(state, now).some(slot => slot.kind === 'weekly') }); }
  catch (error) { console.error('[PaperBot] 관측 원장 조회 실패:', error instanceof Error ? error.name : 'unknown error'); }
  enqueuePaperHealth(state, classifyPaperBotHealth(view, paused, now, processStartedAt, state.notifiedHealth), now, view);
  enqueuePaperReports(state, view, now, { morning: () => getGlobalMorningMessage(now), paused,
    recommendation: () => getOrCreatePaperMorningReport(view, now, paused) });
  if (view) {
    enqueuePaperTradeChanges(state, view, now);
    enqueuePaperResearchChanges(state, view, now);
    if (view.strategy && !view.strategy.error && !view.strategy.lastRun?.error) state.initializedAt ??= now.toISOString();
  }
  state.lastCheckedAt = now.toISOString();
  state.messages = state.messages.filter(item => Date.parse(item.createdAt) >= now.getTime() - 14 * DAY
    || (item.kind === 'recommendation' && item.state === 'SENT' && item.error === MORNING_ARCHIVE_ACK_ERROR));
  state.seenEvents = Object.fromEntries(Object.entries(state.seenEvents).filter(([, at]) => Date.parse(at) >= now.getTime() - 14 * DAY));
  savePaperBotState(state);
  await deliverPending(state, now, view, paused, wallStartedAt);
}

export function runPaperBotTick(now = new Date()): Promise<void> {
  if (!running) running = tick(now).finally(() => { running = undefined; });
  return running;
}
