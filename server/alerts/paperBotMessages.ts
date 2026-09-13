// @responsibility Format current Shadow bot reports.
import type { PaperExperimentView } from '../../src/types/paperExperiment.js';
import type { PaperStrategyTrade } from '../../src/types/paperStrategy.js';
import type { PaperBotState } from '../persistence/paperBotRepo.js';

export const PAPER_BOT_SCHEDULES = [
  { kind: 'morning', minute: 8 * 60 + 45, graceMinutes: 45, label: '거래일 08:45 · 준비 요약' },
  { kind: 'close', minute: 16 * 60 + 10, graceMinutes: 240, label: '거래일 16:10 · 마감 요약' },
  { kind: 'weekly', minute: 19 * 60, graceMinutes: 180, label: '일요일 19:00 · 연구 요약' },
] as const;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (value: number) => value.toLocaleString('ko-KR');
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const stamp = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '기록 대기';

export function formatPaperReport(view: PaperExperimentView, kind: 'morning' | 'close' | 'status', date: string, news: string[] = []): string {
  const title = kind === 'morning' ? '준비 요약' : kind === 'close' ? '마감 요약' : '현재 현황';
  const last = view.lastRun;
  const strategy = view.strategy;
  const today = view.experiments.filter(item => item.tradingDate === date).length;
  const lines = [`<b>Shadow ${title} · ${date}</b>`, '가상 실험 · 실제 주문 없음', '',
    `마지막 관측 ${stamp(last?.asOf)}`, last ? `후보 ${num(last.candidateCount)} · 현재가 확인 ${num(last.observedCount)} · 미확인 ${num(last.missingPriceCount)}` : '아직 관측 기록이 없습니다.',
    `기본 관측: 오늘 진입 ${num(today)} · 누적 ${num(view.totalCount)} · D5 완료 ${num(view.completedCount)}`, ];
  if (!strategy || strategy.error || strategy.lastRun?.error) lines.push('전략 기록 확인 대기');
  else {
    const opened = strategy.trades.filter(item => item.tradingDate === date).length;
    const closed = strategy.trades.filter(item => item.exit?.effectiveAt.startsWith(date)).length;
    lines.push(`전략: 오늘 가상 진입 ${opened} · 오늘 평가일 청산 ${closed} · 보유 ${strategy.openCount}`,
      `전략 누적 청산 ${strategy.performance.closedCount}건 · 평균 순수익률 ${pct(strategy.performance.meanNetReturnPct)}`);
    const waiting = strategy.latestDecisions.filter(item => item.action === 'WAIT');
    const needsSamples = waiting.filter(item => item.reasonCode === 'INSUFFICIENT_MATURE_SAMPLES' || item.reasonCode === 'INSUFFICIENT_ENTRY_DATES').length;
    lines.push(`최근 판단 대기 ${waiting.length}종목${needsSamples ? ` · 표본/진입일 누적 중 ${needsSamples}종목` : ''}`);
  }
  if (kind !== 'morning') lines.push('', '<b>기본 관측 누적 성과</b>', ...view.outcomes.map(item => `D${item.horizon}: ${pct(item.meanNetReturnPct)} · ${item.count}건`));
  if (view.research) lines.push('', `과거 재현 ${num(view.research.sampleCount)}건 · 전략 학습 가능 ${num(view.research.learningSampleCount)}건${view.research.error ? ' · 연구 갱신 확인 필요' : ''}`);
  if (news.length) lines.push('', '<b>최근 24시간 수집 뉴스·공시</b>', ...news.slice(0, 3).map(headline => `• ${escape(headline.slice(0, 100))}`));
  else lines.push('', '최근 24시간에 확인된 새 뉴스·공시 기록 없음');
  lines.push('', '비용 반영 독립 실험 평균이며 계좌 수익률이 아닙니다.', '/paper · /paper_research · /paper_bot');
  return lines.join('\n');
}

