// @responsibility Preserve scheduled recommendations with subsequent virtual trade links.
import { isDeepStrictEqual } from 'node:util';
import type { PaperExperimentView, PaperSnapshot } from '../../../src/types/paperExperiment.js';
import type { PaperAdaptiveRule } from '../../../src/types/paperAdaptive.js';
import type { PaperStrategyLedger } from '../../../src/types/paperStrategy.js';
import type { PaperMorningReport } from '../../../src/types/paperMorning.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { loadPaperMorningReport, loadPaperMorningSource, savePaperMorningReport,
  savePaperMorningSource, markPaperMorningReportSent } from '../../persistence/paperMorningRepo.js';
import { loadPaperStrategyLedger } from '../../persistence/paperStrategyRepo.js';
import { buildPaperMorningSelection } from './paperMorningSelection.js';
import { formatPaperMorningMessage } from '../../alerts/paperMorningMessage.js';

export function getOrCreatePaperMorningReport(view: PaperExperimentView | undefined, now: Date, paused: boolean): PaperMorningReport {
  const saved = loadPaperMorningReport(toKstDateKey(now));
  if (saved) return saved;
  let source = null, sourceError: string | undefined;
  if (!paused) {
    try { source = loadPaperMorningSource(); }
    catch (error) {
      console.error('[PaperMorning] 추천 원천 조회 실패:', error instanceof Error ? error.message : String(error));
      sourceError = '추천 원천 기록을 읽을 수 없습니다. 새 추천은 생성하지 않았습니다.';
    }
  }
  const selection = buildPaperMorningSelection(source, now);
  if (selection.status !== 'HOLIDAY' && (paused || sourceError)) selection.reason = sourceError ?? '자동 관측 일시정지 · 추천 자료 갱신을 확인해야 합니다.';
  return savePaperMorningReport({ ...selection, message: formatPaperMorningMessage(selection, view) });
}

export function reconcilePaperMorningDelivery(date: string, sentAt: string, messageId: number): void {
  markPaperMorningReportSent(date, sentAt, messageId);
}

/** Called after the strategy commit; capture failure must not undo observations or trades. */
export function capturePaperMorningSource(ledger: PaperStrategyLedger, snapshot: PaperSnapshot): void {
  if (!ledger.adaptive) return;
  try {
    savePaperMorningSource({ version: 'morning-source-v1', snapshot, adaptive: ledger.adaptive,
      openSymbols: [...new Set(ledger.trades.filter(trade => trade.status === 'OPEN').map(trade => trade.symbol))] });
  } catch (error) { console.error('[PaperMorning] 추천 원천 보존 실패:', error instanceof Error ? error.message : String(error)); }
}

function sameRule(a: PaperAdaptiveRule | undefined, b: PaperAdaptiveRule): boolean {
  return Boolean(a && a.feature === b.feature && a.bucket === b.bucket && a.horizon === b.horizon
    && a.invention?.id === b.invention?.id && a.invention?.createdAt === b.invention?.createdAt
    && a.invention?.discoveryCutoffAt === b.invention?.discoveryCutoffAt
    && isDeepStrictEqual(a.invention?.formula, b.invention?.formula));
}

/** Link only recommendations already sent before entry, preserving the original decision evidence. */
export function linkPaperMorningRecommendations(ledger: PaperStrategyLedger, snapshot: PaperSnapshot): void {
  const eligible = ledger.trades.filter(trade => !trade.morningRecommendation && trade.tradingDate === snapshot.tradingDate);
  if (!eligible.length) return;
  try {
    const report = loadPaperMorningReport(snapshot.tradingDate);
    if (!report?.delivery || report.status !== 'READY') return;
    for (const trade of eligible) {
      const pick = report.picks.find(item => item.symbol === trade.symbol);
      if (!pick || Date.parse(report.delivery.sentAt) > Date.parse(trade.entryAt)
        || Date.parse(report.createdAt) > Date.parse(trade.entryAt)) continue;
      trade.morningRecommendation = { reportId: report.id, rank: pick.rank, purpose: pick.purpose,
        recommendedAt: report.createdAt, sentAt: report.delivery.sentAt,
        matchesEntryRule: sameRule((trade.entryDecision.adaptiveEvidence ?? trade.entryDecision.explorationEvidence)?.candidate.rule, pick.candidate.rule) };
    }
  } catch (error) { console.error('[PaperMorning] 추천 거래 연결 실패:', error instanceof Error ? error.message : String(error)); }
}

