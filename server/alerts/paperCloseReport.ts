// @responsibility Explain daily Shadow results from recorded evidence.
import type { PaperExperimentView, PaperOutcome } from '../../src/types/paperExperiment.js';
import type { PaperStrategyReasonCode, PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import { toKstDateKey } from '../calendar/krxTradingCalendar.js';
import { addBusinessDaysFromKstDate } from '../trading/krxHolidays.js';
import { PAPER_NEWS_LABELS } from '../../src/utils/paperNews.js';
import { readPaperNewsFacts } from '../../src/utils/paperNewsFacts.js';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (value: number) => value.toLocaleString('ko-KR');
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const pct = (value: number | null) => value === null || !Number.isFinite(value) ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const stamp = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '미확인';
const WAIT_LABELS: Partial<Record<PaperStrategyReasonCode, string>> = {
  INSUFFICIENT_MATURE_SAMPLES: '완료 표본 부족', INSUFFICIENT_ENTRY_DATES: '서로 다른 진입일 부족',
  NON_POSITIVE_EXPECTANCY: '비용 차감 후 양수 성과 없음', TREND_UNKNOWN: '20일선 미확인',
  CURRENT_PRICE_UNAVAILABLE: '현재가 미확인', OBSERVATION_TIME_INVALID: '관측 시각 미확인', ALREADY_ENTERED_TODAY: '당일 중복 진입 방지',
};

function baselineLines(view: PaperExperimentView, date: string, cutoff: number): string[] {
  const lines = ['<b>1. 기본 관측 · 오늘과 누적</b>'];
  if (view.experiments.length !== view.totalCount) return [...lines, '전체 원장 미조회 · 오늘 성과와 평가 일정 확인 필요'];
  const records = view.experiments.filter(item => item.tradingDate <= date && Date.parse(item.entryAt) <= cutoff);
  lines.push(`관측 ${new Set(records.map(item => item.tradingDate)).size}거래일 · 오늘 신규 ${num(records.filter(item => item.tradingDate === date).length)}건 · 누적 ${num(records.length)}건`);
  let overdue = 0, delayed = 0;
  const future: Array<{ date: string; horizon: number }> = [];
  for (const horizon of [1, 3, 5] as const) {
    const results: PaperOutcome[] = [];
    for (const record of records) {
      const due = addBusinessDaysFromKstDate(record.tradingDate, horizon);
      const closedAt = Date.parse(`${due}T15:30:00+09:00`);
      const outcome = record.outcomes.find(item => item.horizon === horizon && item.tradingDate === due
        && Number.isFinite(item.netReturnPct) && Date.parse(item.availableAt) >= closedAt && Date.parse(item.availableAt) <= cutoff);
      if (outcome) results.push(outcome);
      else if (closedAt <= cutoff) overdue++;
      else future.push({ date: due, horizon });
    }
    const today = results.filter(item => item.tradingDate === date);
    delayed += results.filter(item => item.tradingDate < date && toKstDateKey(item.availableAt) === date).length;
    lines.push(`D${horizon} 오늘 평가 ${num(today.length)}건 ${pct(mean(today.map(item => item.netReturnPct)))} · 누적 ${num(results.length)}건 ${pct(mean(results.map(item => item.netReturnPct)))}`);
  }
  if (delayed) lines.push(`과거 평가일 결과를 오늘 추가 확인: ${num(delayed)}건 (오늘 평가 성과와 별도)`);
  if (overdue) lines.push(`평가일 도래 후 미확정 ${num(overdue)}건 · 해당 날짜 종가 확인 필요`);
  const next = future.map(item => item.date).sort()[0];
  if (next) lines.push(`다음 평가 ${next} 종가 · ${([1, 3, 5] as const).flatMap(h => {
    const count = future.filter(item => item.date === next && item.horizon === h).length;
    return count ? [`D${h} ${num(count)}건`] : [];
  }).join(' / ')} (수집 후 확정)`);
  else if (!records.length) lines.push('신규 관측이 생기면 D1·D3·D5 평가 일정이 생성됩니다.');
  return lines;
}

function strategyLines(view: PaperExperimentView, date: string, cutoff: number): string[] {
  const lines = ['<b>2. 전략 가상 매매</b>'];
  const strategy = view.strategy;
  if (!strategy || strategy.error || strategy.lastRun?.error) return [...lines, '전략 기록 확인 필요 · 기본 관측 성과는 별도 집계'];
  if (strategy.trades.length === strategy.totalCount) {
    const trades = strategy.trades.filter(item => Date.parse(item.entryAt) <= cutoff);
    const exited = (item: PaperStrategyTrade) => item.exit && Date.parse(item.exit.decisionAt) <= cutoff
      && Date.parse(item.exit.effectiveAt) <= cutoff && Number.isFinite(item.exit.netReturnPct);
    const entered = trades.filter(item => item.tradingDate === date);
    const closed = trades.filter(exited);
    const today = closed.filter(item => toKstDateKey(item.exit!.effectiveAt) === date);
    const held = trades.filter(item => !exited(item));
    lines.push(`오늘 진입 ${num(entered.length)}건 · 오늘 평가일 청산 ${num(today.length)}건 · 보유 ${num(held.length)}건`,
      `오늘 청산 평균 ${pct(mean(today.map(item => item.exit!.netReturnPct)))} · 누적 ${num(closed.length)}건 ${pct(mean(closed.map(item => item.exit!.netReturnPct)))}`);
    if (entered.length) lines.push(`진입: ${entered.slice(0, 3).map(item => escape(item.name.slice(0, 20))).join(', ')}${entered.length > 3 ? ` 외 ${entered.length - 3}종목` : ''}`);
    const late = closed.filter(item => toKstDateKey(item.exit!.decisionAt) === date && toKstDateKey(item.exit!.effectiveAt) < date).length;
    if (late) lines.push(`과거 예약일 청산을 오늘 추가 확인 ${late}건`);
    const missed = held.filter(item => Date.parse(item.scheduledExitAt) <= cutoff).length;
    if (missed) lines.push(`예약일이 지난 청산 평가 ${missed}건 · 확정 종가 확인 필요`);
    const next = held.filter(item => Date.parse(item.scheduledExitAt) > cutoff).map(item => item.scheduledExitDate).sort()[0];
    if (next) lines.push(`다음 가상 청산 예정 ${next} · ${held.filter(item => item.scheduledExitDate === next).length}건`);
  } else lines.push('전체 전략 원장 미조회 · 오늘 진입·청산 건수 확인 필요');
  const session = strategy.lastMarketSession;
  if (session?.tradingDate === date && Date.parse(session.asOf) <= cutoff) {
    lines.push(`장중 마지막 판단 ${stamp(session.asOf)} · ${num(session.decisionCount)}종목`);
    const waits = Object.entries(WAIT_LABELS).flatMap(([code, label]) => {
      const count = session.reasonCounts[code as PaperStrategyReasonCode] ?? 0;
      return count ? [{ label, count }] : [];
    }).sort((a, b) => b.count - a.count);
    lines.push(waits.length ? `장중 대기: ${waits.map(item => `${item.label} ${num(item.count)}`).join(' · ')}`
      : session.decisionCount ? '장중 마지막 판단에서 신규 진입 대기 없음' : '장중 판단 대상 0종목 · 수집 상태 확인 필요');
  } else lines.push('오늘 장중 대기 사유 미기록 · 장후 대기에서 추정하지 않습니다.');
  return lines;
}

function newsLines(view: PaperExperimentView, date: string, cutoff: number): { lines: string[]; highlights: string[] } {
  const lines = ['<b>3. 뉴스·공시와 수급</b>'];
  const disclosure = view.lastRun?.disclosures;
  if (disclosure && Date.parse(disclosure.checkedAt) <= cutoff) {
    lines.push(`공시 ${disclosure.state === 'COMPLETE' ? '조회 완료' : disclosure.state === 'PARTIAL' ? '일부 미확인' : '조회 실패'} · ${stamp(disclosure.checkedAt)}`,
      `접수일 ${disclosure.fromDate}~${disclosure.toDate} · ${num(disclosure.fetchedCount)}건 / 연결 ${num(disclosure.linkedCount)} / 미연결 ${num(disclosure.unlinkedCount)}`);
    if (disclosure.issue) lines.push(escape(disclosure.issue.slice(0, 80)));
  } else lines.push('공시 수집 상태 미확인');
  const decisions = [...new Map((view.strategy?.latestDecisions ?? []).filter(item => toKstDateKey(item.decisionAt) === date
    && Date.parse(item.decisionAt) <= cutoff).map(item => [item.symbol, item])).values()];
  const summaries = decisions.filter(item => item.newsSummary && item.newsSummary.asOf === item.decisionAt);
  const count = (direction: string) => summaries.filter(item => item.newsSummary!.direction === direction).length;
  if (summaries.length) lines.push(`뉴스 평가 ${stamp(view.strategy?.lastRun?.asOf)} · 최근 ${view.strategy!.policy.newsLookbackHours}시간 자료`,
    `${num(summaries.length)}종목 평가 / 미기록 ${num(decisions.length - summaries.length)}`,
    `제목 기준 호재 추정 ${count('POSITIVE')} · 악재 추정 ${count('NEGATIVE')} · 혼재 ${count('MIXED')} · 중립 ${count('NEUTRAL')}`,
    `판단 불가 ${count('UNKNOWN')} · 최근 뉴스 미관측 ${count('NO_NEWS')} (뉴스 부재를 뜻하지 않음)`);
  else lines.push('오늘 뉴스 평가 자료 미확인');
  const direct = summaries.flatMap(item => item.newsSummary!.evidence.flatMap(news => {
    const facts = readPaperNewsFacts(news, item.decisionAt);
    return facts?.relationship === 'DIRECT' ? [{ ...news, facts, name: item.name, symbol: item.symbol }] : [];
  }));
  if (direct.length) lines.push(`직접 공시 연결 ${new Set(direct.map(item => item.symbol)).size}종목`);
  const flow = view.lastRun?.investorFlow;
  if (flow && Date.parse(flow.asOf) <= cutoff) {
    const groups = new Map(flow.groups.map(item => [item.group, item.count]));
    lines.push(`수급 기준일 ${flow.tradingDate} · 확인 ${num(flow.availableCount)}/${num(flow.candidateCount)}종목 · 미확인 ${num(flow.candidateCount - flow.availableCount)}`,
      `외국인·기관 동반 순매수 ${groups.get('BOTH_BUY') ?? 0} · 동반 순매도 ${groups.get('BOTH_SELL') ?? 0} · 엇갈림 ${groups.get('DIVERGENT') ?? 0} · 한쪽 이상 순매수 0 ${groups.get('OTHER') ?? 0}`);
  } else lines.push('기관·외국인 수급 자료 미확인');
  const distinct = [...new Map(direct.sort((a, b) => b.observedAt.localeCompare(a.observedAt)).map(item => [item.id, item])).values()];
  const highlights = distinct.slice(0, 2).map(item => `• ${escape(item.name.slice(0, 20))}: ${escape(item.headline.slice(0, 70))} (${PAPER_NEWS_LABELS[item.direction]})\n${item.facts.sourceUrl}`);
  return { lines, highlights };
}

/** Requires full experiment/trade views; a partial view is explicitly marked incomplete. */
export function formatPaperCloseReport(view: PaperExperimentView, date: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > toKstDateKey(now)) {
    return '<b>Shadow 마감 요약</b>\n집계 날짜 확인 필요';
  }
  const cutoff = Math.min(now.getTime(), Date.parse(`${date}T23:59:59.999+09:00`));
  const close = Date.parse(`${date}T15:30:00+09:00`);
  const last = view.lastRun;
  const at = Date.parse(last?.asOf ?? '');
  const completed = toKstDateKey(last?.asOf ?? '') === date && at >= close && at <= cutoff;
  const lines = [`<b>Shadow 마감 요약 · ${date}</b>`, '가상 실험 · 비용 반영 · KST',
    cutoff < close ? '마감 전 미리보기 · 종가 성과 미확정' : completed ? '마감 후 관측 확인' : '마감 후 관측 미확인 · 아래는 저장된 기록',
    `마지막 관측 ${stamp(last?.asOf)}${last && cutoff - at > 10 * 60_000 ? ' · 10분 이상 갱신 지연' : ''}`];
  if (last) lines.push(`가격 확인 ${num(last.observedCount)}/${num(last.candidateCount)}종목 · 미확인 ${num(last.missingPriceCount)}`);
  if (view.collection) lines.push(`다음 수집 진행 ${num(view.collection.completed)}/${num(view.collection.total)}종목`);
  lines.push('', ...baselineLines(view, date, cutoff), '', ...strategyLines(view, date, cutoff));
  const news = newsLines(view, date, cutoff);
  lines.push('', ...news.lines);
  const footer = '\n\n성과는 평가일 종가 기준 독립 실험 평균입니다. 계좌 수익률이 아닙니다.\n뉴스·수급은 연구 자료이며 매수 확정 근거가 아닙니다.\n/paper · /paper_research · /paper_bot';
  let message = lines.join('\n');
  for (const headline of news.highlights) if (message.length + headline.length + footer.length + 2 <= 3500) message += `\n\n${headline}`;
  return message + footer;
}