export function formatPaperResearch(view: PaperExperimentView): string {
  const research = view.research;
  if (!research) return '<b>Shadow 연구</b>\n저장 자료 연구 결과를 아직 불러오지 못했습니다. 다음 스캔 이후 확인하세요.';
  const lines = ['<b>Shadow 연구 점검 · 누적 자료 기준</b>', `연구 갱신 ${stamp(research.asOf)}`, research.error ? '연구 갱신 오류 · 이전 저장 결과입니다.' : '',
    `${research.symbols}종목 · 과거 재현 ${num(research.sampleCount)}건 · 전략 학습 가능 ${num(research.learningSampleCount)}건`,
    `과거 진입일 ${research.firstDate ?? '미확인'} ~ ${research.lastDate ?? '미확인'}`, '', '<b>조건별 후반 검증 · 대조군 대비</b>'];
  for (const item of research.featureStudies ?? []) {
    const difference = item.status === 'EVALUATED' && item.matchedDifferencePct !== null ? `${item.matchedDifferencePct > 0 ? '+' : ''}${item.matchedDifferencePct.toFixed(2)}%p` : '비교 대기';
    lines.push(`• ${escape(item.label)}: ${difference} · ${item.testCount}건/${item.testSymbolCount}종목/${item.testDateCount}진입일`);
  }
  lines.push('', '같은 날짜·뉴스·추세·보유기간을 맞춘 탐색 결과입니다. 매매에 자동 적용하지 않습니다.', '/paper · /paper_bot');
  return lines.filter(line => line !== '').join('\n');
}

export interface PaperBotTradeEvent { id: string; at: string; trade: PaperStrategyTrade; side: 'BUY' | 'EXIT' }
export function paperTradeEvents(trades: PaperStrategyTrade[]): PaperBotTradeEvent[] {
  return trades.flatMap(trade => [{ id: `${trade.id}:BUY`, at: trade.entryAt, trade, side: 'BUY' as const },
    ...(trade.exit ? [{ id: `${trade.id}:EXIT`, at: trade.exit.decisionAt, trade, side: 'EXIT' as const }] : [])]);
}
export function formatPaperTrades(events: PaperBotTradeEvent[]): string {
  const buys = events.filter(item => item.side === 'BUY').length;
  const lines = ['<b>Shadow 전략 변화 · 실제 주문 없음</b>', `새 가상 진입 ${buys}건 · 예약 종가 청산 ${events.length - buys}건`, ''];
  for (const event of events.slice(0, 10)) {
    const trade = event.trade;
    lines.push(event.side === 'BUY'
      ? `• 진입 ${escape(trade.name.slice(0, 30))}(${trade.symbol}) · 1주/${num(trade.entryPrice)}원 · D${trade.horizon} · 청산 예정 ${trade.scheduledExitDate}`
      : `• 청산 ${escape(trade.name.slice(0, 30))}(${trade.symbol}) · 평가일 ${trade.scheduledExitDate} · 순수익률 ${pct(trade.exit?.netReturnPct)}`);
  }
  if (events.length > 10) lines.push(`외 ${events.length - 10}건 · 전체 내역은 대시보드에서 확인`);
  lines.push(`판단 시각 ${stamp(events[events.length - 1]?.at)}`, '/paper');
  return lines.join('\n');
}
export function formatPaperBotStatus(state: PaperBotState): string {
  const sent = state.messages.filter(item => item.state === 'SENT').sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))[0];
  const health = { OK: '정상', PAUSED: '일시정지', STALE: '관측 지연', UNAVAILABLE: '원장 조회 오류', PRICE_MISSING: '장중 가격 미확인', STRATEGY_ERROR: '전략 갱신 오류' }[state.health] ?? '점검 대기';
  return ['<b>Shadow 알림 봇</b>', ...PAPER_BOT_SCHEDULES.map(item => item.label), '매분 · 새 전략 진입/청산, 관측 중단/복구 확인', '',
    `관측 상태 ${health}`,
    `마지막 점검 ${stamp(state.lastCheckedAt)}`, `마지막 확인된 발송 ${stamp(sent?.sentAt)}`,
    `최근 14일: 발송 대기 ${state.messages.filter(item => item.state === 'PENDING').length} · 실패 ${state.messages.filter(item => item.state === 'FAILED').length} · 만료 ${state.messages.filter(item => item.state === 'EXPIRED').length}`,
    'Telegram 메시지 ID를 받은 경우에만 발송 성공으로 기록합니다.', '/paper · /paper_research'].join('\n');
}