export function getPaperMorningReview(date = toKstDateKey(new Date()), now = new Date()) {
  const report = loadPaperMorningReport(date);
  if (!report || Date.parse(report.createdAt) > now.getTime()) return { report: null, results: [] };
  if (!report.picks.length) return { report, results: [] };
  let ledger: PaperStrategyLedger;
  try { ledger = loadPaperStrategyLedger(); }
  catch (error) {
    console.error('[PaperMorning] 추천 이후 거래 조회 실패:', error instanceof Error ? error.message : String(error));
    return { report, results: [], trackingError: '추천 이후 가상 거래 기록 확인 불가' };
  }
  return { report, results: report.picks.map(pick => {
    const trade = ledger.trades.find(item => item.symbol === pick.symbol && Date.parse(item.entryAt) <= now.getTime()
      && (item.morningRecommendation?.reportId === report.id
        || (item.tradingDate === report.tradingDate && report.delivery
          && Date.parse(report.delivery.sentAt) <= Date.parse(item.entryAt)
          && Date.parse(report.createdAt) <= Date.parse(item.entryAt))));
    const exit = trade?.exit && Date.parse(trade.exit.decisionAt) <= now.getTime() ? trade.exit : null;
    const measurement = trade?.measurement && Date.parse(trade.measurement.latest.recordedAt) <= now.getTime() ? trade.measurement : null;
    return { rank: pick.rank, symbol: pick.symbol, name: pick.name, tradeId: trade?.id ?? null,
      status: trade ? exit ? 'CLOSED' : 'OPEN' : now.getTime() >= Date.parse(`${date}T15:30:00+09:00`) ? 'NOT_ENTERED' : 'PENDING',
      entryAt: trade?.entryAt ?? null, entryPrice: trade?.entryPrice ?? null,
      exitAt: exit?.effectiveAt ?? null, netReturnPct: exit?.netReturnPct ?? null,
      matchesEntryRule: trade ? trade.morningRecommendation?.matchesEntryRule
        ?? sameRule((trade.entryDecision.adaptiveEvidence ?? trade.entryDecision.explorationEvidence)?.candidate.rule, pick.candidate.rule) : null,
      measurement };
  }) };
}

export function formatStoredPaperMorningReport(now = new Date()): string {
  const { report, results, trackingError } = getPaperMorningReview(toKstDateKey(now), now);
  if (!report) return '오늘의 아침 추천 기록이 없습니다. 매일 08:30 KST에 거래일 추천 또는 휴장일 연구 현황을 발송합니다.';
  const delivered = report.delivery ? `발송 확인 ${new Date(report.delivery.sentAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })} KST` : '발송 확인 대기';
  const labels = { OPEN: '가상 매수 후 보유', CLOSED: '가상 청산 완료', NOT_ENTERED: '가상 미진입', PENDING: '장중 가상 진입 확인 대기' };
  return `${report.message}\n\n${delivered}${trackingError ? `\n${trackingError}` : ''}${results.length ? '\n추천 이후 추적\n' : ''}${results.map(item =>
    `${item.rank}. ${item.symbol} · ${labels[item.status as keyof typeof labels]}${item.netReturnPct === null ? '' : ` · 순수익 ${item.netReturnPct.toFixed(2)}%`}${item.matchesEntryRule === false ? ' · 다른 규칙으로 진입' : ''}`).join('\n')}`;
}
